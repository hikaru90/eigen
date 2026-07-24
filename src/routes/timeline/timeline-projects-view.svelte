<script lang="ts">
  import { resolve } from '$app/paths'
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import type { CreateProjectResponse } from '../api/timeline/projects/+server'
  import type { AssignProjectResponse } from '../api/timeline/projects/assign/+server'
  import type { ProjectListItem } from '$lib/server/memory/project-list'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import { Button } from '$lib/components/ui/button'
  import TimelineCreateProjectDialog from './timeline-create-project-dialog.svelte'
  import TimelineProjectAssignDialog from './timeline-project-assign-dialog.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import {
    findTemporalListItemByRef,
    isTemporalEventCompleted,
    completedEventSummaryClass,
    filterOpenTimelineItemsForProject,
    formatWhen,
    formatCreatedDate,
  } from './temporal-events-utils'
  import TemporalEventStatusButton from './temporal-event-status-button.svelte'
  import MemoryAuthorBadge from '$lib/components/memory-author-badge.svelte'
  import type { TimelineProjectCard } from './timeline-data-derive'

  type Props = {
    projectCards: TimelineProjectCard[]
    unassignedItems: TemporalEventListItem[]
    /** Open items — used for next-action / detail task lists. */
    items: TemporalEventListItem[]
    catalogProjects: ProjectListItem[]
    onGoToTask: (itemId: string) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void | Promise<void>
    onRefresh?: () => void
    updatingEventId?: string | null
  }

  let {
    projectCards,
    unassignedItems,
    items,
    catalogProjects: _catalogProjects,
    onGoToTask,
    onQuickAction,
    onRefresh,
    updatingEventId = null,
  }: Props = $props()

  let createDialogOpen = $state(false)
  let assignProjectOpen = $state(false)
  let assignProjectItem = $state<TemporalEventListItem | null>(null)

  const unassignedTasks = $derived(
    [...unassignedItems].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
  )

  function toProjectListItem(row: TimelineProjectCard): ProjectListItem {
    if (row.catalog) return row.catalog
    return {
      entityId: row.entityId,
      label: row.label,
      status: row.status,
      source: 'manual',
      nextAction: null,
      openTaskCount: row.group.items.length,
      targetDate: null,
      tasks: [],
      milestones: [],
    }
  }

  function formatShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString()
  }

  function getNextAction(project: ProjectListItem): { summary: string; itemId: string } | null {
    if (project.nextAction) {
      const nextItem = findTemporalListItemByRef(items, project.nextAction.itemId)
      if (!nextItem || !isTemporalEventCompleted(nextItem)) return project.nextAction
    }
    const projectTasks = filterOpenTimelineItemsForProject(items, project.entityId)
    const withDue = projectTasks
      .filter((t) => t.startAt)
      .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime())
    if (withDue.length > 0) return { summary: withDue[0].semanticSummary, itemId: withDue[0].id }
    if (projectTasks.length > 0) {
      const sorted = [...projectTasks].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      return { summary: sorted[0].semanticSummary, itemId: sorted[0].id }
    }
    return null
  }

  function statusLabel(status: ProjectListItem['status']): string {
    if (status === 'someday') return m.graph_timeline_project_status_someday()
    if (status === 'completed') return m.graph_timeline_project_status_completed()
    if (status === 'dismissed') return 'Dismissed'
    return m.graph_timeline_project_status_active()
  }

  function onProjectAssigned(_payload: AssignProjectResponse & { thoughtId: string }) {
    assignProjectOpen = false
    assignProjectItem = null
    onRefresh?.()
  }

  function onProjectCreated(_project: CreateProjectResponse) {
    onRefresh?.()
  }

  const filledPillClass =
    'h-auto shrink-0 rounded-full border border-black bg-black px-3 py-1 text-xs font-medium text-white hover:bg-black/90 dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground/90'
  const projectCardClass =
    'mb-2 flex w-full flex-col gap-y-1 bg-white py-3.5 px-4 text-left shadow-[4px_4px_0_0_#111111] transition-opacity hover:bg-white/95 dark:bg-card dark:shadow-[4px_4px_0_0_rgb(17_17_17_/_0.35)] dark:hover:bg-card/95'
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
  <div class="relative z-10 shrink-0 bg-background pb-2">
    <div class="flex flex-wrap items-center justify-between gap-2 pb-2">
      <h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {m.graph_timeline_projects_aria()}
      </h2>
      <Button
        type="button"
        class="{filledPillClass} gap-1 py-1.5"
        onclick={() => (createDialogOpen = true)}
      >
        <PlusIcon class="size-3.5" aria-hidden="true" />
        {m.graph_timeline_create_project()}
      </Button>
    </div>
  </div>

  <div class="relative min-h-0 flex-1" role="listbox" aria-label={m.graph_timeline_projects_aria()}>
    <div
      class="absolute inset-0 z-0 overflow-y-auto pb-28 pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {#if projectCards.length === 0 && unassignedTasks.length === 0}
        <p class="text-muted-foreground px-1 py-8 text-center text-sm">
          {m.graph_timeline_projects_empty()}
        </p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each projectCards as project (project.entityId)}
            {@const catalogProject = toProjectListItem(project)}
            {@const projectNextAction = getNextAction(catalogProject)}
            {@const openLoopCount = project.group.items.length}
            <a
              href={resolve(`/memory/projects/${project.entityId}`)}
              class="{projectCardClass} min-w-0 {project.status === 'someday' ? 'opacity-50' : ''}"
              data-testid="project-card"
            >
              <div class="flex w-full min-w-0 items-start justify-between gap-2">
                <p class="truncate text-sm leading-[1.2] text-foreground">{project.label}</p>
                {#if openLoopCount > 0}
                  <span class="shrink-0 text-[10px] leading-[1.2] text-muted-foreground">
                    {m.graph_timeline_project_open_loops({ count: openLoopCount })}
                  </span>
                {/if}
              </div>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-[10px] leading-[1.2] text-foreground"
                  >{statusLabel(project.status)}</span
                >
              </div>
              {#if projectNextAction}
                <div class="flex items-start gap-x-[11px]">
                  <span class="shrink-0 text-[10px] leading-[1.2] text-foreground">Next</span>
                  <span class="line-clamp-2 text-[10px] leading-[1.2] text-muted-foreground">
                    {projectNextAction.summary}
                  </span>
                </div>
              {/if}
              {#if catalogProject.targetDate}
                <p class="text-[10px] leading-[1.2] text-muted-foreground">
                  {m.graph_timeline_project_deadline({
                    date: formatShortDate(catalogProject.targetDate),
                  })}
                </p>
              {/if}
              {#if catalogProject.tasks.length > 0}
                {@const visibleTasks = catalogProject.tasks.slice(0, 4)}
                {@const hiddenTaskCount = catalogProject.tasks.length - visibleTasks.length}
                <div class="flex flex-col gap-0.5" data-testid="project-waterfall">
                  <span class="text-[10px] leading-[1.2] text-muted-foreground"
                    >{m.graph_timeline_project_waterfall()}</span
                  >
                  <ol class="flex flex-col gap-0.5">
                    {#each visibleTasks as task (task.itemId)}
                      <li class="text-[10px] leading-[1.2] text-muted-foreground">
                        {task.rank}. {task.summary}
                      </li>
                    {/each}
                  </ol>
                  {#if hiddenTaskCount > 0}
                    <span class="text-[10px] leading-[1.2] text-muted-foreground"
                      >+{hiddenTaskCount} more</span
                    >
                  {/if}
                </div>
              {/if}
              {#if catalogProject.milestones.length > 0}
                <div class="flex flex-col gap-0.5" data-testid="project-milestones">
                  <span class="text-[10px] leading-[1.2] text-muted-foreground"
                    >{m.graph_timeline_project_milestones()}</span
                  >
                  <div class="flex flex-wrap gap-1">
                    {#each catalogProject.milestones as milestone (milestone.id)}
                      <span
                        class="rounded border border-border px-1.5 py-0.5 text-[10px] leading-[1.2] text-muted-foreground"
                      >
                        {milestone.label}{#if milestone.targetDate}
                          · {formatShortDate(milestone.targetDate)}{/if}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
            </a>
          {/each}

          {#if unassignedTasks.length > 0}
            <div class="mt-2 pt-3">
              <h3 class="px-2 py-1.5 text-[10px] leading-[1.2] text-muted-foreground">
                {m.graph_timeline_project_no_project()} ({unassignedTasks.length})
              </h3>
              <div class="flex flex-col">
                {#each unassignedTasks as task (task.id)}
                  {@const taskCompleted = isTemporalEventCompleted(task)}
                  <div
                    class="border-border flex items-start gap-4 border-b py-2 pl-2 pr-3 last:border-b-0"
                  >
                    <TemporalEventStatusButton
                      item={task}
                      compact
                      {updatingEventId}
                      {onQuickAction}
                    />
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 flex-col gap-1 text-left"
                      onclick={() => onGoToTask(task.id)}
                    >
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span
                          class="text-foreground text-sm leading-snug {completedEventSummaryClass(
                            taskCompleted,
                          )}"
                        >
                          {task.semanticSummary}
                        </span>
                        <MemoryAuthorBadge
                          author={task.author}
                          authorLabel={task.authorLabel}
                          size="sm"
                        />
                      </div>
                      <div class="flex flex-col gap-0.5">
                        {#if task.startAt}
                          <span class="text-foreground/60 font-mono text-[10px] leading-tight"
                            >{m.graph_temporal_when()} {formatWhen(task)}</span
                          >
                        {/if}
                        <span class="text-muted-foreground font-mono text-[10px] leading-tight"
                          >Created {formatCreatedDate(task)}</span
                        >
                      </div>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      class="h-auto shrink-0 rounded-full border border-white px-2 py-0.5 text-xs text-black hover:text-black/70 dark:text-foreground dark:hover:text-foreground/70"
                      onclick={() => {
                        assignProjectItem = task
                        assignProjectOpen = true
                      }}
                    >
                      Assign
                    </Button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <TimelineCreateProjectDialog
    bind:open={createDialogOpen}
    onClose={() => (createDialogOpen = false)}
    onCreated={onProjectCreated}
  />

  {#if assignProjectOpen}
    <TimelineProjectAssignDialog
      open={true}
      item={assignProjectItem}
      onClose={() => {
        assignProjectOpen = false
        assignProjectItem = null
      }}
      onAssigned={onProjectAssigned}
    />
  {/if}
</div>
