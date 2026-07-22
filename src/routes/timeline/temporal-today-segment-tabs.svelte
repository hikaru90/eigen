<script lang="ts">
  import { m } from '$lib/paraglide/messages.js'
  import type { NowSegment } from './temporal-events-utils'

  type TimelineSegmentTabCounts = {
    todo: number
    done: number
    overdue: number
  }

  type Props = {
    segment: NowSegment
    tabCounts: TimelineSegmentTabCounts
    onSegmentChange: (segment: NowSegment) => void
  }

  let { segment, tabCounts, onSegmentChange }: Props = $props()

  const todayTabItems = $derived([
    {
      segment: 'todo' as const,
      count: tabCounts.todo,
      label: m.graph_timeline_pill_todo(),
      countClass: 'text-black dark:text-foreground',
    },
    {
      segment: 'done' as const,
      count: tabCounts.done,
      label: m.graph_timeline_pill_done(),
      countClass: 'text-green-600 dark:text-green-500',
    },
    {
      segment: 'overdue' as const,
      count: tabCounts.overdue,
      label: m.graph_timeline_pill_overdue(),
      countClass: tabCounts.overdue > 0 ? 'text-destructive' : 'text-black dark:text-foreground',
    },
  ] as const)
</script>

<div
  class="grid w-full grid-cols-3 rounded-2xl border border-white/80 bg-white/5 p-0.5 dark:border-white/20 dark:bg-white/5"
  role="tablist"
  aria-label={m.graph_timeline_tasks_segments_aria()}
>
  {#each todayTabItems as tab (tab.segment)}
    <button
      type="button"
      role="tab"
      aria-selected={segment === tab.segment}
      class="flex flex-col items-center justify-center bg-transparent px-1.5 py-1 text-center transition-opacity hover:opacity-80 {segment ===
      tab.segment
        ? 'opacity-100'
        : 'opacity-60'}"
      onclick={() => onSegmentChange(tab.segment)}
    >
      <p
        class="text-base font-semibold tabular-nums leading-none {segment === tab.segment
          ? 'text-foreground'
          : tab.countClass}"
      >
        {tab.count > 0 || tab.segment !== 'overdue' ? tab.count : '—'}
      </p>
      <p
        class="text-foreground mt-0.5 text-[10px] uppercase tracking-wide {segment === tab.segment
          ? 'font-medium'
          : 'font-normal'}"
      >
        {tab.label}
      </p>
    </button>
  {/each}
</div>
