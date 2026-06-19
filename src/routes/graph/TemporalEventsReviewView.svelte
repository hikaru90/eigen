<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { ProjectListItem } from '$lib/server/memory/project-list';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { REVIEW_STEP_COUNT } from './temporal-events-utils';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventsWeekView from './TemporalEventsWeekView.svelte';
	import TemporalEventsMatrixView from './TemporalEventsMatrixView.svelte';
	import TemporalTimelineNudge from './TemporalTimelineNudge.svelte';

	type Stats = {
		overdueCount: number;
		todoTodayCount: number;
		doneTodayCount: number;
	};

	type Props = {
		items: TemporalEventListItem[];
		selectedItemId: string | null;
		updatingEventId?: string | null;
		timeZone: string;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
		onReschedule: (eventId: string, startAt: string, endAt: string) => void;
		onGoToOverdue: () => void;
	};

	let {
		items,
		selectedItemId,
		updatingEventId = null,
		timeZone,
		onSelect,
		onQuickAction,
		onReschedule,
		onGoToOverdue
	}: Props = $props();

	let stats = $state<Stats | null>(null);
	let projects = $state<ProjectListItem[]>([]);
	let loading = $state(true);
	let activeStep = $state(0);
	let completedSteps = $state<Set<number>>(new Set());

	const steps = $derived([
		{ id: 0, title: m.graph_timeline_review_step_overdue(), key: 'overdue' },
		{ id: 1, title: m.graph_timeline_review_step_projects(), key: 'projects' },
		{ id: 2, title: m.graph_timeline_review_step_calendar(), key: 'calendar' },
		{ id: 3, title: m.graph_timeline_review_step_prioritize(), key: 'prioritize' },
		{ id: 4, title: m.graph_timeline_review_step_someday(), key: 'someday' },
		{ id: 5, title: m.graph_timeline_review_step_intentions(), key: 'intentions' }
	]);

	const missingNextActionProjects = $derived(
		projects.filter((p) => p.status === 'active' && !p.nextAction)
	);
	const somedayProjects = $derived(projects.filter((p) => p.status === 'someday'));
	const activeProjectCount = $derived(projects.filter((p) => p.status === 'active').length);

	const progressLabel = $derived(
		m.graph_timeline_review_progress({
			current: completedSteps.size,
			total: REVIEW_STEP_COUNT
		})
	);

	const progressPct = $derived((completedSteps.size / REVIEW_STEP_COUNT) * 100);

	async function loadReviewData() {
		loading = true;
		try {
			const [statsRes, projectsRes] = await Promise.all([
				fetch('/api/timeline/stats'),
				fetch('/api/timeline/projects')
			]);
			if (statsRes.ok) stats = (await statsRes.json()) as Stats;
			if (projectsRes.ok) {
				const body = (await projectsRes.json()) as { projects: ProjectListItem[] };
				projects = body.projects;
			}
		} catch {
			// ignore
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadReviewData();
	});

	function toggleStep(stepId: number) {
		activeStep = activeStep === stepId ? -1 : stepId;
	}

	function markComplete(stepId: number) {
		completedSteps = new Set([...completedSteps, stepId]);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<div class="border-border shrink-0 border-b px-3 py-2">
		<div class="mb-2 flex items-center justify-between gap-2">
			<p class="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">{progressLabel}</p>
		</div>
		<div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
			<div
				class="bg-foreground h-full rounded-full transition-all duration-300"
				style="width: {progressPct}%"
				role="progressbar"
				aria-valuenow={completedSteps.size}
				aria-valuemin={0}
				aria-valuemax={REVIEW_STEP_COUNT}
			></div>
		</div>
		{#if loading}
			<p class="text-muted-foreground mt-2 text-xs">{m.graph_temporal_loading()}</p>
		{:else if stats}
			<div class="mt-2 grid grid-cols-3 gap-2">
				<div class="border-border rounded-md border px-2 py-1.5 text-center">
					<p class="text-foreground text-base font-semibold tabular-nums">{stats.overdueCount}</p>
					<p class="text-muted-foreground text-[9px] uppercase">{m.graph_timeline_pill_overdue()}</p>
				</div>
				<div class="border-border rounded-md border px-2 py-1.5 text-center">
					<p class="text-foreground text-base font-semibold tabular-nums">{activeProjectCount}</p>
					<p class="text-muted-foreground text-[9px] uppercase">{m.graph_timeline_projects()}</p>
				</div>
				<div class="border-border rounded-md border px-2 py-1.5 text-center">
					<p class="text-foreground text-base font-semibold tabular-nums">{somedayProjects.length}</p>
					<p class="text-muted-foreground text-[9px] uppercase">
						{m.graph_timeline_project_status_someday()}
					</p>
				</div>
			</div>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto pb-4">
		<ol class="divide-border divide-y">
			{#each steps as step (step.id)}
				<li>
					<button
						type="button"
						class="hover:bg-muted/30 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
						aria-expanded={activeStep === step.id}
						onclick={() => toggleStep(step.id)}
					>
						<span class="mt-0.5 shrink-0">
							{#if completedSteps.has(step.id)}
								<CheckIcon class="text-teal-500 size-4" aria-hidden="true" />
							{:else}
								<CircleIcon class="text-muted-foreground size-4" aria-hidden="true" />
							{/if}
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-foreground text-sm font-medium">{step.title}</p>
							{#if step.key === 'overdue' && stats}
								<p class="text-muted-foreground mt-0.5 text-xs">
									{stats.overdueCount > 0
										? m.graph_timeline_review_overdue_hint({ count: stats.overdueCount })
										: m.graph_timeline_overdue_empty()}
								</p>
							{:else if step.key === 'projects'}
								<p class="text-muted-foreground mt-0.5 text-xs">
									{missingNextActionProjects.length > 0
										? m.graph_timeline_review_projects_hint({
												count: missingNextActionProjects.length
											})
										: m.graph_timeline_review_projects_ok()}
								</p>
							{:else if step.key === 'someday'}
								<p class="text-muted-foreground mt-0.5 text-xs">
									{m.graph_timeline_review_someday_hint({ count: somedayProjects.length })}
								</p>
							{/if}
						</div>
					</button>

					{#if activeStep === step.id}
						<div class="border-border border-t px-4 pb-4">
							{#if step.key === 'overdue'}
								{#if stats && stats.overdueCount > 0}
									<button
										type="button"
										class="text-foreground mt-2 text-sm underline"
										onclick={() => {
											onGoToOverdue();
											markComplete(step.id);
										}}
									>
										{m.graph_timeline_review_go_overdue()}
									</button>
								{:else}
									<button
										type="button"
										class="text-muted-foreground mt-2 text-xs underline"
										onclick={() => markComplete(step.id)}
									>
										{m.graph_timeline_review_mark_done()}
									</button>
								{/if}
							{:else if step.key === 'projects'}
								{#if missingNextActionProjects.length > 0}
									<ul class="mt-2 space-y-2">
										{#each missingNextActionProjects as project (project.entityId)}
											<li class="text-destructive/90 text-sm">{project.label}</li>
										{/each}
									</ul>
								{/if}
								<button
									type="button"
									class="text-muted-foreground mt-2 text-xs underline"
									onclick={() => markComplete(step.id)}
								>
									{m.graph_timeline_review_mark_done()}
								</button>
							{:else if step.key === 'calendar'}
								<div class="mt-2 max-h-72 overflow-hidden rounded-md border">
									<TemporalEventsWeekView
										{items}
										{selectedItemId}
										{timeZone}
										onSelect={onSelect}
										{onReschedule}
									/>
								</div>
								<button
									type="button"
									class="text-muted-foreground mt-2 text-xs underline"
									onclick={() => markComplete(step.id)}
								>
									{m.graph_timeline_review_mark_done()}
								</button>
							{:else if step.key === 'prioritize'}
								<div class="mt-2 max-h-72 overflow-hidden rounded-md border">
									<TemporalEventsMatrixView
										{items}
										{selectedItemId}
										{updatingEventId}
										onSelect={onSelect}
										{onQuickAction}
									/>
								</div>
								<button
									type="button"
									class="text-muted-foreground mt-2 text-xs underline"
									onclick={() => markComplete(step.id)}
								>
									{m.graph_timeline_review_mark_done()}
								</button>
							{:else if step.key === 'someday'}
								{#if somedayProjects.length > 0}
									<ul class="mt-2 space-y-1 opacity-60">
										{#each somedayProjects as project (project.entityId)}
											<li class="text-muted-foreground text-sm">{project.label}</li>
										{/each}
									</ul>
								{:else}
									<p class="text-muted-foreground mt-2 text-xs">{m.graph_timeline_review_someday_empty()}</p>
								{/if}
								<button
									type="button"
									class="text-muted-foreground mt-2 text-xs underline"
									onclick={() => markComplete(step.id)}
								>
									{m.graph_timeline_review_mark_done()}
								</button>
							{:else if step.key === 'intentions'}
								<div class="mt-2">
									<TemporalTimelineNudge onAccept={onReschedule} />
								</div>
								<button
									type="button"
									class="text-muted-foreground mt-2 text-xs underline"
									onclick={() => markComplete(step.id)}
								>
									{m.graph_timeline_review_mark_done()}
								</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ol>

		{#if loading}
			<div class="flex justify-center py-8">
				<LoaderCircleIcon class="text-muted-foreground size-5 animate-spin" aria-hidden="true" />
			</div>
		{/if}
	</div>
</div>
