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
   * One task of the agent loop: the task in plain words (your query in your voice), its
   * tool calls as pills under it, and — when it brought thoughts back — the memory cards.
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
    steps?: string[]
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
    steps = [],
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

<div class={["flex flex-col items-start gap-1.5 min-w-0 w-full animate-[fade_0.6s_var(--ease)_both]", failed && "[&_.glyph]:text-warn"]}>
  <!-- The task in plain words (no pill, no check): what the mesh is doing for you. -->
  <div class="flex items-center gap-2 max-w-full min-w-0 font-mesh text-sm leading-5 text-ink-2" data-testid="chat-task">
    {#if failed}
      <span class="glyph grid place-items-center size-4 shrink-0" aria-hidden="true"><XIcon size={12} strokeWidth={1.5} /></span>
    {/if}
    <span class="shrink-0 whitespace-nowrap">{label}</span>
    {#if argSummary}
      <span class="min-w-0 truncate font-you text-ink-3">{argSummary}</span>
    {/if}
  </div>

  <!-- The tool calls under it: each a solid pill — check when done, spinner on the live one. -->
  {#if steps.length > 0}
    <ol class="m-0 p-0 list-none flex flex-wrap gap-1.5" aria-label="Steps">
      {#each steps as step, i (`${i}:${step}`)}
        {@const live = running && i === steps.length - 1}
        <li
          class="inline-flex items-center gap-1.5 max-w-full min-w-0 h-[22px] pl-1.5 pr-2.5 rounded-full bg-ink font-mesh text-xs leading-none text-paper animate-[fade_0.6s_var(--ease)_both]"
          data-testid="chat-tool-pill"
        >
          <span class="grid place-items-center size-3 shrink-0" aria-hidden="true">
            {#if live}
              <MeshSpinner working size={12} />
            {:else}
              <CheckIcon size={10} strokeWidth={2} />
            {/if}
          </span>
          <span class="min-w-0 truncate">{step}</span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if kind === 'tool_result' && answerQuestionProse}
    <div class="w-full mt-2">
      <ChatMarkdown content={answerQuestionProse} />
    </div>
  {/if}

  {#if kind === 'tool_result' && memoryHits.length > 0}
    <ul class="w-full mt-1.5 mb-0 p-0 list-none flex flex-col">
      {#each memoryHits as hit, i (`${i}:${hit.id ?? hit.text}`)}
        <ChatMemoryReferenceCard id={hit.id} text={hit.text} category={hit.category} index={i} />
      {/each}
    </ul>
  {:else if kind === 'tool_result' && tool === 'answer_question' && toolErrorMessage}
    <ChatErrorMessage message={toolErrorMessage} class="aside" />
  {:else if kind === 'tool_result' && genericResultView}
    {#if genericResultView.kind === 'memories'}
      <p class="aside text-sm text-ink-3">No matching memories.</p>
    {:else if genericResultView.kind === 'error'}
      <ChatErrorMessage message={genericResultView.message} class="aside" />
    {/if}
  {:else if showToolResultText && genericResultView?.kind === 'text'}
    <div class="w-full">
      <ChatMarkdown content={genericResultView.text} tone="muted" />
    </div>
  {:else if kind === 'tool_result' && toolErrorMessage}
    <ChatErrorMessage message={toolErrorMessage} class="aside" />
  {/if}
</div>
