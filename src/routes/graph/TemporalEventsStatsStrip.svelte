<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	type Stats = {
		completionsThisWeek: number;
		streakDays: number;
		overdueDebtMinutes: number;
	};

	let stats = $state<Stats | null>(null);

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

{#if stats}
	<div
		class="border-border text-muted-foreground flex shrink-0 flex-wrap gap-3 border-b px-3 py-1.5 font-mono text-[10px]"
	>
		<span>{m.graph_timeline_stats_week({ count: stats.completionsThisWeek })}</span>
		<span>{m.graph_timeline_stats_streak({ days: stats.streakDays })}</span>
		{#if stats.overdueDebtMinutes > 0}
			<span class="text-destructive">
				{m.graph_timeline_overdue_debt({
					hours: Math.round((stats.overdueDebtMinutes / 60) * 10) / 10
				})}
			</span>
		{/if}
	</div>
{/if}
