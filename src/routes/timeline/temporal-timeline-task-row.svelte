<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import MemoryAuthorBadge from '$lib/components/memory-author-badge.svelte'
  import { graphEnergyLevelLabel } from '$lib/graph/graph-i18n'
  import { hapticConfirm } from '$lib/haptics'
  import { m } from '$lib/paraglide/messages.js'
  import TemporalEventStatusButton from './temporal-event-status-button.svelte'
  import {
    completedEventSummaryClass,
    energyPillClasses,
    formatWhen,
    formatCreatedDate,
    isTaskListItem,
    isTemporalEventCompleted,
  } from './temporal-events-utils'

  type Props = {
    item: TemporalEventListItem
    selectedItemId: string | null
    updatingEventId?: string | null
    showWhen?: boolean
    timeZone?: string
    showOverdueDuration?: boolean
    onSelect: (item: TemporalEventListItem) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void
    onLongPress?: (item: TemporalEventListItem) => void
  }

  let {
    item,
    selectedItemId,
    updatingEventId = null,
    showWhen = true,
    timeZone,
    showOverdueDuration: _showOverdueDuration = false,
    onSelect,
    onQuickAction,
    onLongPress,
  }: Props = $props()

  const completed = $derived(isTemporalEventCompleted(item))

  const LONG_PRESS_MS = 500
  const MOVE_THRESHOLD_PX = 12

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressTriggered = false
  let pressOriginX = 0
  let pressOriginY = 0

  function clearLongPressTimer() {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = null
  }

  function onPointerDown(e: PointerEvent) {
    if (!onLongPress || e.button !== 0) return
    longPressTriggered = false
    pressOriginX = e.clientX
    pressOriginY = e.clientY
    clearLongPressTimer()
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      longPressTriggered = true
      onLongPress?.(item)
    }, LONG_PRESS_MS)
  }

  function onPointerMove(e: PointerEvent) {
    if (!longPressTimer) return
    const moved = Math.hypot(e.clientX - pressOriginX, e.clientY - pressOriginY)
    if (moved > MOVE_THRESHOLD_PX) clearLongPressTimer()
  }

  function onPointerUp() {
    if (longPressTriggered) {
      // Vibration must run in a user-gesture handler; setTimeout loses activation on Android.
      hapticConfirm()
    }
    clearLongPressTimer()
  }

  function onClickSelect() {
    if (longPressTriggered) {
      longPressTriggered = false
      return
    }
    onSelect(item)
  }
</script>

<li
  role="option"
  aria-selected={selectedItemId === item.id}
  class="border-border flex w-full items-start gap-4 border-b py-2 pr-5 pl-5 last:border-b-0 transition-colors {selectedItemId ===
  item.id
    ? 'bg-muted/50'
    : 'hover:bg-muted/30'}"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={onPointerUp}
>
  <TemporalEventStatusButton {item} {updatingEventId} compact {onQuickAction} />
  <button
    type="button"
    class="flex min-w-0 flex-1 flex-col gap-1 text-left"
    onclick={onClickSelect}
  >
    <div class="flex w-full min-w-0 items-start justify-between gap-2">
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <span
          class="text-foreground min-w-0 text-sm leading-snug {completedEventSummaryClass(
            completed,
          )}"
        >
          {item.semanticSummary}
        </span>
        <MemoryAuthorBadge author={item.author} authorLabel={item.authorLabel} size="sm" />
      </div>
      {#if item.projectLabel}
        <span
          class="text-black shrink-0 max-w-[120px] truncate rounded-full border border-white px-2 py-0.5 text-[10px] leading-tight dark:text-foreground"
          title={item.projectLabel}
        >
          {item.projectLabel}
        </span>
      {/if}
    </div>

    <div class="flex flex-col gap-0.5">
      {#if showWhen && item.startAt}
        <span class="text-foreground/60 font-mono text-[10px] leading-tight"
          >{m.graph_temporal_when()} {formatWhen(item, timeZone)}</span
        >
      {/if}
      <span class="text-muted-foreground font-mono text-[10px] leading-tight"
        >Created {formatCreatedDate(item)}</span
      >
    </div>

    {#if item.durationMinutes || item.energyLevel || isTaskListItem(item)}
      <div class="flex flex-wrap items-center gap-1.5">
        {#if item.durationMinutes}
          <span class="text-muted-foreground font-mono text-[10px]">
            {m.graph_timeline_duration_min({ minutes: item.durationMinutes })}
          </span>
        {/if}
        {#if item.energyLevel}
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] {energyPillClasses(
              item.energyLevel,
            )}"
          >
            {graphEnergyLevelLabel(item.energyLevel)}
          </span>
        {/if}
        {#if isTaskListItem(item)}
          <span
            class="text-muted-foreground rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
          >
            {m.graph_timeline_open_loop()}
          </span>
        {/if}
      </div>
    {/if}
  </button>
</li>
