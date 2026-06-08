<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { graphIntlLocale } from '$lib/graph/graph-i18n';
	import { timelineGreetingPeriod, type TimelineShellView } from './temporal-events-utils';

	type Stats = {
		todoTodayCount: number;
		doneTodayCount: number;
		overdueDebtMinutes: number;
		estimatedMinutesToday: number;
	};

	type Props = {
		shellView: TimelineShellView;
		taskCount: number;
		estimatedMinutes: number;
		userName?: string | null;
		timeZone: string;
	};

	let { shellView, taskCount, estimatedMinutes, userName = null, timeZone }: Props = $props();

	let stats = $state<Stats | null>(null);

	const now = $derived(new Date());
	const currentTime = $derived(
		new Intl.DateTimeFormat(graphIntlLocale(), {
			timeZone,
			hour: 'numeric',
			minute: '2-digit',
			hour12: false
		}).format(now)
	);
	const greetingPeriod = $derived(timelineGreetingPeriod(now, timeZone));
	const greetingName = $derived.by(() => {
		const first = userName?.trim().split(/\s+/)[0];
		return first ? `, ${first}` : '';
	});
	const greeting = $derived(
		greetingPeriod === 'morning'
			? m.graph_timeline_greeting_morning({ name: greetingName })
			: greetingPeriod === 'afternoon'
				? m.graph_timeline_greeting_afternoon({ name: greetingName })
				: m.graph_timeline_greeting_evening({ name: greetingName })
	);

	const title = $derived(
		shellView === 'today'
			? m.graph_timeline_today()
			: shellView === 'upcoming'
				? m.graph_timeline_upcoming()
				: shellView === 'week'
					? m.graph_timeline_week()
					: shellView === 'agenda'
						? m.graph_temporal_agenda()
						: m.graph_timeline_matrix()
	);

	const subtitle = $derived(
		new Intl.DateTimeFormat(graphIntlLocale(), {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			timeZone
		}).format(new Date()) +
			' · ' +
			m.graph_timeline_meta_tasks({ count: taskCount }) +
			' · ' +
			m.graph_timeline_meta_hours({ hours: Math.round((estimatedMinutes / 60) * 10) / 10 })
	);

	const overdueHours = $derived(
		stats ? Math.round((stats.overdueDebtMinutes / 60) * 10) / 10 : 0
	);

	onMount(() => {
		void (async () => {
			try {
				const res = await fetch('/api/timeline/stats');
				if (!res.ok) return;
				stats = (await res.json()) as Stats;
			} catch {
				// ignore
			}
		})();
	});
</script>

<header class="border-border shrink-0 border-b px-4 pb-3 pt-2">
	<p class="text-muted-foreground font-mono text-xs tabular-nums">{currentTime}</p>
	<p class="text-muted-foreground mt-0.5 text-xs">{greeting}</p>
	<div class="mt-0.5 flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h2 class="text-foreground text-2xl font-semibold tracking-tight">{title}</h2>
			<p class="text-muted-foreground mt-0.5 text-xs">{subtitle}</p>
		</div>
	</div>

	{#if stats}
		<div class="mt-3 grid grid-cols-3 gap-2">
			<div class="border-border bg-muted/20 rounded-xl border px-3 py-2 text-center">
				<p class="text-foreground text-lg font-semibold tabular-nums">{stats.todoTodayCount}</p>
				<p class="text-muted-foreground text-[10px] uppercase tracking-wide">{m.graph_timeline_pill_todo()}</p>
			</div>
			<div class="border-border bg-muted/20 rounded-xl border px-3 py-2 text-center">
				<p class="text-green-500 text-lg font-semibold tabular-nums">{stats.doneTodayCount}</p>
				<p class="text-muted-foreground text-[10px] uppercase tracking-wide">{m.graph_timeline_pill_done()}</p>
			</div>
			<div class="border-border bg-muted/20 rounded-xl border px-3 py-2 text-center">
				<p
					class="text-lg font-semibold tabular-nums {overdueHours > 0
						? 'text-destructive'
						: 'text-muted-foreground'}"
				>
					{overdueHours > 0 ? m.graph_timeline_pill_overdue_hours({ hours: overdueHours }) : '—'}
				</p>
				<p class="text-muted-foreground text-[10px] uppercase tracking-wide">
					{m.graph_timeline_pill_overdue()}
				</p>
			</div>
		</div>
	{/if}
</header>
