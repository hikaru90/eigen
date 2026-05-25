<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import {
    evidenceHitsFromAnswerQuestionPayload,
    formatToolArgumentsSummary,
    resolveToolResultView,
    type ChatTimelineKind
  } from '$lib/chat/chat-stream-types';

  type Props = {
    kind: ChatTimelineKind;
    label: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    content?: string;
    failed?: boolean;
    running?: boolean;
  };

  let {
    kind,
    label,
    tool = '',
    arguments: toolArgs = {},
    content = '',
    failed = false,
    running = false
  }: Props = $props();

  const argSummary = $derived(
    kind === 'tool_call' && tool ? formatToolArgumentsSummary(tool, toolArgs) : null
  );

  const evidenceHits = $derived(
    kind === 'tool_result' && tool === 'answer_question' && content
      ? evidenceHitsFromAnswerQuestionPayload(content)
      : []
  );

  const genericResultView = $derived(
    kind === 'tool_result' && tool && tool !== 'answer_question' && content
      ? resolveToolResultView(tool, content)
      : null
  );
</script>

<div class="flex min-w-0 w-full flex-col gap-1.5 py-0.5">
  <div
    class="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
  >
    {#if running}
      <LoaderCircleIcon class="size-3 shrink-0 animate-spin" />
    {/if}
    <span class="min-w-0 wrap-break-word leading-snug">{label}</span>
  </div>

  {#if argSummary}
    <p class="min-w-0 pl-1 text-sm leading-relaxed text-muted-foreground wrap-break-word">{argSummary}</p>
  {/if}

  {#if kind === 'tool_result' && tool === 'answer_question'}
    {#if evidenceHits.length > 0}
      <ul class="flex flex-col gap-2 list-none m-0 p-0 pl-1">
        {#each evidenceHits as hit (hit.id ?? hit.text)}
          <li class="flex flex-col gap-0.5 rounded-md border border-border bg-muted px-3 py-2">
            <p class="min-w-0 break-all text-sm leading-snug text-foreground">{hit.text}</p>
            {#if hit.category}
              <span class="text-[11px] capitalize tracking-wide text-muted-foreground">{hit.category}</span>
            {/if}
            {#if hit.id}
              <span
                class="self-start text-[10px] text-muted-foreground cursor-help"
                title={hit.id}
                aria-label="Memory id"
              >
                id
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if failed}
      <p class="pl-1 text-sm text-foreground">Tool failed.</p>
    {/if}
  {:else if kind === 'tool_result' && genericResultView}
    <div class="pl-1 text-sm text-foreground">
      {#if genericResultView.kind === 'memories'}
        {#if genericResultView.hits.length === 0}
          <p class="text-muted-foreground">No matching memories.</p>
        {:else}
          <ul class="flex flex-col gap-2 list-none m-0 p-0">
            {#each genericResultView.hits as hit (hit.id ?? hit.text)}
              <li class="rounded-md border border-border bg-muted px-3 py-2">
                <p class="min-w-0 break-all text-sm leading-snug">{hit.text}</p>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if genericResultView.kind === 'error'}
        <p>{genericResultView.message}</p>
      {:else if genericResultView.kind === 'text'}
        <p class="min-w-0 break-all leading-relaxed">{genericResultView.text}</p>
      {/if}
    </div>
  {:else if kind === 'tool_result' && failed}
    <p class="pl-1 text-sm text-foreground">Tool failed.</p>
  {/if}
</div>
