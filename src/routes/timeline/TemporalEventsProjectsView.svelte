<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { ProjectListItem } from '$lib/server/memory/project-list';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import TimelineCreateProjectDialog from './TimelineCreateProjectDialog.svelte';
	import TimelineEditProjectDialog from './TimelineEditProjectDialog.svelte';
	import TimelineProjectAssignDialog from './TimelineProjectAssignDialog.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { subscribeThoughtSync } from '$lib/stores/thought-sync';
	import XIcon from '@lucide/svelte/icons/x';
	import PencilIcon from '@lucide/svelte/icons/pencil';

	type Props = {
		onGoToTask: (itemId: string) => void;
		allTasks: TemporalEventListItem[];
		onTaskUpdated?: () => void;
	};

	let { onGoToTask, allTasks, onTaskUpdated }: Props = $props();

	type Phase =
		| { kind: 'loading' }
		| { kind: 'ready'; projects: ProjectListItem[] }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'loading' });
	let createDialogOpen = $state(false);
	let assignProjectOpen = $state(false);
	let assignProjectItem = $state<TemporalEventListItem | null>(null);
	let editProjectOpen = $state(false);
	let editProjectItem = $state<ProjectListItem | null>(null);

	async function loadProjects(options?: { silent?: boolean }) {
		const silent = options?.silent ?? phase.kind === 'ready';
		if (!silent) phase = { kind: 'loading' };
		try {
			const res = await fetch('/api/timeline/projects');
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as { projects: ProjectListItem[] };
			phase = { kind: 'ready', projects: body.projects };
		} catch (err) {
			if (silent && phase.kind === 'ready') return;
			phase = {
				kind: 'error',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	onMount(() => {
		void loadProjects({ silent: false });

		return subscribeThoughtSync(() => {
			void loadProjects({ silent: true });
		});
	});

	function statusLabel(status: ProjectListItem['status']): string {
		if (status === 'someday') return m.graph_timeline_project_status_someday();
		if (status === 'completed') return m.graph_timeline_project_status_completed();
		if (status === 'dismissed') return 'Dismissed';
		return m.graph_timeline_project_status_active();
	}

	async function dismissProject(entityId: string) {
		try {
			const res = await fetch(`/api/timeline/projects/${entityId}/dismiss`, {
				method: 'POST'
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			void loadProjects({ silent: true });
		} catch (err) {
			console.error('Failed to dismiss project', err);
		}
	}

	function needsHealthWarning(project: ProjectListItem): boolean {
		return project.status === 'active' && project.nextAction == null;
	}

	const unassignedTasks = $derived(
		allTasks
			.filter((t) => t.projectLabel === null)
			.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
	);

	function onProjectCreated() {
		void loadProjects();
	}

	function openAssignProject(task: TemporalEventListItem) {
		assignProjectItem = task;
		assignProjectOpen = true;
	}

	function onProjectAssigned() {
		assignProjectOpen = false;
		assignProjectItem = null;
		onTaskUpdated?.();
	}

	function openEditProject(project: ProjectListItem) {
		editProjectItem = project;
		editProjectOpen = true;
	}

	function onProjectUpdated() {
		editProjectOpen = false;
		editProjectItem = null;
		void loadProjects({ silent: true });
	}

	function tasksForProject(project: ProjectListItem): TemporalEventListItem[] {
		return allTasks.filter((t) => t.projectLabel === project.label);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<div class="border-border flex shrink-0 items-center justify-end border-b px-3 py-2">
		<Button
			type="button"
			variant="outline"
			size="sm"
			class="h-8 gap-1.5 text-xs"
			onclick={() => (createDialogOpen = true)}
		>
			<PlusIcon class="size-3.5" aria-hidden="true" />
			{m.graph_timeline_create_project()}
		</Button>
	</div>

	<div
		class="min-h-0 flex-1 overflow-y-auto pb-4"
		role="listbox"
		aria-label={m.graph_timeline_projects_aria()}
	>
	{#if phase.kind === 'loading'}
		<div class="flex flex-col items-center justify-center gap-3 py-12">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">{m.graph_temporal_loading()}</p>
		</div>
	{:else if phase.kind === 'error'}
		<p class="text-destructive px-4 py-8 text-center text-sm">{phase.message}</p>
	{:else if phase.projects.length === 0}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_projects_empty()}</p>
	{:else}
		<ul class="divide-border divide-y">
			{#each phase.projects as project (project.entityId)}
				<li
					class="px-4 py-3 transition-opacity {project.status === 'someday' ? 'opacity-50' : ''}"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="flex min-w-0 items-center gap-2">
							{#if needsHealthWarning(project)}
								<span
									class="bg-destructive size-2 shrink-0 rounded-full"
									title={m.graph_timeline_project_no_next_action()}
									aria-hidden="true"
								></span>
							{/if}
							<h3 class="text-foreground truncate text-sm font-medium">{project.label}</h3>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<span
								class="text-muted-foreground rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
							>
								{statusLabel(project.status)}
							</span>
							{#if project.status === 'active'}
								<Button
									variant="ghost"
									size="icon"
									class="size-6 shrink-0 text-muted-foreground hover:text-destructive"
									title="Dismiss project"
									onclick={() => dismissProject(project.entityId)}
								>
									<XIcon class="size-3" aria-hidden="true" />
								</Button>
							{/if}
							<Button
								variant="ghost"
								size="icon"
								class="size-6 shrink-0 text-muted-foreground hover:text-foreground"
								title="Edit project name"
								onclick={() => openEditProject(project)}
							>
								<PencilIcon class="size-3" aria-hidden="true" />
							</Button>
						</div>
					</div>
					{#if project.nextAction}
						<button
							type="button"
							class="hover:bg-muted/40 mt-2 w-full rounded-lg border border-border px-3 py-2 text-left transition-colors"
							onclick={() => onGoToTask(project.nextAction!.itemId)}
						>
							<p class="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">
								{m.graph_timeline_project_next_action()}
							</p>
							<p class="text-foreground mt-0.5 text-sm">{project.nextAction.summary}</p>
						</button>
					{:else if project.status === 'active'}
						<p class="text-destructive/90 mt-2 text-xs">{m.graph_timeline_project_no_next_action()}</p>
					{/if}
					{#if project.openLoopCount > 1}
						<p class="text-muted-foreground mt-1.5 font-mono text-[10px]">
							{m.graph_timeline_project_open_loops({ count: project.openLoopCount })}
						</p>
					{/if}
					{@const projectTasks = tasksForProject(project)}
					{#if projectTasks.length > 0}
						<div class="mt-2 space-y-1">
							{#each projectTasks as task (task.id)}
								<button
									type="button"
									class="hover:bg-muted/40 w-full rounded border border-border/50 px-2 py-1.5 text-left transition-colors"
									onclick={() => onGoToTask(task.id)}
								>
									<p class="text-foreground truncate text-xs">{task.semanticSummary}</p>
								</button>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		{#if unassignedTasks.length > 0}
			<div class="mt-4">
				<h3 class="text-muted-foreground mb-2 px-4 font-mono text-[10px] uppercase tracking-wide">
					{m.graph_timeline_project_no_project()} ({unassignedTasks.length})
				</h3>
				<ul class="divide-border divide-y">
					{#each unassignedTasks as task (task.id)}
						<li class="px-4 py-2">
							<div class="flex items-start justify-between gap-2">
								<button
								type="button"
								class="min-w-0 flex-1 text-left"
								onclick={() => onGoToTask(task.id)}
							>
								<p class="text-foreground truncate text-sm">{task.semanticSummary}</p>
								{#if task.thoughtText !== task.semanticSummary}
									<p class="text-muted-foreground truncate text-xs">{task.thoughtText}</p>
								{/if}
							</button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 shrink-0 text-[10px]"
								onclick={() => openAssignProject(task)}
							>
								Assign
							</Button>
						</div>
					</li>
				{/each}
			</ul>
			</div>
		{/if}
	{/if}
	</div>

	<TimelineCreateProjectDialog
		bind:open={createDialogOpen}
		onClose={() => (createDialogOpen = false)}
		onCreated={onProjectCreated}
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
</div>
