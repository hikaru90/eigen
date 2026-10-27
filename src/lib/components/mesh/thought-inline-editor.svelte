<script lang="ts">
  import type { ThoughtKindOption } from '$lib/thought/kind-option'
  import { tick } from 'svelte'
  import { pillAction } from '$lib/components/mesh/pill-classes'
  import ThoughtThreadMenu from '$lib/components/thought-thread-menu.svelte'
  import ThoughtTypeMenu from '$lib/components/thought-type-menu.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { replaceTextEditRequest, textChange } from '$lib/thought/edit-request'
  import {
    applyThoughtEdit,
    assignThoughtThread,
    fetchThreadOptions,
    setThoughtType,
    unassignThoughtThread,
    type ThreadPick,
    type ThreadRef,
  } from '$lib/thought/thought-edit-client'

  /**
   * Change a thought where you read it. Rendered inside a thought row's pill line
   * (its root is `display: contents`): the type pill, the thread pill and the
   * "Edit words" pill sit inline with the row's other pills; editing the words
   * opens the textarea and Save/Cancel on their own full-width line below the
   * pills. The three things a thought is — its words, its type and
   * its thread — each one tap away, in the flow of the list (board 3f2796a8, b6f74d02:
   * editing used to need the thought page). Every change goes to the real endpoint and
   * the row takes what the server kept (`onchange`); a failure says why, in the row.
   */
  type Thought = { text: string; category: string; thread: ThreadRef | null }

  let {
    thoughtId,
    text,
    category,
    thread,
    kinds,
    onchange,
  }: Thought & {
    thoughtId: string
    kinds: ThoughtKindOption[]
    onchange: (next: Thought) => void
  } = $props()

  let busy = $state(false)
  let error = $state<string | null>(null)

  async function save(run: () => Promise<Thought>): Promise<boolean> {
    if (busy) return false
    busy = true
    error = null
    try {
      onchange(await run())
      return true
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      busy = false
    }
  }

  // ——— the words ———
  let draft = $state<string | null>(null)
  let field = $state<HTMLTextAreaElement | null>(null)

  async function startWords(): Promise<void> {
    draft = text
    await tick()
    field?.focus()
    field?.setSelectionRange(field.value.length, field.value.length)
  }

  async function saveWords(): Promise<void> {
    const next = draft === null ? null : textChange(text, draft)
    if (next === null) {
      draft = null
      return
    }
    const ok = await save(async () => {
      const kept = await applyThoughtEdit(thoughtId, replaceTextEditRequest(next))
      return { text: kept.text, category: kept.category, thread }
    })
    if (ok) draft = null
  }

  function onFieldKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      draft = null
    }
  }

  // ——— the type ———
  let typeMenuOpen = $state(false)

  function pickType(key: string): void {
    typeMenuOpen = false
    if (key === category) return
    void save(async () => {
      await setThoughtType(thoughtId, key)
      return { text, category: key, thread }
    })
  }

  // ——— the thread ———
  let threadMenuOpen = $state(false)
  let threadOptions = $state<ThreadRef[]>([])
  let threadOptionsLoaded = false
  let threadOptionsLoading = $state(false)
  let newThreadLabel = $state('')

  async function onThreadMenuChange(open: boolean): Promise<void> {
    threadMenuOpen = open
    if (!open || threadOptionsLoaded) return
    threadOptionsLoaded = true
    threadOptionsLoading = true
    try {
      threadOptions = await fetchThreadOptions()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      threadOptionsLoading = false
    }
  }

  function pickThread(pick: ThreadPick): void {
    threadMenuOpen = false
    if ('entityId' in pick && thread?.entityId === pick.entityId) return
    void save(async () => {
      const landed = await assignThoughtThread(thoughtId, pick)
      newThreadLabel = ''
      return { text, category, thread: landed }
    })
  }

  function leaveThread(): void {
    threadMenuOpen = false
    if (!thread) return
    void save(async () => {
      await unassignThoughtThread(thoughtId)
      return { text, category, thread: null }
    })
  }

  const quietButton =
    'p-0 border-0 bg-transparent [font:inherit] text-ink-2 cursor-pointer transition-colors duration-300 ease-settle pointer-fine:hover:text-ink disabled:cursor-default disabled:text-ink-4'
</script>

<div class="contents" data-testid="thought-inline-editor" aria-busy={busy}>
  <ThoughtTypeMenu
    pill
    {kinds}
    current={category}
    open={typeMenuOpen}
    {busy}
    onOpenChange={(o) => (typeMenuOpen = o)}
    onPick={pickType}
  />
  <ThoughtThreadMenu
    pill
    {thread}
    options={threadOptions}
    loading={threadOptionsLoading}
    open={threadMenuOpen}
    {busy}
    {newThreadLabel}
    onOpenChange={(o) => void onThreadMenuChange(o)}
    onPick={pickThread}
    onNewThreadLabel={(label) => (newThreadLabel = label)}
    onUnassign={leaveThread}
  />
  {#if draft === null}
    <button
      class={pillAction}
      type="button"
      data-testid="thought-inline-words"
      disabled={busy}
      onclick={() => void startWords()}
    >
      <svg
        class="size-[10px] fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path
          d="M10.6 2.9l2.5 2.5M3 13l.6-3.1 7.6-7.6a1.2 1.2 0 011.7 0l.8.8a1.2 1.2 0 010 1.7l-7.6 7.6z"
        />
      </svg>
      {m.thought_inline_edit_words()}
    </button>
  {:else}
    <!-- the words editor takes its own full-width line under the pills -->
    <div
      class="order-last flex basis-full flex-col gap-2.5 pt-1"
      data-testid="thought-inline-words-editor"
    >
      <textarea
        bind:this={field}
        bind:value={draft}
        class="block w-full min-h-[80px] p-3 rounded-[12px] border border-line bg-paper-2 font-you text-[20px] leading-[1.3] text-ink outline-none resize-y focus:border-signal"
        aria-label={m.thought_edit()}
        data-testid="thought-inline-field"
        disabled={busy}
        onkeydown={onFieldKey}></textarea>
      <div class="flex items-center gap-4 font-mesh text-sm">
        <button
          class="h-[30px] px-3.5 rounded-full border-0 bg-ink text-paper cursor-pointer disabled:opacity-40 disabled:cursor-default"
          type="button"
          data-testid="thought-inline-save"
          disabled={busy || !draft.trim()}
          onclick={() => void saveWords()}>{m.thought_inline_save()}</button
        >
        <button class={quietButton} type="button" disabled={busy} onclick={() => (draft = null)}
          >{m.graph_dialog_cancel()}</button
        >
      </div>
    </div>
  {/if}
  {#if error}
    <p class="order-last m-0 basis-full font-mesh text-sm text-clay" role="alert">{error}</p>
  {/if}
</div>
