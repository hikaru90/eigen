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
	class="grid w-full grid-cols-3 rounded-2xl border border-white/80 bg-white/5 p-0.5 dark:border-white/20 dark:bg-white/5"
	role="tablist"
	aria-label={m.graph_timeline_tasks_segments_aria()}
>
	{#each todayTabItems as tab (tab.segment)}
		<button
			type="button"
			role="tab"
			aria-selected={nav.segment === tab.segment}
			class="flex flex-col items-center justify-center bg-transparent px-1.5 py-1 text-center transition-opacity hover:opacity-80 {nav.segment ===
			tab.segment
				? 'opacity-100'
				: 'opacity-60'}"
			onclick={() => nav.onSegmentChange(tab.segment)}
		>
			<p
				class="text-base font-semibold tabular-nums leading-none {nav.segment === tab.segment
					? 'text-foreground'
					: tab.countClass}"
			>
				{tab.count > 0 || tab.segment !== 'overdue' ? tab.count : '—'}
			</p>
			<p
				class="text-foreground mt-0.5 text-[10px] uppercase tracking-wide {nav.segment === tab.segment
					? 'font-medium'
					: 'font-normal'}"
			>
				{tab.label}
			</p>
		</button>
	{/each}
</div>
