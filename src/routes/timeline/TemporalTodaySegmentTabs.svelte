<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { NowSegment } from './temporal-events-utils';

	type Stats = {
		todoTodayCount: number;
		doneTodayCount: number;
		overdueCount: number;
	};

	type TimelineSegmentTabCounts = {
		todo: number;
		done: number;
		overdue: number;
	};

	type TimelineSegmentNavState = {
		segment: NowSegment;
		tabCounts: TimelineSegmentTabCounts;
		statsRefreshKey: number;
		onSegmentChange: (segment: NowSegment) => void;
	};

	type Props = {
		nav: TimelineSegmentNavState;
	};

	let { nav }: Props = $props();

	let stats = $state<Stats | null>(null);

	async function loadStats() {
		try {
			const res = await fetch('/api/timeline/stats');
			if (!res.ok) return;
			stats = (await res.json()) as Stats;
		} catch {
			// ignore
		}
	}

	$effect(() => {
		void nav.statsRefreshKey;
		void loadStats();
	});

	const resolvedTabCounts = $derived(
		stats
			? {
					todo: stats.todoTodayCount,
					done: stats.doneTodayCount,
					overdue: stats.overdueCount
				}
			: nav.tabCounts
	);

	const todayTabItems = $derived([
		{
			segment: 'todo' as const,
			count: resolvedTabCounts.todo,
			label: m.graph_timeline_pill_todo(),
			countClass: 'text-black dark:text-foreground'
		},
		{
			segment: 'done' as const,
			count: resolvedTabCounts.done,
			label: m.graph_timeline_pill_done(),
			countClass: 'text-green-600 dark:text-green-500'
		},
		{
			segment: 'overdue' as const,
			count: resolvedTabCounts.overdue,
			label: m.graph_timeline_pill_overdue(),
			countClass:
				resolvedTabCounts.overdue > 0
					? 'text-destructive'
					: 'text-black dark:text-foreground'
		}
	] as const);
</script>

<div
	class="border-border grid w-full grid-cols-3 border"
	role="tablist"
	aria-label={m.graph_timeline_tasks_segments_aria()}
>
	{#each todayTabItems as tab, index (tab.segment)}
		<button
			type="button"
			role="tab"
			aria-selected={nav.segment === tab.segment}
			class="border-border px-1.5 py-1 text-center {index < todayTabItems.length - 1
				? 'border-r'
				: ''} {nav.segment === tab.segment
				? 'bg-black text-white dark:bg-foreground dark:text-background'
				: 'bg-muted/20 text-black hover:bg-muted/40 dark:text-foreground'}"
			onclick={() => nav.onSegmentChange(tab.segment)}
		>
			<p
				class="text-sm font-semibold tabular-nums leading-none {nav.segment === tab.segment
					? 'text-white dark:text-background'
					: tab.countClass}"
			>
				{tab.count > 0 || tab.segment !== 'overdue' ? tab.count : '—'}
			</p>
			<p
				class="mt-0.5 text-[8px] uppercase tracking-wide {nav.segment === tab.segment
					? 'text-white/80 dark:text-background/80'
					: 'text-black dark:text-foreground'}"
			>
				{tab.label}
			</p>
		</button>
	{/each}
</div>
