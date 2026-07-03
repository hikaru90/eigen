<script lang="ts">
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages.js';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { AssignProjectResponse } from '../api/timeline/projects/assign/+server';
	import type { ProjectListItem } from '$lib/server/memory/project-list';

	type Props = {
		open: boolean;
		item: TemporalEventListItem | null;
		onClose: () => void;
		onAssigned: (payload: AssignProjectResponse & { thoughtId: string }) => void;
	};

	let { open = $bindable(false), item, onClose, onAssigned }: Props = $props();

	let projects = $state<ProjectListItem[]>([]);
	let projectsLoading = $state(false);
	let query = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let dragOverEntityId = $state<string | null>(null);

	async function loadProjects() {
		projectsLoading = true;
		error = null;
		try {
			const res = await fetch('/api/timeline/projects');
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}
			const body = (await res.json()) as { projects: ProjectListItem[] };
			projects = body.projects;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			projects = [];
		} finally {
			projectsLoading = false;
		}
	}

	$effect(() => {
		if (open) {
			query = '';
			error = null;
			void loadProjects();
		}
	});

	const normalizedQuery = $derived(query.trim().toLowerCase());

	const filteredProjects = $derived(
		normalizedQuery
			? projects.filter((p) => p.label.toLowerCase().includes(normalizedQuery))
			: projects
	);

	const exactProjectMatch = $derived(
		normalizedQuery
			? projects.some((p) => p.label.trim().toLowerCase() === normalizedQuery)
			: false
	);

	const showCreateOption = $derived(Boolean(query.trim()) && !exactProjectMatch);

	async function assignToProject(
		target: { projectEntityId: string } | { projectLabel: string }
	) {
		if (!item || busy) return;
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/timeline/projects/assign', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					thoughtId: item.thoughtId,
					...('projectEntityId' in target
						? { projectEntityId: target.projectEntityId }
						: { projectLabel: target.projectLabel })
				})
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}
			const body = (await res.json()) as AssignProjectResponse;
			onAssigned({ thoughtId: item.thoughtId, ...body });
			open = false;
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
			dragOverEntityId = null;
		}
	}

	function onDialogOpenChange(next: boolean) {
		open = next;
		if (!next) onClose();
	}

	function onDropProject(entityId: string) {
		void assignToProject({ projectEntityId: entityId });
	}
</script>

<Dialog.Root {open} onOpenChange={onDialogOpenChange}>
	<Dialog.Content
		class="fixed inset-x-0 bottom-0 top-auto flex max-h-[min(85vh,28rem)] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-xl border p-0 shadow-lg sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[min(90vh,32rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-0"
	>
		<div class="border-border shrink-0 border-b px-4 py-3">
			<Dialog.Title class="text-base font-semibold">{m.graph_timeline_assign_project()}</Dialog.Title>
			{#if item}
				<Dialog.Description class="text-muted-foreground mt-1 line-clamp-2 text-xs">
					{item.semanticSummary}
				</Dialog.Description>
			{/if}
		</div>

		{#if item}
			<div
				class="border-border bg-muted/20 flex shrink-0 items-center gap-2 border-b px-4 py-2"
				draggable="true"
				ondragstart={(e) => {
					e.dataTransfer?.setData('text/plain', item.thoughtId);
					e.dataTransfer!.effectAllowed = 'move';
				}}
			>
				<GripVerticalIcon class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
				<p class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
					{m.graph_timeline_assign_project_drag_hint()}
				</p>
			</div>
		{/if}

		<div class="shrink-0 px-4 py-3">
			<Input
				type="search"
				placeholder={m.graph_timeline_assign_project_search()}
				bind:value={query}
				class="h-9 font-mono text-xs"
				disabled={busy}
				onkeydown={(e) => {
					if (e.key === 'Enter' && showCreateOption) {
						e.preventDefault();
						void assignToProject({ projectLabel: query.trim() });
					}
				}}
			/>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
			{#if projectsLoading}
				<div class="flex items-center justify-center gap-2 py-8">
					<LoaderCircleIcon class="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
					<span class="text-muted-foreground text-xs">{m.graph_temporal_loading()}</span>
				</div>
			{:else if error && projects.length === 0}
				<p class="text-destructive px-2 py-4 text-center text-xs">{error}</p>
			{:else}
				{#if showCreateOption}
					<button
						type="button"
						class="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
						disabled={busy}
						onclick={() => assignToProject({ projectLabel: query.trim() })}
					>
						<FolderKanbanIcon class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
						<span>{m.graph_timeline_assign_project_create({ name: query.trim() })}</span>
					</button>
				{/if}

				{#if filteredProjects.length === 0 && !showCreateOption}
					<p class="text-muted-foreground px-3 py-6 text-center text-xs">
						{m.graph_timeline_projects_empty()}
					</p>
				{:else}
					<ul class="space-y-0.5">
						{#each filteredProjects as project (project.entityId)}
							<li>
								<button
									type="button"
									class="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors {dragOverEntityId ===
									project.entityId
										? 'bg-muted ring-primary/40 ring-1'
										: ''} {item?.projectLabel === project.label ? 'opacity-60' : ''}"
									disabled={busy}
									ondragover={(e) => {
										e.preventDefault();
										dragOverEntityId = project.entityId;
									}}
									ondragleave={() => {
										if (dragOverEntityId === project.entityId) dragOverEntityId = null;
									}}
									ondrop={(e) => {
										e.preventDefault();
										onDropProject(project.entityId);
									}}
									onclick={() => assignToProject({ projectEntityId: project.entityId })}
								>
									<FolderKanbanIcon class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
									<span class="min-w-0 flex-1 truncate text-sm font-medium">{project.label}</span>
									{#if project.openTaskCount > 0}
										<span class="text-muted-foreground font-mono text-[10px] tabular-nums">
											{project.openTaskCount}
										</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}

			{#if error && projects.length > 0}
				<p class="text-destructive px-3 pt-2 text-xs">{error}</p>
			{/if}
		</div>

		<div class="border-border shrink-0 border-t px-4 py-3">
			<Button type="button" variant="outline" class="h-9 w-full text-xs" onclick={() => onDialogOpenChange(false)}>
				{m.graph_temporal_cancel()}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
