<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import TemporalEventStatusButton from './temporal-event-status-button.svelte'
  import {
    completedEventSummaryClass,
    formatWhen,
    groupByKind,
    isTemporalEventCompleted,
    kindColor,
    kindLabel,
    KANBAN_KIND_ORDER,
  } from './temporal-events-utils'

  type Props = {
    items: TemporalEventListItem[]
    selectedItemId: string | null
    updatingEventId?: string | null
    onSelect: (item: TemporalEventListItem) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void
  }

  let { items, selectedItemId, updatingEventId = null, onSelect, onQuickAction }: Props = $props()

  const columns = $derived.by(() => {
    const grouped = groupByKind(items)
    return KANBAN_KIND_ORDER.map((kind) => ({
      kind,
      label: kindLabel(kind),
      color: kindColor(kind),
      items: grouped.get(kind) ?? [],
    })).filter((col) => col.items.length > 0)
  })
</script>

<div
  class="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden p-2"
  role="region"
  aria-label="Temporal events kanban by kind"
>
  {#if columns.length === 0}
    <p class="text-muted-foreground m-auto text-sm">No events in this filter.</p>
  {:else}
    {#each columns as col (col.kind)}
      <section
        class="border-border bg-muted/10 flex w-[min(100%,16rem)] shrink-0 flex-col rounded-md border"
        aria-label="{col.label} column"
      >
        <header
          class="border-border flex items-center gap-2 border-b px-2 py-2"
          style="border-top: 3px solid {col.color}"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            style="background-color: {col.color}"
            aria-hidden="true"
          ></span>
          <h3 class="text-foreground text-xs font-semibold">{col.label}</h3>
          <span class="text-muted-foreground ml-auto font-mono text-[10px]">{col.items.length}</span
          >
        </header>
        <ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {#each col.items as item (item.id)}
            <li>
              <div
                class="border-border bg-background hover:bg-muted/30 w-full rounded-md border p-2 transition-colors {selectedItemId ===
                item.id
                  ? 'ring-primary ring-2'
                  : ''} {isTemporalEventCompleted(item) ? 'opacity-60' : ''}"
              >
                <div class="flex items-start gap-2">
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    onclick={() => onSelect(item)}
                  >
                    <p
                      class="text-foreground text-xs font-medium leading-snug {completedEventSummaryClass(
                        isTemporalEventCompleted(item),
                      )}"
                    >
                      {item.semanticSummary}
                    </p>
                    <p class="text-muted-foreground mt-1 font-mono text-[10px]">
                      {formatWhen(item)}
                    </p>
                    <p class="text-muted-foreground/80 mt-1 line-clamp-2 text-[10px]">
                      {item.thoughtText}
                    </p>
                  </button>
                  <TemporalEventStatusButton {item} {updatingEventId} compact {onQuickAction} />
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>
