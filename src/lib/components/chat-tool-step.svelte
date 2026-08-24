<script lang="ts">
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus'
  import Bot from '@lucide/svelte/icons/bot'
  import CheckIcon from '@lucide/svelte/icons/check'
  import List from '@lucide/svelte/icons/list'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import PencilLine from '@lucide/svelte/icons/pencil-line'
  import Search from '@lucide/svelte/icons/search'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import {
    toolLabel,
    toolStatusBadgeClasses,
    toolCategoryClasses,
    toolVisual,
    type ChatToolIcon,
    type ToolResultView,
  } from '$lib/chat/chat-stream-types'
  import ChatMarkdown from '$lib/components/chat-markdown.svelte'
  import ChatMemoryReferenceCard from '$lib/components/chat-memory-reference-card.svelte'

  type Props = {
    tool: string
    status: 'running' | 'done' | 'failed'
    argSummary?: string | null
    progress?: string
    resultView?: ToolResultView | null
  }

  let { tool, status, argSummary = null, progress, resultView = null }: Props = $props()

  const visual = $derived(toolVisual(tool))
  const classes = $derived(toolCategoryClasses(visual.category))
  const icon = $derived(visual.icon)

  const statusLabel = $derived(status === 'running' ? 'Running' : 'Failed')
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
    <span class="min-w-0 break-all text-sm font-medium tracking-tight text-foreground"
      >{toolLabel(tool)}</span
    >
    {#if status === 'done'}
      <CheckIcon class="size-3.5 shrink-0 text-green-600 dark:text-green-500" aria-label="Done" />
    {:else}
      <span class="text-xs font-medium uppercase tracking-widest {toolStatusBadgeClasses(status)}">
        {statusLabel}
      </span>
    {/if}
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
            {#each resultView.hits as hit, i (`${i}:${hit.id ?? hit.text}`)}
              <ChatMemoryReferenceCard id={hit.id} text={hit.text} category={hit.category} />
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
        <p class="min-w-0 break-all text-sm leading-relaxed text-foreground">
          {resultView.message}
        </p>
      {:else if resultView.kind === 'text'}
        <ChatMarkdown content={resultView.text} />
      {/if}
    </div>
  {/if}
</div>
