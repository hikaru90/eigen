<script lang="ts">
  import { onMount } from 'svelte'
  import type { TemporalEventListItem } from '../api/temporal-events/+server'
  import type { CreateProjectResponse } from '../api/timeline/projects/+server'
  import type { AssignProjectResponse } from '../api/timeline/projects/assign/+server'
  import type { ProjectListItem } from '$lib/server/memory/project-list'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import { Button } from '$lib/components/ui/button'
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import TimelineCreateProjectDialog from './timeline-create-project-dialog.svelte'
  import TimelineEditProjectDialog from './timeline-edit-project-dialog.svelte'
  import TimelineProjectDetailDialog from './timeline-project-detail-dialog.svelte'
  import TimelineProjectAssignDialog from './timeline-project-assign-dialog.svelte'
  import TimelineAgentAssignDialog from './timeline-agent-assign-dialog.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import {
    findTemporalListItemByRef,
    isTemporalEventCompleted,
    completedEventSummaryClass,
    filterOpenTimelineItemsForProject,
    filterActiveItems,
    formatWhen,
    formatCreatedDate,
    groupByProjectEntityId,
    thoughtIdFromTaskItemId,
    type ProjectEntityGroup,
  } from './temporal-events-utils'
  import TemporalEventStatusButton from './temporal-event-status-button.svelte'
  import MemoryAuthorBadge from '$lib/components/memory-author-badge.svelte'
  import { subscribeThoughtSync } from '$lib/stores/thought-sync'
  import {
    getCurrentUserView,
    subscribeCurrentUserView,
  } from '$lib/stores/current-user-view.svelte'
  import type { CurrentUserView } from '$lib/memory/current-user-view'
  import { shouldRefetchForViewChange } from './timeline-client-loads'

  type Props = {
    items: TemporalEventListItem[]
    onGoToTask: (itemId: string) => void
    onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void | Promise<void>
    /** Called after project assign / dismiss so parent can refresh shared items. */
    onRefresh?: () => void
    orderBy?: 'ingest' | 'todo'
    sortDirection?: 'asc' | 'desc'
    updatingEventId?: string | null
  }

  let {
    items,
    onGoToTask,
    onQuickAction,
    onRefresh,
    orderBy: _orderBy = 'ingest',
    sortDirection: _sortDirection = 'desc',
    updatingEventId = null,
  }: Props = $props()

  /* ── State ── */

  let projects = $state<ProjectListItem[]>([])
  let projectsLoading = $state(false)
  let projectsError = $state<string | null>(null)

  let dataView = $state<CurrentUserView>(getCurrentUserView())
  let createDialogOpen = $state(false)
  let assignProjectOpen = $state(false)
  let assignProjectItem = $state<TemporalEventListItem | null>(null)
  let assignAgentOpen = $state(false)
  let assignAgentItem = $state<TemporalEventListItem | null>(null)
  let assignAgentSuccess = $state<string | null>(null)
  let editProjectOpen = $state(false)
  let editProjectItem = $state<ProjectListItem | null>(null)
  let detailDialogOpen = $state(false)
  let detailProject = $state<ProjectListItem | null>(null)
  let confirmDismissProjectId = $state<string | null>(null)
  let confirmDismissProjectLabel = $state<string | null>(null)

  async function loadProjects(silent = false) {
    if (!silent) projectsLoading = true
    projectsError = null
    try {
      const params = new URLSearchParams()
      params.set('author', dataView === 'user' ? 'user' : 'all')
      const res = await fetch(`/api/timeline/projects?${params}`)
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || 'unknown'}`)
      const body = (await res.json()) as { projects: ProjectListItem[] }
      projects = body.projects
    } catch (err) {
      projectsError = err instanceof Error ? err.message : String(err)
      if (!silent) projects = []
    } finally {
      projectsLoading = false
    }
  }

  /* ── Derived ── */

  /** Parent already applied status/range; only drop snoozed for the board. */
  const scopedItems = $derived(filterActiveItems(items))

  const grouped = $derived(groupByProjectEntityId(scopedItems))

  const projectByEntityId = $derived.by(() => {
    const map: Record<string, ProjectListItem> = {}
    for (const project of projects) {
      map[project.entityId] = project
    }
    return map
  })

  type DisplayProject = {
    entityId: string
    label: string
    status: ProjectListItem['status']
    catalog: ProjectListItem | null
    group: ProjectEntityGroup
  }

  const displayProjects = $derived.by(() => {
    const rows: DisplayProject[] = grouped.groups.map((group) => {
      const catalog = projectByEntityId[group.projectEntityId] ?? null
      return {
        entityId: group.projectEntityId,
        label: catalog?.label ?? group.projectLabel,
        status: catalog?.status ?? 'active',
        catalog,
        group,
      }
    })
    return rows.sort((a, b) => {
      const aLatest =
        a.group.items.length > 0
          ? Math.max(...a.group.items.map((t) => new Date(t.createdAt).getTime()))
          : 0
      const bLatest =
        b.group.items.length > 0
          ? Math.max(...b.group.items.map((t) => new Date(t.createdAt).getTime()))
          : 0
      return bLatest - aLatest
    })
  })

  const unassignedTasks = $derived(
    [...grouped.unassigned].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
  )

  const detailNextAction = $derived(detailProject ? getNextAction(detailProject) : null)
  const detailNextActionItem = $derived(
    detailNextAction ? findTemporalListItemByRef(items, detailNextAction.itemId) : null,
  )
  const detailTasks = $derived.by(() => {
    if (!detailProject) return []
    const nextThoughtId =
      (detailNextAction ? thoughtIdFromTaskItemId(detailNextAction.itemId) : null) ??
      detailNextActionItem?.thoughtId ??
      null
    return filterOpenTimelineItemsForProject(items, detailProject.entityId, {
      excludeItemId: detailNextAction?.itemId ?? null,
      excludeThoughtId: nextThoughtId,
    })
  })

  /* ── Helpers ── */

  function toProjectListItem(row: DisplayProject): ProjectListItem {
    if (row.catalog) return row.catalog
    return {
      entityId: row.entityId,
      label: row.label,
      status: row.status,
      source: 'manual',
      nextAction: null,
      openTaskCount: row.group.items.length,
    }
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

  /* ── Actions ── */

  function onProjectAssigned(_payload: AssignProjectResponse & { thoughtId: string }) {
    assignProjectOpen = false
    assignProjectItem = null
    void loadProjects(true)
    onRefresh?.()
  }

  function onProjectCreated(project: CreateProjectResponse) {
    if (project.status === 'active' || project.status === 'someday') {
      const exists = projects.some((p) => p.entityId === project.entityId)
      if (!exists) {
        projects = [
          ...projects,
          {
            entityId: project.entityId,
            label: project.label,
            status: project.status,
            source: 'manual',
            nextAction: null,
            openTaskCount: 0,
          },
        ]
      }
    }
    void loadProjects(true)
  }

  function onProjectUpdated(updated?: { entityId: string; label: string }) {
    editProjectOpen = false
    editProjectItem = null
    if (detailProject && updated?.entityId === detailProject.entityId) {
      detailProject = { ...detailProject, label: updated.label }
    }
    void loadProjects(true)
  }

  function onAgentAssigned(payload: { agentName: string }) {
    assignAgentSuccess = m.graph_timeline_assign_agent_success({ agent: payload.agentName })
    assignAgentOpen = false
    assignAgentItem = null
  }

  async function confirmDismissProject() {
    if (!confirmDismissProjectId) return
    const entityId = confirmDismissProjectId
    confirmDismissProjectId = null
    confirmDismissProjectLabel = null
    try {
      const res = await fetch(`/api/timeline/projects/${entityId}/dismiss`, { method: 'POST' })
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || 'unknown'}`)
      if (detailProject?.entityId === entityId) {
        detailDialogOpen = false
        detailProject = null
      }
      void loadProjects(true)
      onRefresh?.()
    } catch (err) {
      console.error('Failed to dismiss project', err)
    }
  }

  /* ── Lifecycle ── */

  onMount(() => {
    void loadProjects()

    let previousView: CurrentUserView | null = null
    const unsubView = subscribeCurrentUserView((view) => {
      const refetch = shouldRefetchForViewChange(previousView, view)
      previousView = view
      dataView = view
      if (!refetch) return
      void loadProjects(true)
    })

    const unsubSync = subscribeThoughtSync((msg) => {
      if (msg.type === 'refresh-all' || (msg.type === 'changed' && msg.scope === 'global')) {
        void loadProjects(true)
      }
    })

    return () => {
      unsubView()
      unsubSync()
    }
  })

  /* ── Styles ── */

  const filledPillClass =
    'h-auto shrink-0 rounded-full border border-black bg-black px-3 py-1 text-xs font-medium text-white hover:bg-black/90 dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground/90'
  const projectCardClass =
    'mb-2 flex w-full flex-col gap-y-1 bg-white py-3.5 px-4 text-left shadow-[4px_4px_0_0_#111111] transition-opacity hover:bg-white/95 dark:bg-card dark:shadow-[4px_4px_0_0_rgb(17_17_17_/_0.35)] dark:hover:bg-card/95'
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
  {#if assignAgentSuccess}
    <p class="text-muted-foreground mb-2 px-0.5 text-xs">{assignAgentSuccess}</p>
  {/if}

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
      {#if projectsLoading}
        <div class="flex flex-col items-center justify-center gap-3 py-12">
          <LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
          <p class="text-muted-foreground text-sm">{m.graph_temporal_loading()}</p>
        </div>
      {:else if projectsError}
        <p class="text-destructive px-1 py-8 text-center text-sm">{projectsError}</p>
      {:else if displayProjects.length === 0 && unassignedTasks.length === 0}
        <p class="text-muted-foreground px-1 py-8 text-center text-sm">
          {m.graph_timeline_projects_empty()}
        </p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each displayProjects as project (project.entityId)}
            {@const catalogProject = toProjectListItem(project)}
            {@const projectNextAction = getNextAction(catalogProject)}
            {@const openLoopCount = project.group.items.length}
            <button
              type="button"
              class="{projectCardClass} min-w-0 {project.status === 'someday' ? 'opacity-50' : ''}"
              onclick={() => {
                detailProject = catalogProject
                detailDialogOpen = true
              }}
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
            </button>
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

  <TimelineProjectDetailDialog
    bind:open={detailDialogOpen}
    project={detailProject}
    nextAction={detailNextAction}
    nextActionItem={detailNextActionItem}
    tasks={detailTasks}
    statusLabel={detailProject ? statusLabel(detailProject.status) : ''}
    {updatingEventId}
    onClose={() => {
      detailDialogOpen = false
      detailProject = null
    }}
    {onGoToTask}
    {onQuickAction}
    onAssignAgent={(task) => {
      assignAgentItem = task
      assignAgentOpen = true
    }}
    onEdit={() => {
      if (detailProject) {
        editProjectItem = detailProject
        editProjectOpen = true
      }
    }}
    onDelete={() => {
      if (detailProject) {
        confirmDismissProjectId = detailProject.entityId
        confirmDismissProjectLabel = detailProject.label
      }
    }}
  />

  <TimelineEditProjectDialog
    bind:open={editProjectOpen}
    onClose={() => {
      editProjectOpen = false
      editProjectItem = null
    }}
    onUpdated={onProjectUpdated}
    project={editProjectItem}
  />

  <TimelineProjectAssignDialog
    bind:open={assignProjectOpen}
    item={assignProjectItem}
    onClose={() => {
      assignProjectOpen = false
      assignProjectItem = null
    }}
    onAssigned={onProjectAssigned}
  />

  <TimelineAgentAssignDialog
    bind:open={assignAgentOpen}
    item={assignAgentItem}
    nested={detailDialogOpen}
    onClose={() => {
      assignAgentOpen = false
      assignAgentItem = null
    }}
    onAssigned={onAgentAssigned}
  />

  <AlertDialog.Root
    open={confirmDismissProjectId !== null}
    onOpenChange={(open) => {
      if (!open) {
        confirmDismissProjectId = null
        confirmDismissProjectLabel = null
      }
    }}
  >
    <AlertDialog.Content class="max-w-sm rounded-[4px]" data-testid="project-delete-confirm">
      <AlertDialog.Header>
        <AlertDialog.Title>{m.graph_timeline_delete_project_title()}</AlertDialog.Title>
        <AlertDialog.Description>
          {m.graph_timeline_delete_project_description({ name: confirmDismissProjectLabel ?? '' })}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel class="rounded-[4px]">{m.graph_dialog_cancel()}</AlertDialog.Cancel>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          class="rounded-[4px]"
          onclick={() => void confirmDismissProject()}
        >
          {m.graph_timeline_delete_project()}
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</div>
