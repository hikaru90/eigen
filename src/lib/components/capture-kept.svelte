<script lang="ts">
  import { onMount } from 'svelte'
  import type { KeptStage } from '$lib/capture/kept-progress'
  import { categoryLabel } from '$lib/capture/reading-state'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import ThoughtThreadMenu from '$lib/components/thought-thread-menu.svelte'
  import ThoughtTypeMenu from '$lib/components/thought-type-menu.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import type { ThoughtKindOption } from '$lib/thought/kind-option'
  import {
    assignThoughtThread,
    fetchThreadOptions,
    setThoughtType,
    unassignThoughtThread,
    type ThreadPick,
    type ThreadRef,
  } from '$lib/thought/thought-edit-client'

  /**
   * After Capture: the capture's process, as a status strip that stays up — how the
   * thought was kept (its type and thread — the reading the user accepted), then one
   * line for the background pass with the mesh spinner: while it indexes the line
   * cycles through what the pass actually does (entities, meaning, links, timeline),
   * then it says what got linked. It survives the next reading and the next words (board b4c5457a:
   * the old heading slot let one keystroke hide the whole process). The kept words
   * are never shown again (editing lives in Mesh), but how it was kept can be corrected:
   * the pencil beside "Kept as" opens the type and thread pickers in place, once the
   * thought has an id.
   */
  let {
    thoughtId,
    typeKey,
    thread,
    kinds,
    onkeptchange,
    oneditingchange,
    stage,
    entityCount,
    linkedCount,
    slow,
    failureReason,
    secretsRedacted = false,
  }: {
    /** The kept thought; null while it is still being saved (nothing to correct yet). */
    thoughtId: string | null
    typeKey: string
    /** The thread it was kept on; null when kept loose. */
    thread: ThreadRef | null
    kinds: ThoughtKindOption[]
    /** A correction landed: the page keeps the strip in step. */
    onkeptchange: (next: { typeKey: string; thread: ThreadRef | null }) => void
    /** The pickers opened or closed — while open the page keeps the strip up. */
    oneditingchange?: (editing: boolean) => void
    stage: KeptStage
    entityCount: number
    linkedCount: number
    /** Indexing outlasted the polling window: it carries on in the background. */
    slow: boolean
    /** The server's reason when the background pass failed (after its retries). */
    failureReason: string | null
    /** A credential in the words was kept out of memory (the server redacted it before indexing). */
    secretsRedacted?: boolean
  } = $props()

  const working = $derived(stage === 'saving' || stage === 'indexing')
  /** What the background pass does, in order; the line steps through them while indexing. */
  const explain = [
    m.capture_kept_working_1,
    m.capture_kept_working_2,
    m.capture_kept_working_3,
    m.capture_kept_working_4,
  ]
  let tick = $state(0)
  const workingLine = $derived(explain[tick % explain.length]())

  // ——— correcting how it was kept ———
  let editing = $state(false)
  let typeMenuOpen = $state(false)
  let threadMenuOpen = $state(false)
  let threadOptions = $state<ThreadRef[]>([])
  let threadOptionsLoaded = $state(false)
  let threadOptionsLoading = $state(false)
  let newThreadLabel = $state('')
  let busy = $state(false)
  let editError = $state<string | null>(null)

  async function correct(run: (id: string) => Promise<{ typeKey: string; thread: ThreadRef | null }>) {
    if (!thoughtId || busy) return
    busy = true
    editError = null
    try {
      onkeptchange(await run(thoughtId))
    } catch (e) {
      editError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  function pickType(key: string): void {
    typeMenuOpen = false
    if (key === typeKey) return
    void correct(async (id) => {
      await setThoughtType(id, key)
      return { typeKey: key, thread }
    })
  }

  function pickThread(pick: ThreadPick): void {
    threadMenuOpen = false
    if ('entityId' in pick && thread?.entityId === pick.entityId) return
    void correct(async (id) => {
      const landed = await assignThoughtThread(id, pick)
      if (!threadOptions.some((o) => o.entityId === landed.entityId)) {
        threadOptions = [...threadOptions, landed]
      }
      newThreadLabel = ''
      return { typeKey, thread: landed }
    })
  }

  function unassign(): void {
    threadMenuOpen = false
    if (!thread) return
    void correct(async (id) => {
      await unassignThoughtThread(id)
      return { typeKey, thread: null }
    })
  }

  async function onThreadMenuChange(open: boolean): Promise<void> {
    threadMenuOpen = open
    if (!open || threadOptionsLoaded) return
    threadOptionsLoaded = true
    threadOptionsLoading = true
    try {
      threadOptions = await fetchThreadOptions()
    } catch (e) {
      editError = e instanceof Error ? e.message : String(e)
    } finally {
      threadOptionsLoading = false
    }
  }

  onMount(() => {
    const timer = setInterval(() => {
      tick += 1
    }, 2600)
    return () => clearInterval(timer)
  })
</script>

<div data-testid="capture-kept" role="status" class="animate-[fade_0.5s_var(--ease)_both]">
  <p class="m-0 flex flex-wrap items-baseline gap-x-1 font-mesh text-sm text-ink-3">
    {m.capture_kept_as()}
    <span class="font-you text-base tracking-[-0.01em] text-ink">{categoryLabel(typeKey)}</span>
    <span aria-hidden="true"> · </span>
    <span class="font-you text-base tracking-[-0.01em] text-ink">{thread ? thread.label : m.capture_reading_loose()}</span>
    <button
      class="relative ml-1 inline-grid size-5 place-items-center self-center rounded-full border-0 bg-transparent p-0 text-ink-3 transition-colors duration-300 ease-settle before:absolute before:-inset-2 before:content-[''] disabled:text-ink-4 pointer-fine:hover:enabled:text-ink"
      type="button"
      aria-label={m.capture_kept_edit()}
      aria-expanded={editing}
      title={m.capture_kept_edit()}
      data-testid="capture-kept-edit"
      disabled={!thoughtId}
      onclick={() => {
        editing = !editing
        oneditingchange?.(editing)
      }}
    >
      <svg
        class="size-3 fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path d="M10.6 2.9l2.5 2.5M3 13l.6-3.1 7.6-7.6a1.2 1.2 0 011.7 0l.8.8a1.2 1.2 0 010 1.7l-7.6 7.6z" />
      </svg>
    </button>
  </p>

  {#if secretsRedacted}
    <p class="mt-2 mb-0 font-mesh text-sm text-ink-3" data-testid="capture-kept-secrets">
      {m.capture_kept_secrets_redacted()}
    </p>
  {/if}

  {#if editing}
    <!-- the same pickers as the thought page, in place -->
    <div class="mt-2 flex flex-wrap items-center gap-3 font-mesh text-sm text-ink-3" data-testid="capture-kept-editor">
      <ThoughtTypeMenu
        {kinds}
        current={typeKey}
        open={typeMenuOpen}
        {busy}
        onOpenChange={(o) => (typeMenuOpen = o)}
        onPick={pickType}
      />
      <ThoughtThreadMenu
        {thread}
        options={threadOptions}
        loading={threadOptionsLoading}
        open={threadMenuOpen}
        {busy}
        {newThreadLabel}
        onOpenChange={(o) => void onThreadMenuChange(o)}
        onPick={pickThread}
        onNewThreadLabel={(label) => (newThreadLabel = label)}
        onUnassign={unassign}
      />
    </div>
    {#if editError}
      <p class="mt-1.5 mb-0 text-sm text-clay" role="alert">{editError}</p>
    {/if}
  {/if}

  <div
    class="mt-2 flex items-center gap-2.5 font-mesh text-sm text-ink-3 [&_.spinner]:size-4 [&_.spinner]:shrink-0"
    data-testid="capture-kept-progress"
    data-stage={stage}
  >
    <MeshSpinner size={16} {working} />
    {#if stage === 'failed'}
      <span class="text-clay" role="alert">{m.capture_kept_failed({ reason: failureReason ?? '—' })}</span>
    {:else if stage === 'linked'}
      <span>{m.capture_kept_linked({ entities: entityCount, thoughts: linkedCount })}</span>
    {:else if slow}
      <span>{m.capture_kept_slow()}</span>
    {:else if stage === 'saving'}
      <span>{m.capture_kept_saving()}</span>
    {:else}
      {#key workingLine}
        <span class="animate-[fade_0.5s_var(--ease)_both] motion-reduce:[animation:none]">{workingLine}</span>
      {/key}
    {/if}
  </div>
</div>
