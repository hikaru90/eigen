<script lang="ts">
  import { captureIndexingDetailMessage } from '$lib/capture/capture-indexing-status'
  import {
    categoryConfidencePercent,
    parseCategoryAlternatives,
  } from '$lib/capture/capture-result-display'
  import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
  import { categoryLabel } from '$lib/capture/reading-state'
  import { thoughtHref } from '$lib/chat/thought-href'
  import CaptureAttachedFiles from '$lib/components/capture-attached-files.svelte'
  import CaptureEntityConnections from '$lib/components/capture-entity-connections.svelte'
  import MemoryAuthorBadge from '$lib/components/memory-author-badge.svelte'
  import { m } from '$lib/paraglide/messages.js'

  let {
    thought,
    editLoading = false,
    onEdit,
    onAttach,
    onForget,
    onUnlinkFile,
    onNoteUpdated,
  }: {
    /** The kept thought, settled inline after Capture (never a modal, never a card pile). */
    thought: CaptureSubmitResult
    /** A natural-language edit is being applied in the background. */
    editLoading?: boolean
    onEdit?: (editRequest: string) => void
    /** Opens the existing attach dialog for this thought (no dedicated key yet — see missingKeys). */
    onAttach?: () => void
    onForget?: () => void
    onUnlinkFile?: (fileId: string) => void
    onNoteUpdated?: () => void | Promise<void>
  } = $props()

  const confidence = $derived(categoryConfidencePercent(thought.metadata))
  const alternatives = $derived(parseCategoryAlternatives(thought.metadata))
  const indexingMessage = $derived(captureIndexingDetailMessage(thought))

  let editing = $state(false)
  let editRequest = $state('')

  function submitEdit() {
    const request = editRequest.trim()
    if (!request) {
      editing = false
      editRequest = ''
      return
    }
    onEdit?.(request)
    editing = false
    editRequest = ''
  }
</script>

<!-- The design's settled inline block: the words, how they were kept, and the quiet tools. -->
<div
  class="mt-11 max-w-[60ch] animate-[rise_0.9s_var(--ease)_both] motion-reduce:[animation:none] min-w-0 [&>*]:min-w-0"
  data-testid="capture-settled"
>
  <div class="flex items-center justify-between gap-3 mb-2.5">
    <MemoryAuthorBadge author={thought.author ?? 'user'} authorLabel={thought.authorLabel} />
    <div class="flex gap-1">
      {#if onAttach}
        <!-- fallback label until the sweep wave adds capture_attach (reported) -->
        <button
          type="button"
          class="border-0 bg-transparent px-2 py-1 font-mesh text-sm text-ink-3 rounded-md [transition:color_0.3s_var(--ease),background_0.3s_var(--ease)] cursor-pointer pointer-fine:hover:text-ink pointer-fine:hover:bg-paper-2"
          data-testid="capture-attach"
          aria-label={m.notes_attached_label()}
          onclick={onAttach}
        >
          {m.notes_attached_label()}
        </button>
      {/if}
      <button
        type="button"
        class="border-0 bg-transparent px-2 py-1 font-mesh text-sm text-ink-3 rounded-md [transition:color_0.3s_var(--ease),background_0.3s_var(--ease)] cursor-pointer pointer-fine:hover:text-ink pointer-fine:hover:bg-paper-2"
        data-testid="capture-edit-toggle"
        onclick={() => {
          editing = !editing
          editRequest = ''
        }}
      >
        {m.thought_edit()}
      </button>
      {#if onForget}
        <button
          type="button"
          class="border-0 bg-transparent px-2 py-1 font-mesh text-sm text-ink-3 rounded-md [transition:color_0.3s_var(--ease),background_0.3s_var(--ease)] cursor-pointer pointer-fine:hover:text-ink pointer-fine:hover:bg-paper-2"
          onclick={onForget}
          data-testid="capture-forget"
        >
          {m.thought_forget()}
        </button>
      {/if}
    </div>
  </div>

  {#if editing}
    <!-- The pencil lives here too: say the change in your own words (Enter applies, esc leaves). -->
    <input
      class="w-full max-w-[48ch] py-0.5 px-0 border-0 border-b-[1.5px] border-ink-4 outline-none bg-transparent font-you text-base text-ink caret-signal"
      type="text"
      data-testid="capture-edit-input"
      bind:value={editRequest}
      aria-label={m.thought_edit()}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submitEdit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          editing = false
          editRequest = ''
        }
      }}
    />
  {:else}
    <!-- A small, deliberate target: the words themselves open the thought page
         (the route lands with the thought-page wave; linked regardless). -->
    <a
      class="block font-you text-[17px] leading-[1.5] tracking-[-0.01em] text-ink no-underline transition-colors duration-[400ms] ease-settle pointer-fine:hover:text-ink pointer-fine:hover:underline pointer-fine:hover:decoration-dashed pointer-fine:hover:decoration-ink-4 pointer-fine:hover:[text-underline-offset:0.2em]"
      href={thoughtHref(thought.id)}
      data-testid="capture-settled-open"
    >
      {thought.normalizedText}
    </a>
  {/if}

  <div class="flex flex-wrap gap-x-3.5 gap-y-1 mt-2 font-mesh text-sm text-ink-3">
    <span>
      {categoryLabel(thought.category)}
      {#if confidence}<span class="opacity-80 text-sm">({confidence})</span>{/if}
    </span>
    {#if thought.gtdProjectLabel}
      <span class="font-you text-sm">{thought.gtdProjectLabel}</span>
    {/if}
    {#each alternatives as alt (alt.key)}
      <span class="opacity-80 text-sm">{categoryLabel(alt.key)}</span>
    {/each}
  </div>

  {#if editLoading}
    <p class="mt-2 mb-0 text-sm text-ink-2">
      <span class="inline-block animate-[breathe_2.2s_var(--ease-io)_infinite] motion-reduce:[animation:none]">{m.whisper_knitting()}</span>
    </p>
  {/if}

  <CaptureEntityConnections entities={thought.entities} linkedThoughts={thought.linkedThoughts} />

  <CaptureAttachedFiles
    files={thought.attachedFiles ?? []}
    onUnlink={onUnlinkFile}
    onUpdated={onNoteUpdated}
  />

  {#if indexingMessage}
    <p class="mt-2 mb-0 text-sm leading-[1.5] text-ink-3" data-testid="capture-indexing-message">{indexingMessage}</p>
  {/if}
</div>

