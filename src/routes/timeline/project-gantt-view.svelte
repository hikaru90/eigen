<script lang="ts">
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import { m } from '$lib/paraglide/messages.js'
  import type { ProjectListItem } from '$lib/server/memory/project-list'
  import {
    buildProjectGanttRange,
    placeGanttBar,
    placeGanttMarker,
  } from './project-gantt-utils'
  import { completedEventSummaryClass, isTemporalEventCompleted } from './temporal-events-utils'

  type Props = {
    project: ProjectListItem
    items: TemporalEventListItem[]
    selectedItemId?: string | null
    onSelect: (item: TemporalEventListItem) => void
  }

  let { project, items, selectedItemId = null, onSelect }: Props = $props()

  const range = $derived(
    buildProjectGanttRange({
      tasks: items.map((item) => ({
        id: item.id,
        startAt: item.startAt,
        endAt: item.endAt,
      })),
      milestones: project.milestones,
      deadline: project.targetDate,
      now: new Date(),
    }),
  )

  const deadlinePct = $derived(placeGanttMarker(project.targetDate, range))
  const milestoneMarkers = $derived(
    project.milestones
      .map((milestone) => ({
        id: milestone.id,
        label: milestone.label,
        pct: placeGanttMarker(milestone.targetDate, range),
      }))
      .filter((row): row is { id: string; label: string; pct: number } => row.pct != null),
  )

  function formatAxisDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
</script>

<div
  class="flex min-h-0 flex-1 flex-col overflow-auto pb-28 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
  role="region"
  aria-label={m.graph_timeline_project_view_timeline()}
  data-testid="project-gantt-view"
>
  {#if items.length === 0}
    <p class="text-muted-foreground px-1 py-8 text-center text-sm">
      {m.graph_timeline_project_empty_tasks()}
    </p>
  {:else}
    <div class="text-muted-foreground mb-2 flex justify-between px-1 font-mono text-[10px]">
      <span>{formatAxisDate(range.startMs)}</span>
      <span>{formatAxisDate(range.endMs)}</span>
    </div>

    <div class="relative min-w-[36rem] space-y-2 px-1">
      {#if deadlinePct != null}
        <div
          class="pointer-events-none absolute inset-y-0 z-10 w-px bg-destructive"
          style="left: {deadlinePct}%"
          data-testid="project-gantt-deadline"
          title={m.graph_timeline_project_gantt_deadline()}
        ></div>
      {/if}
      {#each milestoneMarkers as marker (marker.id)}
        <div
          class="pointer-events-none absolute inset-y-0 z-[5] w-px bg-amber-500/80"
          style="left: {marker.pct}%"
          title={marker.label}
          data-testid="project-gantt-milestone"
        ></div>
      {/each}

      {#each items as item (item.id)}
        {@const bar = placeGanttBar({ startAt: item.startAt, endAt: item.endAt }, range)}
        {@const completed = isTemporalEventCompleted(item)}
        <button
          type="button"
          class="border-border bg-background hover:bg-muted/20 grid w-full grid-cols-[10rem_1fr] items-center gap-2 rounded-md border px-2 py-2 text-left {selectedItemId ===
          item.id
            ? 'ring-primary ring-2'
            : ''}"
          onclick={() => onSelect(item)}
          data-testid="project-gantt-row"
        >
          <span
            class="truncate text-xs font-medium {completedEventSummaryClass(completed)}"
            title={item.semanticSummary}
          >
            {item.semanticSummary}
          </span>
          <div class="relative h-6 w-full rounded bg-muted/40">
            {#if bar}
              <div
                class="absolute top-1 h-4 rounded bg-[var(--color-eigen-green)]/80"
                style="left: {bar.leftPct}%; width: {bar.widthPct}%"
                data-testid="project-gantt-bar"
              ></div>
            {:else}
              <span
                class="text-muted-foreground absolute inset-y-0 left-2 flex items-center font-mono text-[10px]"
              >
                {m.graph_timeline_project_gantt_undated()}
              </span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
