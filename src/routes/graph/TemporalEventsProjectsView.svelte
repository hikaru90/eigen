<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { ProjectListItem } from '../../api/timeline/projects/+server';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { m } from '$lib/paraglide/messages.js';

	type Props = {
		selectedItemId: string | null;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let { selectedItemId, onSelect, onQuickAction }: Props = $props();

	type Phase =
		| { kind: 'loading' }
		| { kind: 'ready'; projects: ProjectListItem[] }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'loading' });

	async function loadProjects() {
		phase = { kind: 'loading' };
		try {
			const res = await fetch('/api/timeline/projects');
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as { projects: ProjectListItem[] };
			phase = { kind: 'ready', projects: body.projects };
		} catch (err) {
			phase = {
				kind: 'error',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	onMount(() => {
		void loadProjects();
	});

	function statusLabel(status: ProjectListItem['status']): string {
		if (status === 'someday') return m.graph_timeline_project_status_someday();
		if (status === 'completed') return m.graph_timeline_project_status_completed();
		return m.graph_timeline_project_status_active();
	}

	function selectNextAction(project: ProjectListItem) {
		if (!project.nextAction) return;
		onSelect({
			id: project.nextAction.itemId,
			itemType: 'open_loop',
			kind: 'reminder',
			semanticSummary: project.nextAction.summary,
			sourceTextSpan: null,
			timePrecision: 'fuzzy',
			timezone: 'UTC',
			isAllDay: false,
			confidence: 1,
			startAt: null,
			endAt: null,
			activePeriod: '',
			graphSyncStatus: 'n/a',
			graphSyncError: null,
			lifecycleStatus: 'open',
			snoozedUntil: null,
			recurrenceRule: null,
			durationMinutes: null,
			energyLevel: null,
			priorityQuadrant: null,
			contextTags: [],
			focusRank: null,
			parentEventId: null,
			thoughtId: project.nextAction.thoughtId,
			thoughtText: project.nextAction.summary,
			thoughtCategory: 'task',
			thoughtStatus: 'open',
			memoryType: 'open_loop',
			projectLabel: project.label,
			createdAt: new Date().toISOString()
		});
	}
</script>

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
				<li class="px-4 py-3">
					<div class="flex items-start justify-between gap-2">
						<h3 class="text-foreground text-sm font-medium">{project.label}</h3>
						<span
							class="text-muted-foreground shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
						>
							{statusLabel(project.status)}
						</span>
					</div>
					{#if project.nextAction}
						<button
							type="button"
							class="hover:bg-muted/40 mt-2 w-full rounded-lg border border-border px-3 py-2 text-left transition-colors {selectedItemId ===
							project.nextAction.itemId
								? 'bg-muted/50 ring-primary/40 ring-1'
								: ''}"
							onclick={() => selectNextAction(project)}
						>
							<p class="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">
								{m.graph_timeline_project_next_action()}
							</p>
							<p class="text-foreground mt-0.5 text-sm">{project.nextAction.summary}</p>
						</button>
					{:else if project.status === 'active'}
						<p class="text-muted-foreground mt-2 text-xs">{m.graph_timeline_project_no_next_action()}</p>
					{/if}
					{#if project.openLoopCount > 1}
						<p class="text-muted-foreground mt-1.5 font-mono text-[10px]">
							{m.graph_timeline_project_open_loops({ count: project.openLoopCount })}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
