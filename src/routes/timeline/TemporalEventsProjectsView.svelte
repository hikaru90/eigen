<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { CreateProjectResponse } from '../api/timeline/projects/+server';
	import type { ProjectListItem } from '$lib/server/memory/project-list';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import TimelineCreateProjectDialog from './TimelineCreateProjectDialog.svelte';
	import TimelineEditProjectDialog from './TimelineEditProjectDialog.svelte';
	import TimelineProjectDetailDialog from './TimelineProjectDetailDialog.svelte';
	import TimelineProjectAssignDialog from './TimelineProjectAssignDialog.svelte';
	import TimelineAgentAssignDialog from './TimelineAgentAssignDialog.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { subscribeThoughtSync } from '$lib/stores/thought-sync';

	type Props = {
		onGoToTask: (itemId: string) => void;
		allTasks: TemporalEventListItem[];
		onTaskUpdated?: (
			thoughtId?: string,
			projectEntityId?: string,
			projectLabel?: string
		) => void;
		orderBy?: 'ingest' | 'todo';
		sortDirection?: 'asc' | 'desc';
	};

	let { onGoToTask, allTasks, onTaskUpdated, orderBy = 'ingest', sortDirection = 'desc' }: Props = $props();

	type Phase =
		| { kind: 'loading' }
		| { kind: 'ready'; projects: ProjectListItem[] }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'loading' });
	let authorFilter = $state<'human' | 'all'>('human');
	let createDialogOpen = $state(false);
	let assignProjectOpen = $state(false);
	let assignProjectItem = $state<TemporalEventListItem | null>(null);
	let assignAgentOpen = $state(false);
	let assignAgentItem = $state<TemporalEventListItem | null>(null);
	let assignAgentSuccess = $state<string | null>(null);
	let editProjectOpen = $state(false);
	let editProjectItem = $state<ProjectListItem | null>(null);
	let detailDialogOpen = $state(false);
	let detailProject = $state<ProjectListItem | null>(null);

	async function loadProjects(options?: { silent?: boolean }) {
		const silent = options?.silent ?? phase.kind === 'ready';
		if (!silent) phase = { kind: 'loading' };
		try {
			const params = new URLSearchParams();
			params.set('author', authorFilter === 'human' ? 'user' : 'all');
			const res = await fetch(`/api/timeline/projects?${params.toString()}`);
			if (!res.ok) {
				const text = await res.text();
				console.error('[loadProjects] Failed to fetch projects:', res.status, text);
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as { projects: ProjectListItem[] };
			phase = { kind: 'ready', projects: body.projects };
		} catch (err) {
			console.error('[loadProjects] Error:', err);
			if (silent && phase.kind === 'ready') return;
			phase = {
				kind: 'error',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	function setAuthorFilter(next: 'human' | 'all') {
		if (authorFilter === next) return;
		authorFilter = next;
		void loadProjects({ silent: false });
	}

	onMount(() => {
		void loadProjects({ silent: false });

		return subscribeThoughtSync((message) => {
			const reloadProjects =
				message.type === 'refresh-all' ||
				(message.type === 'changed' && message.scope === 'global');
			if (reloadProjects) {
				void loadProjects({ silent: true });
			}
		});
	});

	function statusLabel(status: ProjectListItem['status']): string {
		if (status === 'someday') return m.graph_timeline_project_status_someday();
		if (status === 'completed') return m.graph_timeline_project_status_completed();
		if (status === 'dismissed') return 'Dismissed';
		return m.graph_timeline_project_status_active();
	}

	let confirmDismissProjectId = $state<string | null>(null);
	let confirmDismissProjectLabel = $state<string | null>(null);

	const tabEntryClass =
		'flex flex-col overflow-visible bg-white/20 p-0.5 backdrop-blur-sm brightness-105 dark:bg-card';
	const tabTriggerClass =
		'rounded-full px-3 py-2 text-black hover:text-black dark:text-foreground dark:hover:text-foreground';
	const filledPillClass =
		'h-auto shrink-0 rounded-full border border-black bg-black px-3 py-1 text-xs font-medium text-white hover:bg-black/90 dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground/90';
	const ghostPillClass =
		'h-auto shrink-0 gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground';

	function openProjectDetail(project: ProjectListItem) {
		detailProject = project;
		detailDialogOpen = true;
	}

	function closeProjectDetail() {
		detailDialogOpen = false;
		detailProject = null;
	}

	const detailNextAction = $derived(
		detailProject ? getNextAction(detailProject) : null
	);

	const detailNextActionItem = $derived(
		detailNextAction ? (allTasks.find((t) => t.id === detailNextAction.itemId) ?? null) : null
	);

	const detailTasks = $derived(
		detailProject
			? tasksForProject(detailProject).filter((t) => t.id !== detailNextAction?.itemId)
			: []
	);

	function requestDismissProject(entityId: string, label: string) {
		confirmDismissProjectId = entityId;
		confirmDismissProjectLabel = label;
	}

	function cancelDismissProject() {
		confirmDismissProjectId = null;
		confirmDismissProjectLabel = null;
	}

	async function confirmDismissProject() {
		if (!confirmDismissProjectId) return;
		const entityId = confirmDismissProjectId;
		confirmDismissProjectId = null;
		confirmDismissProjectLabel = null;
		try {
			const res = await fetch(`/api/timeline/projects/${entityId}/dismiss`, {
				method: 'POST'
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			if (detailProject?.entityId === entityId) {
				closeProjectDetail();
			}
			void loadProjects({ silent: true });
		} catch (err) {
			console.error('Failed to dismiss project', err);
		}
	}

	const activeProjectIds = $derived(
		phase.kind === 'ready' ? new Set(phase.projects.map((p) => p.entityId)) : new Set<string>()
	);

	const unassignedTasks = $derived(
		allTasks
			.filter((t) => t.projectEntityId === null || !activeProjectIds.has(t.projectEntityId))
			.sort((a, b) => {
				const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
				return sortDirection === 'asc' ? cmp : -cmp;
			})
	);

	/** Sort projects based on orderBy setting */
	const sortedProjects = $derived.by(() => {
		const projects = [...phase.projects];
		if (orderBy === 'ingest') {
			/** Sort by most recent task's createdAt */
			return projects.sort((a, b) => {
				const aTasks = tasksForProject(a);
				const bTasks = tasksForProject(b);
				const aLatest = aTasks.length > 0
					? Math.max(...aTasks.map((t) => new Date(t.createdAt).getTime()))
					: 0;
				const bLatest = bTasks.length > 0
					? Math.max(...bTasks.map((t) => new Date(t.createdAt).getTime()))
					: 0;
				const cmp = aLatest - bLatest;
				return sortDirection === 'asc' ? cmp : -cmp;
			});
		}
		/** For 'todo' order, keep default status-based sort */
		return projects;
	});

	function onProjectCreated(project: CreateProjectResponse) {
		if (phase.kind === 'ready' && (project.status === 'active' || project.status === 'someday')) {
			const alreadyListed = phase.projects.some((p) => p.entityId === project.entityId);
			if (!alreadyListed) {
				phase = {
					kind: 'ready',
					projects: [
						...phase.projects,
						{
							entityId: project.entityId,
							label: project.label,
							status: project.status,
							source: 'manual',
							nextAction: null,
							openTaskCount: 0
						}
					]
				};
			}
		}
		void loadProjects({ silent: true });
	}

	function openAssignProject(task: TemporalEventListItem) {
		assignProjectItem = task;
		assignProjectOpen = true;
	}

	function onProjectAssigned(payload: { thoughtId: string; projectEntityId: string; projectLabel: string }) {
		assignProjectOpen = false;
		assignProjectItem = null;
		onTaskUpdated?.(payload.thoughtId, payload.projectEntityId, payload.projectLabel);
	}

	function openAssignAgent(task: TemporalEventListItem) {
		assignAgentItem = task;
		assignAgentOpen = true;
	}

	function closeAssignAgent() {
		assignAgentOpen = false;
		assignAgentItem = null;
	}

	function onAgentAssigned(payload: { agentName: string }) {
		assignAgentSuccess = m.graph_timeline_assign_agent_success({ agent: payload.agentName });
		closeAssignAgent();
		onTaskUpdated?.();
	}

	function openEditProject(project: ProjectListItem) {
		editProjectItem = project;
		editProjectOpen = true;
	}

	function openEditFromDetail() {
		if (!detailProject) return;
		openEditProject(detailProject);
	}

	function requestDeleteFromDetail() {
		if (!detailProject) return;
		requestDismissProject(detailProject.entityId, detailProject.label);
	}

	function onProjectUpdated(updated?: { entityId: string; label: string }) {
		editProjectOpen = false;
		editProjectItem = null;
		if (detailProject && updated?.entityId === detailProject.entityId) {
			detailProject = { ...detailProject, label: updated.label };
		}
		void loadProjects({ silent: true });
	}

	function tasksForProject(project: ProjectListItem): TemporalEventListItem[] {
		return allTasks.filter((t) => t.projectEntityId === project.entityId);
	}

	/** Get the next action for a project: either the designated one or the earliest due task */
	function getNextAction(project: ProjectListItem): { summary: string; itemId: string } | null {
		if (project.nextAction) return project.nextAction;

		/** Find task with earliest startAt (due date) */
		const tasks = tasksForProject(project);
		const withDueDate = tasks
			.filter((t) => t.startAt)
			.sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime());

		if (withDueDate.length > 0) {
			const next = withDueDate[0];
			return {
				summary: next.semanticSummary,
				itemId: next.id
			};
		}

		/** Fall back to most recently created task */
		if (tasks.length > 0) {
			const sorted = [...tasks].sort(
				(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
			);
			return {
				summary: sorted[0].semanticSummary,
				itemId: sorted[0].id
			};
		}

		return null;
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
	{#if assignAgentSuccess}
		<p class="text-muted-foreground mb-2 px-0.5 text-xs">{assignAgentSuccess}</p>
	{/if}
	<div class="relative z-10 shrink-0 bg-background pb-2">
		<div class="flex flex-wrap items-center justify-between gap-2 pt-4 pb-2">
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{m.graph_timeline_projects_aria()}
				</h2>
				<div
					class="flex items-center gap-1 rounded-full border border-border/60 bg-background/80 p-0.5"
					role="group"
					aria-label={m.graph_timeline_projects_filter_aria()}
				>
					<button
						type="button"
						class={authorFilter === 'human' ? filledPillClass : ghostPillClass}
						onclick={() => setAuthorFilter('human')}
					>
						{m.graph_timeline_projects_filter_human()}
					</button>
					<button
						type="button"
						class={authorFilter === 'all' ? filledPillClass : ghostPillClass}
						onclick={() => setAuthorFilter('all')}
					>
						{m.graph_timeline_projects_filter_all()}
					</button>
				</div>
			</div>
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
			class="absolute inset-0 z-0 overflow-y-auto pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
		>
	{#if phase.kind === 'loading'}
		<div class="flex flex-col items-center justify-center gap-3 py-12">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">{m.graph_temporal_loading()}</p>
		</div>
	{:else if phase.kind === 'error'}
		<p class="text-destructive px-1 py-8 text-center text-sm">{phase.message}</p>
	{:else}
		{#if phase.projects.length === 0 && unassignedTasks.length === 0}
			<p class="text-muted-foreground px-1 py-8 text-center text-sm">{m.graph_timeline_projects_empty()}</p>
		{:else}
			<div class="flex flex-col gap-2">
			{#if phase.projects.length > 0}
				{#each sortedProjects as project (project.entityId)}
					{@const projectNextAction = getNextAction(project)}
					{@const openLoopCount =
						tasksForProject(project).length}
					<div
						class="{tabEntryClass} min-w-0 transition-opacity {project.status === 'someday' ? 'opacity-50' : ''}"
					>
						<div
							class="flex w-full min-w-0 items-start justify-between gap-2 {tabTriggerClass}"
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-foreground">{project.label}</p>
								<div
									class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
								>
									<span class="font-medium text-foreground">{statusLabel(project.status)}</span>
									{#if openLoopCount > 0}
										<span>
											{m.graph_timeline_project_open_loops({ count: openLoopCount })}
										</span>
									{/if}
									{#if projectNextAction}
										<span class="line-clamp-1">{projectNextAction.summary}</span>
									{/if}
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								class={ghostPillClass}
								onclick={() => openProjectDetail(project)}
							>
								{m.graph_timeline_open_project()}
							</Button>
						</div>
					</div>
				{/each}
			{/if}

			{#if unassignedTasks.length > 0}
				<div class="mt-2">
					<h3 class="mb-2 px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{m.graph_timeline_project_no_project()} ({unassignedTasks.length})
					</h3>
					<div class="flex flex-col gap-2">
						{#each unassignedTasks as task (task.id)}
							<div class="{tabEntryClass} min-w-0">
								<div
									class="flex w-full min-w-0 items-start justify-between gap-2 {tabTriggerClass}"
								>
									<button
										type="button"
										class="min-w-0 flex-1 text-left"
										onclick={() => onGoToTask(task.id)}
									>
										<p class="line-clamp-2 text-sm text-foreground">{task.semanticSummary}</p>
										{#if task.thoughtText !== task.semanticSummary}
											<p class="mt-1 line-clamp-1 text-xs text-muted-foreground">
												{task.thoughtText}
											</p>
										{/if}
									</button>
									<Button
										type="button"
										variant="ghost"
										class="h-auto shrink-0 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
										onclick={() => openAssignProject(task)}
									>
										Assign
									</Button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			</div>
		{/if}
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
		onClose={closeProjectDetail}
		onGoToTask={onGoToTask}
		onAssignAgent={openAssignAgent}
		onEdit={openEditFromDetail}
		onDelete={requestDeleteFromDetail}
	/>

	<TimelineEditProjectDialog
		bind:open={editProjectOpen}
		onClose={() => {
			editProjectOpen = false;
			editProjectItem = null;
		}}
		onUpdated={onProjectUpdated}
		project={editProjectItem}
	/>

	<TimelineProjectAssignDialog
		bind:open={assignProjectOpen}
		item={assignProjectItem}
		onClose={() => {
			assignProjectOpen = false;
			assignProjectItem = null;
		}}
		onAssigned={onProjectAssigned}
	/>

	<TimelineAgentAssignDialog
		bind:open={assignAgentOpen}
		item={assignAgentItem}
		onClose={closeAssignAgent}
		onAssigned={onAgentAssigned}
	/>

	{#if confirmDismissProjectId}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div class="bg-background mx-4 max-w-sm rounded-lg border p-4 shadow-lg">
				<h3 class="text-foreground text-sm font-medium">{m.graph_timeline_delete_project_title()}</h3>
				<p class="text-muted-foreground mt-2 text-sm">
					{m.graph_timeline_delete_project_description({ name: confirmDismissProjectLabel ?? '' })}
				</p>
				<div class="mt-4 flex justify-end gap-2">
					<Button variant="outline" size="sm" onclick={cancelDismissProject}>{m.graph_dialog_cancel()}</Button>
					<Button variant="destructive" size="sm" onclick={confirmDismissProject}>
						{m.graph_timeline_delete_project()}
					</Button>
				</div>
			</div>
		</div>
	{/if}
</div>
