<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import {
    buildWeekDays,
    kindColor,
    placementsForWeek,
    WEEK_GRID_END_HOUR,
    WEEK_GRID_START_HOUR,
    weekStartMonday,
  } from './temporal-events-utils'
  import { graphWeekdayLabels } from '$lib/graph/graph-i18n'
  import { m } from '$lib/paraglide/messages.js'
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import { Button } from '$lib/components/ui/button'
  import { SvelteDate } from 'svelte/reactivity'

  type Props = {
    items: TemporalEventListItem[]
    selectedItemId: string | null
    timeZone: string
    onSelect: (item: TemporalEventListItem) => void
    onReschedule: (eventId: string, startAt: string, endAt: string) => void
  }

  let { items, selectedItemId, timeZone, onSelect, onReschedule }: Props = $props()

  let weekAnchor = $state(new SvelteDate())
  let dragEventId = $state<string | null>(null)

  const weekStart = $derived(weekStartMonday(weekAnchor))
  const weekDays = $derived(buildWeekDays(weekStart))
  const weekdayLabels = $derived(graphWeekdayLabels())
  const hourRows = $derived(
    Array.from(
      { length: WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR },
      (_, i) => WEEK_GRID_START_HOUR + i,
    ),
  )
  const placements = $derived(placementsForWeek(items, weekStart, timeZone))

  const pxPerMinute = 1.2
  const rowHeightPx = 60 * pxPerMinute
  const gridHeightPx = (WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR) * rowHeightPx

  function shiftWeek(delta: number) {
    weekAnchor = new SvelteDate(weekAnchor.getTime() + delta * 7 * 24 * 60 * 60 * 1000)
  }

  function dropOnCell(dayIndex: number, hour: number) {
    if (!dragEventId) return
    const day = weekDays[dayIndex]
    const start = new SvelteDate(day)
    start.setHours(hour, 0, 0, 0)
    const end = new SvelteDate(start.getTime() + 60 * 60 * 1000)
    onReschedule(dragEventId, start.toISOString(), end.toISOString())
    dragEventId = null
  }

  function formatDayHeader(day: Date): string {
    return day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="size-7"
      onclick={() => shiftWeek(-1)}
    >
      <ChevronLeftIcon class="size-3.5" />
      <span class="sr-only">{m.graph_timeline_week_prev()}</span>
    </Button>
    <span class="text-muted-foreground font-mono text-xs">
      {formatDayHeader(weekDays[0])} – {formatDayHeader(weekDays[6])}
    </span>
    <Button type="button" variant="outline" size="icon" class="size-7" onclick={() => shiftWeek(1)}>
      <ChevronRightIcon class="size-3.5" />
      <span class="sr-only">{m.graph_timeline_week_next()}</span>
    </Button>
  </div>

  <div class="min-h-0 flex-1 overflow-x-auto overflow-y-auto p-1 sm:p-2">
    <div class="relative w-full min-w-[min(100%,42rem)] sm:min-w-[48rem]">
      <div
        class="grid grid-cols-[2.25rem_repeat(7,minmax(2.75rem,1fr))] gap-px sm:grid-cols-[3rem_repeat(7,1fr)]"
      >
        <div class="bg-muted/20"></div>
        {#each weekDays as day, i (day.toISOString())}
          <div
            class="bg-muted/30 text-muted-foreground border-border border-b px-1 py-1 text-center font-mono text-[10px] uppercase"
          >
            {weekdayLabels[i]}<br />
            <span class="text-foreground">{formatDayHeader(day)}</span>
          </div>
        {/each}

        {#each hourRows as hour (hour)}
          <div
            class="text-muted-foreground pr-1 text-right font-mono text-[10px] leading-none"
            style="height: {rowHeightPx}px"
          >
            {hour}:00
          </div>
          <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
          {#each weekDays as _day, dayIndex (`${dayIndex}-${hour}`)}
            <div
              class="border-border/50 hover:bg-muted/20 relative border-b border-r"
              style="height: {rowHeightPx}px"
              role="gridcell"
              ondragover={(e) => e.preventDefault()}
              ondrop={() => dropOnCell(dayIndex, hour)}
            ></div>
          {/each}
        {/each}
      </div>

      <div
        class="pointer-events-none absolute inset-0 grid grid-cols-[2.25rem_repeat(7,minmax(2.75rem,1fr))] sm:grid-cols-[3rem_repeat(7,1fr)]"
        style="top: 2.25rem; height: {gridHeightPx}px"
      >
        <div></div>
        <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
        {#each Array.from({ length: 7 }) as _, dayIndex (dayIndex)}
          <div class="relative h-full">
            {#each placements.filter((p) => p.dayIndex === dayIndex) as p (`${p.item.id}-${p.startMinutes}`)}
              <button
                type="button"
                class="pointer-events-auto absolute left-0.5 right-0.5 overflow-hidden rounded-sm border px-1 py-0.5 text-left text-[10px] leading-tight shadow-sm {selectedItemId ===
                p.item.id
                  ? 'ring-primary ring-2'
                  : ''}"
                style="top: {(p.startMinutes - WEEK_GRID_START_HOUR * 60) *
                  pxPerMinute}px; height: {Math.max(
                  p.durationMinutes * pxPerMinute,
                  18,
                )}px; background-color: {kindColor(p.item.kind)}22; border-color: {kindColor(
                  p.item.kind,
                )}"
                draggable="true"
                ondragstart={() => (dragEventId = p.item.id)}
                onclick={() => onSelect(p.item)}
              >
                <span class="text-foreground line-clamp-2 font-medium"
                  >{p.item.semanticSummary}</span
                >
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
