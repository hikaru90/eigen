<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import ChatErrorMessage from "$lib/components/chat-error-message.svelte";
  import ChatMarkdown from "$lib/components/chat-markdown.svelte";
  import ChatMemoryReferenceCard from "$lib/components/chat-memory-reference-card.svelte";
  import {
    evidenceHitsFromAnswerQuestionPayload,
    formatToolArgumentsSummary,
    parseFinalAnswerText,
    resolveToolResultView,
    type ChatTimelineKind,
    type ToolResultMemoryHit,
  } from "$lib/chat/chat-stream-types";

  type Props = {
    kind: ChatTimelineKind;
    label: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    content?: string;
    failed?: boolean;
    running?: boolean;
    hideProse?: boolean;
  };

  let {
    kind,
    label,
    tool = "",
    arguments: toolArgs = {},
    content = "",
    failed = false,
    running = false,
    hideProse = false,
  }: Props = $props();

  const argSummary = $derived(
    kind === "tool_call" && tool ? formatToolArgumentsSummary(tool, toolArgs) : null,
  );

  const genericResultView = $derived(
    kind === "tool_result" && tool && content ? resolveToolResultView(tool, content) : null,
  );

  const memoryHits = $derived.by((): ToolResultMemoryHit[] => {
    if (kind !== "tool_result" || !content) return [];
    if (tool === "answer_question") {
      const evidence = evidenceHitsFromAnswerQuestionPayload(content);
      if (evidence.length > 0) return evidence;
      if (genericResultView?.kind === "memories") return genericResultView.hits;
      return [];
    }
    if (genericResultView?.kind === "memories") {
      return genericResultView.hits;
    }
    return [];
  });

  const answerQuestionProse = $derived(
    kind === "tool_result" &&
      tool === "answer_question" &&
      !failed &&
      !hideProse &&
      content.trim().length > 0
      ? parseFinalAnswerText("", content).trim()
      : "",
  );

  const showToolResultText = $derived(
    kind === "tool_result" &&
      tool !== "answer_question" &&
      genericResultView?.kind === "text" &&
      genericResultView.text.trim().length > 0,
  );

  const toolErrorMessage = $derived.by(() => {
    if (!failed) return null;
    if (content && tool) {
      const view = resolveToolResultView(tool, content);
      if (view?.kind === "error") return view.message;
    }
    return "Tool failed.";
  });
</script>

<div class="flex min-w-0 w-full flex-col gap-1.5 py-0.5">
  <div
    class="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground"
  >
    {#if running}
      <LoaderCircleIcon class="size-3 shrink-0 animate-spin" />
    {:else if failed}
      <CircleX class="size-3 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
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

  {#if kind === "tool_result" && answerQuestionProse}
    <div class="pl-1">
      <ChatMarkdown content={answerQuestionProse} />
    </div>
  {/if}

  {#if kind === "tool_result" && memoryHits.length > 0}
    <ul class="flex flex-col gap-2 list-none m-0 p-0 pl-1">
      {#each memoryHits as hit, i (`${i}:${hit.id ?? hit.text}`)}
        <ChatMemoryReferenceCard id={hit.id} text={hit.text} category={hit.category} />
      {/each}
    </ul>
  {:else if kind === "tool_result" && tool === "answer_question" && toolErrorMessage}
    <ChatErrorMessage message={toolErrorMessage} class="ml-1" />
  {:else if kind === "tool_result" && genericResultView}
    <div class="pl-1 text-sm text-foreground">
      {#if genericResultView.kind === "memories"}
        <p class="text-muted-foreground">No matching memories.</p>
      {:else if genericResultView.kind === "error"}
        <ChatErrorMessage message={genericResultView.message} />
      {/if}
    </div>
  {:else if showToolResultText && genericResultView?.kind === "text"}
    <div class="pl-1">
      <ChatMarkdown content={genericResultView.text} tone="muted" />
    </div>
  {:else if kind === "tool_result" && toolErrorMessage}
    <ChatErrorMessage message={toolErrorMessage} class="ml-1" />
  {/if}
</div>
