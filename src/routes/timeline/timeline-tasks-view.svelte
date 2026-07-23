<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import type { NowSegment } from './temporal-events-utils'
  import { isOverdueItem } from '$lib/graph/timeline-overdue'
  import { m } from '$lib/paraglide/messages.js'
  import TemporalTimelineTaskRow from './temporal-timeline-task-row.svelte'

  type Props = {
    items: TemporalEventListItem[]
    doneItems: TemporalEventListItem[]
    overdueItems: TemporalEventListItem[]
    selectedItemId: string | null
    updatingEventId?: string | null
    timeZone: string
    segment: NowSegment
    onSelect: (item: TemporalEventListItem) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void
    onLongPress?: (item: TemporalEventListItem) => void
    onGoToOverdue?: () => void
  }

  let {
    items,
    doneItems,
    overdueItems,
    selectedItemId,
    updatingEventId = null,
    timeZone,
    segment,
    onSelect,
    onQuickAction,
    onLongPress,
    onGoToOverdue: _onGoToOverdue,
  }: Props = $props()
</script>

<div class="relative min-h-0 flex-1">
  <div
    class="absolute inset-0 overflow-y-auto pb-28 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    role="listbox"
    aria-label={m.graph_timeline_tasks_aria()}
  >
    {#if segment === 'todo'}
      {#if items.length === 0}
        <p class="text-muted-foreground px-4 py-8 text-center text-sm">
          {m.graph_timeline_focus_empty()}
        </p>
      {:else}
        <ul>
          {#each items as item (item.id)}
            <TemporalTimelineTaskRow
              {item}
              {selectedItemId}
              {updatingEventId}
              {timeZone}
              showWhen={!!item.startAt}
              showOverdueDuration={isOverdueItem(item)}
              {onSelect}
              {onQuickAction}
              {onLongPress}
            />
          {/each}
        </ul>
      {/if}
    {:else if segment === 'done'}
      {#if doneItems.length === 0}
        <p class="text-muted-foreground px-4 py-8 text-center text-sm">
          {m.graph_timeline_done_empty()}
        </p>
      {:else}
        <ul>
          {#each doneItems as item (item.id)}
            <TemporalTimelineTaskRow
              {item}
              {selectedItemId}
              {updatingEventId}
              {timeZone}
              showWhen={!!item.startAt}
              {onSelect}
              {onQuickAction}
              {onLongPress}
            />
          {/each}
        </ul>
      {/if}
    {:else if overdueItems.length === 0}
      <p class="text-muted-foreground px-4 py-8 text-center text-sm">
        {m.graph_timeline_overdue_empty()}
      </p>
    {:else}
      <ul>
        {#each overdueItems as item (item.id)}
          <TemporalTimelineTaskRow
            {item}
            {selectedItemId}
            {updatingEventId}
            {timeZone}
            showWhen={!!item.startAt}
            showOverdueDuration
            {onSelect}
            {onQuickAction}
            {onLongPress}
          />
        {/each}
      </ul>
    {/if}
  </div>
</div>
