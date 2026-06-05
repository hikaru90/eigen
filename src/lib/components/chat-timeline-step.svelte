<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import CheckIcon from "@lucide/svelte/icons/check";
  import {
    evidenceHitsFromAnswerQuestionPayload,
    formatToolArgumentsSummary,
    resolveToolResultView,
    type ChatTimelineKind,
  } from "$lib/chat/chat-stream-types";

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
    tool = "",
    arguments: toolArgs = {},
    content = "",
    failed = false,
    running = false,
  }: Props = $props();

  const argSummary = $derived(
    kind === "tool_call" && tool ? formatToolArgumentsSummary(tool, toolArgs) : null,
  );

  const evidenceHits = $derived(
    kind === "tool_result" && tool === "answer_question" && content
      ? evidenceHitsFromAnswerQuestionPayload(content)
      : [],
  );

  const genericResultView = $derived(
    kind === "tool_result" && tool && tool !== "answer_question" && content
      ? resolveToolResultView(tool, content)
      : null,
  );
</script>

<div class="flex min-w-0 w-full flex-col gap-1.5 py-0.5">
  <div
    class="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground"
  >
    {#if running}
      <LoaderCircleIcon class="size-3 shrink-0 animate-spin" />
    {:else}
      <div class="size-3 shrink-0 flex items-center justify-center bg-muted">
        <CheckIcon class="size-2 text-green-600 dark:text-green-500" aria-hidden="true" />
      </div>
    {/if}
    <span class="min-w-0 wrap-break-word leading-snug">{label}</span>
    {#if argSummary}
      <p class="min-w-0 leading-relaxed text-muted-foreground wrap-break-word ellipsis">
        {argSummary}
      </p>
    {/if}
  </div>

  {#if kind === "tool_result" && tool === "answer_question"}
    {#if evidenceHits.length > 0}
      <ul class="flex flex-col gap-2 list-none m-0 p-0 pl-1">
        {#each evidenceHits as hit, i (hit.id ?? `${i}:${hit.text}`)}
          <li class="flex flex-col gap-0.5 rounded-md border border-border bg-muted px-3 py-2">
            {#if hit.category}
              <span class="text-xs capitalize tracking-wide text-muted-foreground"
                >{hit.category}
                {#if hit.id}
                  <span class="text-xs text-muted-foreground truncate bg-muted-foreground/20 px-1" title={hit.id} aria-label="Memory id">
                    {hit.id}
                  </span>
                {/if}
              </span>
            {/if}
            <p class="min-w-0 break-all text-sm leading-snug text-foreground">{hit.text}</p>
          </li>
        {/each}
      </ul>
    {:else if failed}
      <p class="pl-1 text-sm text-foreground">Tool failed.</p>
    {/if}
  {:else if kind === "tool_result" && genericResultView}
    <div class="pl-1 text-sm text-foreground">
      {#if genericResultView.kind === "memories"}
        {#if genericResultView.hits.length === 0}
          <p class="text-muted-foreground">No matching memories.</p>
        {:else}
          <ul class="flex flex-col gap-2 list-none m-0 p-0">
            {#each genericResultView.hits as hit, i (hit.id ?? `${i}:${hit.text}`)}
              <li class="rounded-md border border-border bg-muted px-3 py-2">
                <p class="min-w-0 break-all text-sm leading-snug">{hit.text}</p>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if genericResultView.kind === "error"}
        <p>{genericResultView.message}</p>
      {:else if genericResultView.kind === "text"}
        <p class="min-w-0 break-all leading-relaxed">{genericResultView.text}</p>
      {/if}
    </div>
  {:else if kind === "tool_result" && failed}
    <p class="pl-1 text-sm text-foreground">Tool failed.</p>
  {/if}
</div>
