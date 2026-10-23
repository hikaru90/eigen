<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check'
  import XIcon from '@lucide/svelte/icons/x'
  import {
    evidenceHitsFromAnswerQuestionPayload,
    formatToolArgumentsSummary,
    parseFinalAnswerText,
    resolveToolResultView,
    type ToolResultMemoryHit,
  } from '$lib/chat/chat-stream-types'
  import type { ChatTimelineKind } from '$lib/chat/normalize-messages'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import ChatErrorMessage from '$lib/components/chat-error-message.svelte'
  import ChatMarkdown from '$lib/components/chat-markdown.svelte'
  import ChatMemoryReferenceCard from '$lib/components/chat-memory-reference-card.svelte'

  /**
   * One step of the agent loop, whisper-grade (ei "No machinery"): a fine glyph or the
   * mesh spinner, the step's label in a quiet line, your query in your voice, and — when
   * the step brought thoughts back — the sources rows. Everything the loop does stays
   * visible; it just stops shouting.
   */
  type Props = {
    kind: ChatTimelineKind
    label: string
    tool?: string
    arguments?: Record<string, unknown>
    content?: string
    failed?: boolean
    running?: boolean
    hideProse?: boolean
  }

  let {
    kind,
    label,
    tool = '',
    arguments: toolArgs = {},
    content = '',
    failed = false,
    running = false,
    hideProse = false,
  }: Props = $props()

  const argSummary = $derived(
    kind === 'tool_call' && tool ? formatToolArgumentsSummary(tool, toolArgs) : null,
  )

  const genericResultView = $derived(
    kind === 'tool_result' && tool && content ? resolveToolResultView(tool, content) : null,
  )

  const memoryHits = $derived.by((): ToolResultMemoryHit[] => {
    if (kind !== 'tool_result' || !content) return []
    if (tool === 'answer_question') {
      const evidence = evidenceHitsFromAnswerQuestionPayload(content)
      if (evidence.length > 0) return evidence
      if (genericResultView?.kind === 'memories') return genericResultView.hits
      return []
    }
    if (genericResultView?.kind === 'memories') {
      return genericResultView.hits
    }
    return []
  })

  const answerQuestionProse = $derived(
    kind === 'tool_result' &&
      tool === 'answer_question' &&
      !failed &&
      !hideProse &&
      content.trim().length > 0
      ? parseFinalAnswerText('', content).trim()
      : '',
  )

  const showToolResultText = $derived(
    kind === 'tool_result' &&
      tool !== 'answer_question' &&
      genericResultView?.kind === 'text' &&
      genericResultView.text.trim().length > 0,
  )

  const toolErrorMessage = $derived.by(() => {
    if (!failed) return null
    if (content && tool) {
      const view = resolveToolResultView(tool, content)
      if (view?.kind === 'error') return view.message
    }
    return 'Tool failed.'
  })
</script>

<div class={["flex flex-col gap-1.5 min-w-0 w-full py-1 animate-[fade_0.6s_var(--ease)_both]", failed && "[&_.glyph]:text-warn"]}>
  <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0 font-mesh text-sm leading-[1.4] text-ink-3">
    <span class="glyph grid place-items-center size-4 shrink-0 text-ink-3" aria-hidden="true">
      {#if running}
        <MeshSpinner working size={16} />
      {:else if failed}
        <XIcon size={12} strokeWidth={1.5} />
      {:else}
        <CheckIcon size={12} strokeWidth={1.5} />
      {/if}
    </span>
    <span class="min-w-0 [overflow-wrap:anywhere]">{label}</span>
    {#if argSummary}
      <span class="min-w-0 font-you text-sm text-ink-3 [overflow-wrap:anywhere]">{argSummary}</span>
    {/if}
  </div>

  {#if kind === 'tool_result' && answerQuestionProse}
    <div class="pl-[26px] max-[640px]:pl-0">
      <ChatMarkdown content={answerQuestionProse} />
    </div>
  {/if}

  {#if kind === 'tool_result' && memoryHits.length > 0}
    <ul class="mt-1.5 mb-0 ml-[26px] p-0 list-none max-[640px]:ml-0">
      {#each memoryHits as hit, i (`${i}:${hit.id ?? hit.text}`)}
        <ChatMemoryReferenceCard id={hit.id} text={hit.text} category={hit.category} index={i} />
      {/each}
    </ul>
  {:else if kind === 'tool_result' && tool === 'answer_question' && toolErrorMessage}
    <ChatErrorMessage message={toolErrorMessage} class="aside ml-[26px] max-[640px]:ml-0" />
  {:else if kind === 'tool_result' && genericResultView}
    {#if genericResultView.kind === 'memories'}
      <p class="aside ml-[26px] max-[640px]:ml-0 text-sm text-ink-3">No matching memories.</p>
    {:else if genericResultView.kind === 'error'}
      <ChatErrorMessage message={genericResultView.message} class="aside ml-[26px] max-[640px]:ml-0" />
    {/if}
  {:else if showToolResultText && genericResultView?.kind === 'text'}
    <div class="ml-[26px] max-[640px]:ml-0">
      <ChatMarkdown content={genericResultView.text} tone="muted" />
    </div>
  {:else if kind === 'tool_result' && toolErrorMessage}
    <ChatErrorMessage message={toolErrorMessage} class="aside ml-[26px] max-[640px]:ml-0" />
  {/if}
</div>

