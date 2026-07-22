<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { Button } from '$lib/components/ui/button';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import {
		buildMonthGrid,
		dayKey,
		eventsOnDay,
		kindColor
	} from './temporal-events-utils';
	import { graphIntlLocale, graphKindLabel, graphWeekdayLabels } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';

	type Props = {
		items: TemporalEventListItem[];
		selectedItemId: string | null;
		onSelect: (item: TemporalEventListItem) => void;
	};

	let { items, selectedItemId, onSelect }: Props = $props();

	const now = new Date();
	let viewMonth = $state(new Date(now.getFullYear(), now.getMonth(), 1));

	function shiftMonth(delta: number) {
		viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
	}

	const monthLabel = $derived(
		new Intl.DateTimeFormat(graphIntlLocale(), { month: 'long', year: 'numeric' }).format(
			viewMonth
		)
	);

	const gridDays = $derived(buildMonthGrid(viewMonth));
	const weekdayLabels = $derived(graphWeekdayLabels());

	function isCurrentMonth(day: Date): boolean {
		return day.getMonth() === viewMonth.getMonth();
	}

	function isToday(day: Date): boolean {
		const t = new Date();
		return (
			day.getFullYear() === t.getFullYear() &&
			day.getMonth() === t.getMonth() &&
			day.getDate() === t.getDate()
		);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="border-border flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
		<Button type="button" variant="outline" size="icon" class="size-8" onclick={() => shiftMonth(-1)}>
			<ChevronLeft class="size-4" aria-hidden="true" />
			<span class="sr-only">{m.graph_temporal_calendar_prev_month()}</span>
		</Button>
		<p class="text-foreground text-sm font-medium">{monthLabel}</p>
		<Button type="button" variant="outline" size="icon" class="size-8" onclick={() => shiftMonth(1)}>
			<ChevronRight class="size-4" aria-hidden="true" />
			<span class="sr-only">{m.graph_temporal_calendar_next_month()}</span>
		</Button>
	</div>

	<div class="grid shrink-0 grid-cols-7 border-b border-border">
		{#each weekdayLabels as label (label)}
			<div
				class="text-muted-foreground border-border border-r px-1 py-1 text-center font-mono text-[10px] last:border-r-0"
			>
				{label}
			</div>
		{/each}
	</div>

	<div
		class="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto"
		role="grid"
		aria-label={m.graph_temporal_calendar_aria()}
	>
		{#each gridDays as day (dayKey(day))}
			{@const dayEvents = eventsOnDay(items, day)}
			<div
				class="border-border flex min-h-[3rem] flex-col border-b border-r p-0.5 last:border-r-0 sm:min-h-[4.5rem] sm:p-1 {isCurrentMonth(
					day
				)
					? 'bg-background'
					: 'bg-muted/20'} {isToday(day) ? 'ring-primary/40 ring-1 ring-inset' : ''}"
				role="gridcell"
			>
				<span
					class="text-muted-foreground mb-0.5 font-mono text-[10px] {isCurrentMonth(day)
						? 'text-foreground'
						: ''}"
				>
					{day.getDate()}
				</span>
				<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
					{#each dayEvents as ev (ev.id)}
						<button
							type="button"
							class="truncate rounded px-1 py-0.5 text-left font-mono text-[9px] leading-tight text-white {selectedItemId ===
							ev.id
								? 'ring-2 ring-foreground ring-offset-1'
								: ''}"
							style="background-color: {kindColor(ev.kind)}"
							title="{graphKindLabel(ev.kind)}: {ev.semanticSummary}"
							onclick={() => onSelect(ev)}
						>
							{ev.semanticSummary}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
