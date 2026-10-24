<script lang="ts">
  import type { PageData } from './$types'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import MemorySurfaceNav from '$lib/components/memory-surface-nav.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { getCurrentUserView, subscribeCurrentUserView } from '$lib/stores/current-user-view.svelte'
  import { subscribeThoughtSync } from '$lib/stores/thought-sync'
  import { shouldRefetchPrefetchForView } from '../timeline/timeline-client-loads'
  import { createTimelineData } from '../timeline/timeline-data.svelte'
  import { postTimelineQuickAction } from '../timeline/timeline-item-actions'
  import { createDeskLabelLayer } from './desk-labels'
  import {
    ASSIGN_TASK_ENDPOINT,
    buildAssignTaskPayload,
    deskTaskHref,
    isValidAssignPayload,
  } from './desk-links'
  import { createDeskScene, type DeskSceneData, type DeskSceneHandle } from './desk-scene'
  import { resolveDeskPalette } from './desk-theme'

  let { data }: { data: PageData } = $props()

  let container = $state<HTMLDivElement | null>(null)
  let scene: DeskSceneHandle | null = null
  let labelLayer: ReturnType<typeof createDeskLabelLayer> | null = null
  let resizeObserver: ResizeObserver | null = null
  let sceneError = $state<string | null>(null)
  let actionError = $state<string | null>(null)

  /** Context menu state (task sheets only). Loose tasks on the desk are open, so mark-done is the only mutation. */
  let menuTaskId = $state<string | null>(null)
  let menuPosition = $state<{ x: number; y: number } | null>(null)

  const timelineData = createTimelineData({ skipInitialLocalStorage: true })

  const menuTask = $derived(
    menuTaskId ? timelineData.unassignedItems.find((item) => item.id === menuTaskId) ?? null : null,
  )

  function gotoTask(eventId: string) {
    void goto(resolve(deskTaskHref(eventId) as '/memory/tasks'))
  }

  function gotoProject(entityId: string) {
    void goto(resolve('/memory/projects/[entityId]', { entityId }))
  }

  function deriveSceneData(): DeskSceneData {
    return {
      projects: (timelineData.source?.projects ?? [])
        .filter((project) => project.status === 'active')
        .map((project) => ({
          entityId: project.entityId,
          label: project.label,
          openTaskCount: project.openTaskCount,
        })),
      tasks: timelineData.unassignedItems.map((item) => ({
        eventId: item.id,
        label: item.semanticSummary?.trim() || item.thoughtText,
      })),
      notes: data.wallNotes.map((note) => ({ id: note.id, label: note.label })),
    }
  }

  function refreshScene() {
    scene?.setData(deriveSceneData())
  }

  function resolvePalette() {
    return resolveDeskPalette((name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name),
    )
  }

  function closeContextMenu() {
    menuTaskId = null
    menuPosition = null
  }

  async function assignTaskToPile(eventId: string, entityId: string) {
    actionError = null
    const task = timelineData.unassignedItems.find((item) => item.id === eventId)
    const project = timelineData.source?.projects.find((candidate) => candidate.entityId === entityId)
    if (!task || !project) {
      // Stale drag (data refreshed mid-drag): refresh instead of assigning blind.
      refreshScene()
      return
    }
    const payload = buildAssignTaskPayload({ thoughtId: task.thoughtId }, { entityId: project.entityId })
    if (!isValidAssignPayload(payload)) {
      actionError = m.desk_error_assign()
      return
    }
    try {
      const res = await fetch(ASSIGN_TASK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        throw new Error((await res.text()) || `Request failed (${res.status})`)
      }
      await timelineData.load({ silent: true })
      refreshScene()
    } catch (err) {
      actionError = `${m.desk_error_assign()}: ${err instanceof Error ? err.message : String(err)}`
      refreshScene()
    }
  }

  async function runTaskAction(action: 'mark_done' | 'reopen') {
    if (!menuTaskId) return
    const eventId = menuTaskId
    closeContextMenu()
    actionError = null
    try {
      await postTimelineQuickAction(eventId, action)
      await timelineData.load({ silent: true })
      refreshScene()
    } catch (err) {
      actionError = `${m.desk_error_action()}: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  onMount(() => {
    if (!container) return
    let disposed = false

    const bootstrap = async () => {
      // Prefetch seeds first paint; fetch when there is no seed or the SSR
      // author scope misses the locally-selected view.
      if (data.prefetchedTimeline) {
        timelineData.seedSource(data.prefetchedTimeline)
        if (shouldRefetchPrefetchForView(data.prefetchedAuthorScope, getCurrentUserView())) {
          await timelineData.load()
        }
      } else {
        await timelineData.load()
      }
      if (disposed || !container) return

      labelLayer = createDeskLabelLayer(container)
      const palette = resolvePalette()
      try {
        scene = createDeskScene({
          container,
          palette,
          data: deriveSceneData(),
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          labelLayer,
          onSelectPile: gotoProject,
          onSelectTask: gotoTask,
          onSelectNote: () => void goto(resolve('/memory')),
          onDropTaskOnPile: (eventId, entityId) => void assignTaskToPile(eventId, entityId),
          onTaskContextMenu: (eventId, screen) => {
            menuTaskId = eventId
            menuPosition = screen
          },
        })
      } catch (err) {
        sceneError = err instanceof Error ? err.message : String(err)
        return
      }

      resizeObserver = new ResizeObserver(() => scene?.resize())
      resizeObserver.observe(container)

      const onThemeChange = () => {
        try {
          scene?.applyPalette(resolvePalette())
        } catch (err) {
          if (import.meta.env.DEV) {
            ;(window as unknown as Record<string, unknown>).__deskThemeError =
              err instanceof Error ? err.message : String(err)
          }
        }
      }
      window.addEventListener('theme-preference-change', onThemeChange)

      const unsubscribeView = subscribeCurrentUserView((view) => {
        timelineData.setView(view)
        // setView already fired a load; this one refreshes the scene when settled.
        void timelineData.load({ silent: true }).then(refreshScene)
      })

      const unsubscribeSync = subscribeThoughtSync((message) => {
        const reload =
          message.type === 'refresh-all' ||
          (message.type === 'changed' && message.scope === 'global')
        if (reload) {
          void timelineData.load({ silent: true }).then(refreshScene)
        }
      })

      const dismissMenu = () => closeContextMenu()
      window.addEventListener('click', dismissMenu)

      return () => {
        window.removeEventListener('theme-preference-change', onThemeChange)
        window.removeEventListener('click', dismissMenu)
        unsubscribeView()
        unsubscribeSync()
      }
    }

    let cleanup: (() => void) | undefined
    void bootstrap().then((result) => {
      if (disposed) {
        result?.()
        return
      }
      cleanup = result
    })

    return () => {
      disposed = true
      cleanup?.()
      resizeObserver?.disconnect()
      scene?.dispose()
      scene = null
      labelLayer?.dispose()
      labelLayer = null
    }
  })
</script>

<svelte:head>
  <title>Desk</title>
</svelte:head>

<div class="-mb-28 h-svh overscroll-none">
  <div
    bind:this={container}
    data-testid="desk-scene"
    aria-label={m.desk_aria_surface()}
    class="relative h-full w-full overflow-hidden"
  >
    {#if sceneError}
      <div
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center"
      >
        <p class="text-sm text-[var(--muted-foreground)]">
          WebGL could not start: {sceneError}
        </p>
        <a class="text-sm underline" href={resolve('/memory/tasks')}>/memory/tasks</a>
      </div>
    {/if}
    {#if actionError}
      <div
        role="alert"
        class="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs"
      >
        {actionError}
      </div>
    {/if}
    {#if menuTask && menuPosition}
      <div
        class="absolute z-30 flex min-w-40 flex-col rounded-sm border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        style="left:{menuPosition.x}px;top:{menuPosition.y}px"
      >
        <button
          type="button"
          class="px-3 py-1.5 text-left text-xs hover:bg-[var(--secondary)]"
          onclick={() => void runTaskAction('mark_done')}
        >
          {m.desk_action_mark_done()}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-left text-xs hover:bg-[var(--secondary)]"
          onclick={() => {
            const eventId = menuTaskId
            closeContextMenu()
            if (eventId) gotoTask(eventId)
          }}
        >
          {m.desk_action_open_task()}
        </button>
      </div>
    {/if}
  </div>
</div>
<MemorySurfaceNav />

