<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import {
		completedEventSummaryClass,
		energyPillClasses,
		formatWhen,
		isOpenLoopListItem,
		isTemporalEventCompleted,
		priorityDotColor
	} from './temporal-events-utils';
	import { graphEnergyLevelLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';

	type Props = {
		item: TemporalEventListItem;
		selectedItemId: string | null;
		updatingEventId?: string | null;
		showWhen?: boolean;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let {
		item,
		selectedItemId,
		updatingEventId = null,
		showWhen = true,
		onSelect,
		onQuickAction
	}: Props = $props();

	const completed = $derived(isTemporalEventCompleted(item));
</script>

<li
	role="option"
	aria-selected={selectedItemId === item.id}
	class="border-border flex w-full items-start gap-2.5 border-b px-4 py-3 last:border-b-0 transition-colors {selectedItemId ===
	item.id
		? 'bg-muted/50'
		: 'hover:bg-muted/30'}"
>
	<TemporalEventStatusButton {item} {updatingEventId} compact onQuickAction={onQuickAction} />
	<button type="button" class="flex min-w-0 flex-1 flex-col gap-1 text-left" onclick={() => onSelect(item)}>
		<div class="flex min-w-0 items-start gap-2">
			<span
				class="mt-1.5 size-2 shrink-0 rounded-full"
				style="background-color: {priorityDotColor(item)}"
				aria-hidden="true"
			></span>
			<span
				class="text-foreground min-w-0 flex-1 text-sm font-medium leading-snug {completedEventSummaryClass(
					completed
				)}"
			>
				{item.semanticSummary}
			</span>
		</div>
		<div class="flex flex-wrap items-center gap-2 pl-4">
			{#if item.durationMinutes}
				<span class="text-muted-foreground font-mono text-[11px]">
					{m.graph_timeline_duration_min({ minutes: item.durationMinutes })}
				</span>
			{/if}
			{#if item.energyLevel}
				<span
					class="rounded-full border px-2 py-0.5 text-[10px] {energyPillClasses(
						item.energyLevel
					)}"
				>
					{graphEnergyLevelLabel(item.energyLevel)}
				</span>
			{/if}
			{#if isOpenLoopListItem(item)}
				<span
					class="text-muted-foreground rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
				>
					{m.graph_timeline_open_loop()}
				</span>
			{/if}
			{#if showWhen && item.startAt}
				<span class="text-muted-foreground font-mono text-[11px]">{formatWhen(item)}</span>
			{/if}
		</div>
	</button>
</li>
