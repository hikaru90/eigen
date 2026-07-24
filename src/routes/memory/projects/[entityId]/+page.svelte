<script lang="ts">
  import { goto, invalidate } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { PageData } from './$types'
  import type { TemporalEventListItem } from '../../../api/temporal-events/+server'
  import type { ProjectViewMode } from '$lib/memory/project-view-mode'
  import { parseProjectViewMode } from '$lib/memory/project-view-mode'
  import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import PencilLine from '@lucide/svelte/icons/pencil-line'
  import SparklesIcon from '@lucide/svelte/icons/sparkles'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { Button } from '$lib/components/ui/button'
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import { m } from '$lib/paraglide/messages.js'
  import ProjectListView from '../../../timeline/project-list-view.svelte'
  import ProjectKanbanView from '../../../timeline/project-kanban-view.svelte'
  import ProjectGanttView from '../../../timeline/project-gantt-view.svelte'
  import TemporalEventDetail from '../../../timeline/temporal-event-detail.svelte'
  import TimelineEditProjectDialog from '../../../timeline/timeline-edit-project-dialog.svelte'
  import ProjectReviewDialog from './project-review-dialog.svelte'
  import type { ReviewProjectResponse } from '$lib/memory/project-review-types'
  import { postTimelineQuickAction } from '../../../timeline/timeline-item-actions'
  import { onMount } from 'svelte'

  let { data }: { data: PageData } = $props()

  const VIEW_STORAGE_KEY = 'project-view-mode'

  const project = $derived(data.project)
  const viewMode = $derived(data.view)

  let optimisticItems = $state<TemporalEventListItem[] | null>(null)
  const items = $derived(optimisticItems ?? data.items)

  let selectedItem = $state<TemporalEventListItem | null>(null)
  let updatingEventId = $state<string | null>(null)
  let actionBusy = $state(false)
  let lastActionSummary = $state<string | null>(null)
  let editOpen = $state(false)
  let dismissOpen = $state(false)
  let reviewing = $state(false)
  let reviewError = $state<string | null>(null)
  let reviewOpen = $state(false)
  let reviewPayload = $state<ReviewProjectResponse | null>(null)
  let projectLabelOverride = $state<string | null>(null)

  const displayLabel = $derived(projectLabelOverride ?? project.label)

  const orderedItems = $derived.by(() => {
    const rankByThought = new Map(project.tasks.map((task) => [task.thoughtId, task.rank]))
    return [...items].sort((a, b) => {
      const ra = rankByThought.get(a.thoughtId) ?? Number.MAX_SAFE_INTEGER
      const rb = rankByThought.get(b.thoughtId) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  })

  function statusLabel(status: typeof project.status): string {
    if (status === 'someday') return m.graph_timeline_project_status_someday()
    if (status === 'completed') return m.graph_timeline_project_status_completed()
    return m.graph_timeline_project_status_active()
  }

  async function reloadProject() {
    optimisticItems = null
    projectLabelOverride = null
    await invalidate(`project:${project.entityId}`)
    await invalidate('timeline:temporal-events')
  }

  onMount(() => {
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_STORAGE_KEY) : null
    const fromQuery = page.url.searchParams.get('view')
    if (!fromQuery && stored) {
      const parsed = parseProjectViewMode(stored)
      if (parsed !== viewMode) {
        void setViewMode(parsed)
      }
    }
  })

  async function setViewMode(next: ProjectViewMode) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    }
    const url = new URL(page.url)
    url.searchParams.set('view', next)
    await goto(`${url.pathname}?${url.searchParams.toString()}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    })
  }

  async function onQuickAction(eventId: string, action: 'mark_done' | 'reopen' | 'archive') {
    updatingEventId = eventId
    actionBusy = true
    try {
      const result = await postTimelineQuickAction(eventId, action)
      lastActionSummary = result.summary
      optimisticItems = items.map((item) => (item.id === eventId ? result.item : item))
      if (selectedItem?.id === eventId) selectedItem = result.item
      await reloadProject()
    } catch (err) {
      console.error('project quick action failed', err)
    } finally {
      updatingEventId = null
      actionBusy = false
    }
  }

  async function onInstruction(eventId: string, instruction: string) {
    updatingEventId = eventId
    actionBusy = true
    try {
      const res = await fetch(`/api/temporal-events/${encodeURIComponent(eventId)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'instruction', instruction }),
      })
      if (!res.ok) throw new Error(await res.text())
      const body = (await res.json()) as { item: TemporalEventListItem; summary?: string }
      optimisticItems = items.map((item) => (item.id === eventId ? body.item : item))
      if (selectedItem?.id === eventId) selectedItem = body.item
      lastActionSummary = body.summary ?? null
      await reloadProject()
    } catch (err) {
      console.error('project instruction failed', err)
    } finally {
      updatingEventId = null
      actionBusy = false
    }
  }

  async function onDeleteTask(eventId: string) {
    await onQuickAction(eventId, 'archive')
    selectedItem = null
  }

  async function openReview() {
    if (reviewing) return
    reviewing = true
    reviewError = null
    try {
      const res = await fetch(`/api/timeline/projects/${project.entityId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        throw new Error((await res.text()) || `Request failed (${res.status})`)
      }
      reviewPayload = (await res.json()) as ReviewProjectResponse
      reviewOpen = true
    } catch (err) {
      reviewError = err instanceof Error ? err.message : String(err)
    } finally {
      reviewing = false
    }
  }

  async function confirmDismiss() {
    dismissOpen = false
    const res = await fetch(`/api/timeline/projects/${project.entityId}/dismiss`, {
      method: 'POST',
    })
    if (!res.ok) {
      console.error('Failed to dismiss project', await res.text())
      return
    }
    await goto(resolve('/memory/projects'))
  }

  const ghostIconClass =
    'h-auto rounded-full p-1.5 text-black hover:text-black/70 dark:text-foreground dark:hover:text-foreground/70'
  const filledPillClass =
    'h-auto shrink-0 rounded-full border border-black bg-black px-3 py-1 text-xs font-medium text-white hover:bg-black/90 dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground/90'
  const viewPillClass = (active: boolean) =>
    active
      ? 'rounded-full bg-[var(--color-eigen-green)] px-3 py-1 text-xs font-medium text-black'
      : 'rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground'
</script>

<div
  class="-mb-28 flex h-dvh flex-col overflow-hidden overscroll-none px-3 pt-24"
  data-testid="project-detail-page"
>
  <header class="border-border shrink-0 space-y-3 border-b pb-3">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <a
          href={resolve('/memory/projects')}
          class="text-muted-foreground mb-2 inline-flex items-center gap-1 text-xs hover:text-foreground"
        >
          <ArrowLeftIcon class="size-3.5" aria-hidden="true" />
          {m.graph_timeline_project_back()}
        </a>
        <h1 class="flex items-center gap-2 text-base font-semibold">
          <FolderKanbanIcon class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{displayLabel}</span>
        </h1>
        <p class="text-muted-foreground text-xs">
          {statusLabel(project.status)}
          {#if project.openTaskCount > 0}
            · {m.graph_timeline_project_open_loops({ count: project.openTaskCount })}
          {/if}
          {#if project.targetDate}
            · {m.graph_timeline_project_deadline({
              date: new Date(project.targetDate).toLocaleDateString(),
            })}
          {/if}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        {#if project.status === 'active'}
          <Button
            type="button"
            variant="ghost"
            class="h-auto rounded-full p-1.5 text-destructive hover:text-destructive/80"
            aria-label={m.graph_timeline_delete_project()}
            onclick={() => (dismissOpen = true)}
          >
            <Trash2 class="size-4" strokeWidth={2} aria-hidden="true" />
          </Button>
        {/if}
        <Button
          type="button"
          variant="ghost"
          class={ghostIconClass}
          aria-label={m.graph_timeline_edit_project()}
          onclick={() => (editOpen = true)}
        >
          <PencilLine class="size-4" strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div
        class="border-border flex items-center gap-0.5 rounded-full border bg-muted/20 p-0.5"
        role="tablist"
        aria-label={m.graph_timeline_project_views_aria()}
      >
        <button
          type="button"
          role="tab"
          class={viewPillClass(viewMode === 'list')}
          aria-selected={viewMode === 'list'}
          onclick={() => void setViewMode('list')}
        >
          {m.graph_timeline_project_view_list()}
        </button>
        <button
          type="button"
          role="tab"
          class={viewPillClass(viewMode === 'timeline')}
          aria-selected={viewMode === 'timeline'}
          onclick={() => void setViewMode('timeline')}
        >
          {m.graph_timeline_project_view_timeline()}
        </button>
        <button
          type="button"
          role="tab"
          class={viewPillClass(viewMode === 'kanban')}
          aria-selected={viewMode === 'kanban'}
          onclick={() => void setViewMode('kanban')}
        >
          {m.graph_timeline_project_view_kanban()}
        </button>
      </div>
    </div>

    <div
      class="border-border bg-muted/10 flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="project-review-panel"
    >
      <p class="text-muted-foreground min-w-0 flex-1 text-xs leading-snug">
        {m.graph_timeline_project_review_hint()}
      </p>
      <Button
        type="button"
        class="{filledPillClass} gap-1"
        disabled={reviewing}
        onclick={() => void openReview()}
        data-testid="project-review"
      >
        {#if reviewing}
          <LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
          {m.graph_timeline_project_review_working()}
        {:else}
          <SparklesIcon class="size-3.5" aria-hidden="true" />
          {m.graph_timeline_project_review()}
        {/if}
      </Button>
    </div>

    {#if reviewError}
      <p class="text-destructive text-xs">{reviewError}</p>
    {/if}
  </header>

  <div class="relative mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if viewMode === 'list'}
      <ProjectListView
        items={orderedItems}
        selectedItemId={selectedItem?.id ?? null}
        {updatingEventId}
        onSelect={(item) => (selectedItem = item)}
        onQuickAction={(id, action) => void onQuickAction(id, action)}
      />
    {:else if viewMode === 'timeline'}
      <ProjectGanttView
        project={{ ...project, label: displayLabel }}
        items={orderedItems}
        selectedItemId={selectedItem?.id ?? null}
        onSelect={(item) => (selectedItem = item)}
      />
    {:else}
      <ProjectKanbanView
        items={orderedItems}
        selectedItemId={selectedItem?.id ?? null}
        {updatingEventId}
        onSelect={(item) => (selectedItem = item)}
        onQuickAction={(id, action) => void onQuickAction(id, action)}
      />
    {/if}
  </div>

  <TemporalEventDetail
    item={selectedItem}
    timeZone={data.preferredTimezone}
    {updatingEventId}
    {actionBusy}
    {lastActionSummary}
    onQuickAction={(id, action) => void onQuickAction(id, action)}
    onInstruction={(id, instruction) => void onInstruction(id, instruction)}
    onDelete={(id) => void onDeleteTask(id)}
    onClose={() => (selectedItem = null)}
  />

  <TimelineEditProjectDialog
    bind:open={editOpen}
    project={{ entityId: project.entityId, label: displayLabel }}
    onClose={() => (editOpen = false)}
    onUpdated={(updated) => {
      projectLabelOverride = updated.label
      editOpen = false
    }}
  />

  {#if reviewOpen && reviewPayload}
    <ProjectReviewDialog
      bind:open={reviewOpen}
      projectEntityId={project.entityId}
      review={reviewPayload}
      onClose={() => {
        reviewOpen = false
      }}
      onApplied={() => {
        reviewOpen = false
        void reloadProject()
      }}
    />
  {/if}
  <AlertDialog.Root bind:open={dismissOpen}>
    <AlertDialog.Content data-testid="project-delete-confirm">
      <AlertDialog.Header>
        <AlertDialog.Title>{m.graph_timeline_delete_project_title()}</AlertDialog.Title>
        <AlertDialog.Description>
          {m.graph_timeline_delete_project_description({ name: displayLabel })}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel class="rounded-[4px]">{m.graph_dialog_cancel()}</AlertDialog.Cancel>
        <AlertDialog.Action onclick={() => void confirmDismiss()}>
          {m.graph_timeline_delete_project()}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</div>
