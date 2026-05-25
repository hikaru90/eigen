<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus';
  import List from '@lucide/svelte/icons/list';
  import Search from '@lucide/svelte/icons/search';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Bot from '@lucide/svelte/icons/bot';
  import ChatMarkdown from '$lib/components/chat-markdown.svelte';
  import {
    toolLabel,
    toolStatusBadgeClasses,
    toolCategoryClasses,
    toolVisual,
    type ChatToolIcon,
    type ToolResultView
  } from '$lib/chat/chat-stream-types';

  type Props = {
    tool: string;
    status: 'running' | 'done' | 'failed';
    argSummary?: string | null;
    progress?: string;
    resultView?: ToolResultView | null;
  };

  let { tool, status, argSummary = null, progress, resultView = null }: Props = $props();

  const visual = $derived(toolVisual(tool));
  const classes = $derived(toolCategoryClasses(visual.category));
  const icon = $derived(visual.icon);

  const statusLabel = $derived(
    status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : 'Done'
  );
</script>

{#snippet ToolIcon(name: ChatToolIcon)}
  {#if name === 'save'}
    <BookmarkPlus class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {:else if name === 'list'}
    <List class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {:else if name === 'search'}
    <Search class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {:else if name === 'sparkles'}
    <Sparkles class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {:else if name === 'pencil'}
    <PencilLine class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {:else if name === 'trash'}
    <Trash2 class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {:else}
    <Bot class="size-3.5 shrink-0 {classes.icon}" strokeWidth={1.5} />
  {/if}
{/snippet}

<div class="flex min-w-0 max-w-full flex-col gap-2 py-1">
  <div class="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
    {@render ToolIcon(icon)}
    <span class="min-w-0 break-all text-sm font-medium tracking-tight text-foreground">{toolLabel(tool)}</span>
    <span class="text-xs font-medium uppercase tracking-widest {toolStatusBadgeClasses(status)}">
      {statusLabel}
    </span>
  </div>

  {#if argSummary && status === 'running'}
    <p class="min-w-0 break-all text-sm leading-relaxed text-muted-foreground pl-5">{argSummary}</p>
  {/if}

  {#if progress && status === 'running'}
    <p class="flex min-w-0 items-start gap-1.5 pl-5 text-sm leading-normal text-muted-foreground">
      <LoaderCircleIcon class="mt-0.5 size-3 shrink-0 animate-spin" />
      <span class="min-w-0 wrap-break-word">{progress}</span>
    </p>
  {/if}

  {#if resultView && status !== 'running'}
    <div class="flex min-w-0 flex-col gap-2 pl-5 pt-0.5">
      {#if resultView.kind === 'memories'}
        {#if resultView.hits.length === 0}
          <p class="text-sm text-muted-foreground">No matching memories.</p>
        {:else}
          <ul class="flex flex-col gap-2.5 list-none m-0 p-0">
            {#each resultView.hits as hit (hit.id ?? hit.text)}
              <li class="flex flex-col gap-0.5 rounded-md border border-border bg-muted px-3 py-2">
                <p class="min-w-0 break-all text-sm leading-snug text-foreground">{hit.text}</p>
                {#if hit.category}
                  <span class="text-[11px] capitalize tracking-wide text-muted-foreground">{hit.category}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else if resultView.kind === 'lines'}
        <div class="flex flex-col gap-1">
          {#each resultView.lines as line, i (i)}
            <p class="min-w-0 break-all text-sm leading-relaxed text-foreground">{line}</p>
          {/each}
        </div>
      {:else if resultView.kind === 'error'}
        <p class="min-w-0 break-all text-sm leading-relaxed text-foreground">{resultView.message}</p>
      {:else if resultView.kind === 'text'}
        <ChatMarkdown content={resultView.text} />
      {/if}
    </div>
  {/if}
</div>
