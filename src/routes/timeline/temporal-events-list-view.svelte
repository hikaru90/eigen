<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import TemporalEventStatusButton from './temporal-event-status-button.svelte'
  import {
    completedEventSummaryClass,
    formatWhen,
    formatCreatedDate,
    isTemporalEventCompleted,
    kindColor,
    kindLabel,
  } from './temporal-events-utils'

  type Props = {
    items: TemporalEventListItem[]
    selectedItemId: string | null
    updatingEventId?: string | null
    onSelect: (item: TemporalEventListItem) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void
  }

  let { items, selectedItemId, updatingEventId = null, onSelect, onQuickAction }: Props = $props()
</script>

<ul class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Temporal events list">
  {#each items as item (item.id)}
    <li
      role="option"
      aria-selected={selectedItemId === item.id}
      class="border-border flex w-full items-center gap-2 border-b px-3 py-2.5 transition-colors {selectedItemId ===
      item.id
        ? 'bg-muted/50'
        : 'hover:bg-muted/40'}"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 gap-3 text-left"
        onclick={() => onSelect(item)}
      >
        <span
          class="mt-1 size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
          style="background-color: {kindColor(item.kind)}"
          aria-hidden="true"
        ></span>
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              class="text-foreground text-sm font-medium leading-snug {completedEventSummaryClass(
                isTemporalEventCompleted(item),
              )}"
            >
              {item.semanticSummary}
            </span>
            <span
              class="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-wide"
            >
              {kindLabel(item.kind)}
            </span>
            {#if isTemporalEventCompleted(item)}
              <span
                class="text-muted-foreground shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              >
                Done
              </span>
            {/if}
          </div>
          <p class="text-muted-foreground font-mono text-[11px]">
            {item.startAt ? 'Due: ' + formatWhen(item) + ' · ' : ''}created {formatCreatedDate(
              item,
            )}
          </p>
          <p class="text-muted-foreground/80 line-clamp-1 text-[11px]">{item.thoughtText}</p>
        </div>
      </button>
      <TemporalEventStatusButton {item} {updatingEventId} compact {onQuickAction} />
      {#if item.graphSyncStatus !== 'synced'}
        <span
          class="text-destructive shrink-0 font-mono text-[10px]"
          title={item.graphSyncError ?? 'Graph sync pending'}
        >
          {item.graphSyncStatus}
        </span>
      {/if}
    </li>
  {/each}
</ul>
