<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages.js';
	import { graphIntlLocale, graphUsesHour12 } from '$lib/graph/graph-i18n';
	import type { TimelineShellView, TodaySegment } from './temporal-events-utils';

	type Stats = {
		todoTodayCount: number;
		doneTodayCount: number;
		overdueCount: number;
		estimatedMinutesToday: number;
	};

	type TabCounts = {
		todo: number;
		done: number;
		overdue: number;
	};

	type Props = {
		shellView: TimelineShellView;
		todaySegment: TodaySegment;
		taskCount: number;
		estimatedMinutes: number;
		timeZone: string;
		tabCounts?: TabCounts | null;
		lastRefreshedAt?: Date | null;
		refreshBusy?: boolean;
		statsRefreshKey?: number;
		onRefresh?: () => void;
		onTodaySegmentChange?: (segment: TodaySegment) => void;
	};

	let {
		shellView,
		todaySegment,
		taskCount,
		estimatedMinutes,
		timeZone,
		tabCounts = null,
		lastRefreshedAt = null,
		refreshBusy = false,
		statsRefreshKey = 0,
		onRefresh,
		onTodaySegmentChange
	}: Props = $props();

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
		void statsRefreshKey;
		void loadStats();
	});

	const now = $derived(new Date());

	const currentDateTime = $derived(
		new Intl.DateTimeFormat(graphIntlLocale(), {
			timeZone,
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: graphUsesHour12()
		}).format(now)
	);

	const standLabel = $derived(
		lastRefreshedAt
			? m.graph_timeline_stand({
					time: new Intl.DateTimeFormat(graphIntlLocale(), {
						timeZone,
						hour: '2-digit',
						minute: '2-digit',
						second: '2-digit',
						hour12: graphUsesHour12()
					}).format(lastRefreshedAt)
				})
			: null
	);

	const title = $derived(
		shellView === 'today'
			? todaySegment === 'done'
				? m.graph_timeline_today_done_title()
				: todaySegment === 'overdue'
					? m.graph_timeline_today_overdue_title()
					: m.graph_timeline_today()
			: shellView === 'upcoming'
				? m.graph_timeline_upcoming()
				: shellView === 'projects'
					? m.graph_timeline_projects()
					: shellView === 'week'
						? m.graph_timeline_week()
						: shellView === 'agenda'
							? m.graph_temporal_agenda()
							: m.graph_timeline_matrix()
	);

	const subtitle = $derived(
		m.graph_timeline_meta_tasks({ count: taskCount }) +
			' · ' +
			m.graph_timeline_meta_hours({ hours: Math.round((estimatedMinutes / 60) * 10) / 10 })
	);

	const showTodayTabs = $derived(shellView === 'today' && onTodaySegmentChange != null);

	const resolvedTabCounts = $derived(
		stats
			? {
					todo: stats.todoTodayCount,
					done: stats.doneTodayCount,
					overdue: stats.overdueCount
				}
			: (tabCounts ?? { todo: 0, done: 0, overdue: 0 })
	);

	const todayTabItems = $derived([
		{
			segment: 'todo' as const,
			count: resolvedTabCounts.todo,
			label: m.graph_timeline_pill_todo(),
			countClass: 'text-foreground'
		},
		{
			segment: 'done' as const,
			count: resolvedTabCounts.done,
			label: m.graph_timeline_pill_done(),
			countClass: 'text-green-500'
		},
		{
			segment: 'overdue' as const,
			count: resolvedTabCounts.overdue,
			label: m.graph_timeline_pill_overdue(),
			countClass: resolvedTabCounts.overdue > 0 ? 'text-destructive' : 'text-muted-foreground'
		}
	] as const);
</script>

<header class="border-border shrink-0 border-b px-3 pb-2 pt-1.5">
	<div class="flex items-center justify-between gap-2">
		<div class="min-w-0">
			<p class="text-foreground font-mono text-xs tabular-nums leading-tight">{currentDateTime}</p>
			{#if standLabel}
				<p class="text-muted-foreground mt-0.5 font-mono text-[10px] tabular-nums leading-tight">
					{standLabel}
				</p>
			{/if}
		</div>
		{#if onRefresh}
			<Button
				type="button"
				variant="outline"
				size="icon"
				class="size-7 shrink-0"
				title={m.graph_temporal_refresh()}
				disabled={refreshBusy}
				onclick={() => onRefresh()}
			>
				<RefreshCwIcon
					class="size-3.5 {refreshBusy ? 'animate-spin' : ''}"
					aria-hidden="true"
				/>
				<span class="sr-only">{m.graph_temporal_refresh()}</span>
			</Button>
		{/if}
	</div>

	<div class="mt-1.5">
		<h2 class="text-foreground text-lg font-semibold leading-tight tracking-tight">{title}</h2>
		<p class="text-muted-foreground mt-0.5 text-[11px] leading-tight">{subtitle}</p>
	</div>

	{#if showTodayTabs}
		<div
			class="mt-2 grid grid-cols-3 gap-1.5"
			role="tablist"
			aria-label={m.graph_timeline_today_segments_aria()}
		>
			{#each todayTabItems as tab (tab.segment)}
				<button
					type="button"
					role="tab"
					aria-selected={todaySegment === tab.segment}
					class="border-border rounded-lg border px-2 py-1.5 text-center transition-colors {todaySegment ===
					tab.segment
						? 'bg-muted/50 ring-primary/40 ring-1'
						: 'bg-muted/20 hover:bg-muted/40'}"
					onclick={() => onTodaySegmentChange?.(tab.segment)}
				>
					<p class="text-base font-semibold tabular-nums leading-none {tab.countClass}">
						{tab.count > 0 || tab.segment !== 'overdue'
							? tab.count
							: '—'}
					</p>
					<p class="text-muted-foreground mt-1 text-[9px] uppercase tracking-wide">{tab.label}</p>
				</button>
			{/each}
		</div>
	{/if}
</header>
