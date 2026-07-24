<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import {
    completedEventSummaryClass,
    formatCreatedDate,
    formatWhen,
    isTemporalEventCompleted,
  } from './temporal-events-utils'
  import TemporalEventStatusButton from './temporal-event-status-button.svelte'
  import MemoryAuthorBadge from '$lib/components/memory-author-badge.svelte'
  import { m } from '$lib/paraglide/messages.js'

  type Props = {
    items: TemporalEventListItem[]
    selectedItemId?: string | null
    updatingEventId?: string | null
    onSelect: (item: TemporalEventListItem) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void
  }

  let {
    items,
    selectedItemId = null,
    updatingEventId = null,
    onSelect,
    onQuickAction,
  }: Props = $props()
</script>

<div
  class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-28"
  role="list"
  aria-label={m.graph_timeline_projects_aria()}
  data-testid="project-list-view"
>
  {#if items.length === 0}
    <p class="text-muted-foreground px-1 py-8 text-center text-sm">
      {m.graph_timeline_project_empty_tasks()}
    </p>
  {:else}
    {#each items as item (item.id)}
      {@const completed = isTemporalEventCompleted(item)}
      <div
        class="border-border flex items-start gap-4 border-b px-1 py-2 last:border-b-0 {selectedItemId ===
        item.id
          ? 'bg-muted/30'
          : ''}"
        role="listitem"
      >
        <TemporalEventStatusButton {item} compact {updatingEventId} {onQuickAction} />
        <button
          type="button"
          class="flex min-w-0 flex-1 flex-col gap-1 text-left"
          onclick={() => onSelect(item)}
        >
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              class="text-foreground text-sm leading-snug {completedEventSummaryClass(completed)}"
            >
              {item.semanticSummary}
            </span>
            <MemoryAuthorBadge author={item.author} authorLabel={item.authorLabel} size="sm" />
          </div>
          <div class="flex flex-col gap-0.5">
            {#if item.startAt}
              <span class="text-foreground/60 font-mono text-[10px] leading-tight"
                >{m.graph_temporal_when()} {formatWhen(item)}</span
              >
            {/if}
            <span class="text-muted-foreground font-mono text-[10px] leading-tight"
              >Created {formatCreatedDate(item)}</span
            >
          </div>
        </button>
      </div>
    {/each}
  {/if}
</div>
