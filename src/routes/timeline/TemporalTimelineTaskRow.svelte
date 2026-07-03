<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import {
		completedEventSummaryClass,
		energyPillClasses,
		formatWhen,
		formatCreatedDate,
		isTaskListItem,
		isTemporalEventCompleted,
		priorityDotColor
	} from './temporal-events-utils';
	import { bucketOverdueElapsed, overdueElapsedMs } from '$lib/graph/timeline-overdue';
	import { graphEnergyLevelLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';

	type Props = {
		item: TemporalEventListItem;
		selectedItemId: string | null;
		updatingEventId?: string | null;
		showWhen?: boolean;
		timeZone?: string;
		showOverdueDuration?: boolean;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
		onLongPress?: (item: TemporalEventListItem) => void;
	};

	let {
		item,
		selectedItemId,
		updatingEventId = null,
		showWhen = true,
		timeZone,
		showOverdueDuration = false,
		onSelect,
		onQuickAction,
		onLongPress
	}: Props = $props();

	const completed = $derived(isTemporalEventCompleted(item));

	const overdueLabel = $derived.by(() => {
		if (!showOverdueDuration) return null;
		const elapsed = overdueElapsedMs(item);
		if (elapsed == null) return null;
		const bucket = bucketOverdueElapsed(elapsed);
		if (bucket.unit === 'minutes') return m.graph_timeline_overdue_since_min({ minutes: bucket.value });
		if (bucket.unit === 'hours') return m.graph_timeline_overdue_since_hours({ hours: bucket.value });
		if (bucket.value === 1) return m.graph_timeline_overdue_since_one_day();
		return m.graph_timeline_overdue_since_days({ days: bucket.value });
	});

	const LONG_PRESS_MS = 500;
	const MOVE_THRESHOLD_PX = 12;

	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressTriggered = false;
	let pressOriginX = 0;
	let pressOriginY = 0;

	function clearLongPressTimer() {
		if (longPressTimer) clearTimeout(longPressTimer);
		longPressTimer = null;
	}

	function onPointerDown(e: PointerEvent) {
		if (!onLongPress || e.button !== 0) return;
		longPressTriggered = false;
		pressOriginX = e.clientX;
		pressOriginY = e.clientY;
		clearLongPressTimer();
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			longPressTriggered = true;
			onLongPress?.(item);
			if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
				navigator.vibrate(12);
			}
		}, LONG_PRESS_MS);
	}

	function onPointerMove(e: PointerEvent) {
		if (!longPressTimer) return;
		const moved = Math.hypot(e.clientX - pressOriginX, e.clientY - pressOriginY);
		if (moved > MOVE_THRESHOLD_PX) clearLongPressTimer();
	}

	function onPointerUp() {
		clearLongPressTimer();
	}

	function onClickSelect() {
		if (longPressTriggered) {
			longPressTriggered = false;
			return;
		}
		onSelect(item);
	}
</script>

<li
	role="option"
	aria-selected={selectedItemId === item.id}
	class="border-border flex w-full items-start gap-2.5 border-b px-4 py-3 last:border-b-0 transition-colors {selectedItemId ===
	item.id
		? 'bg-muted/50'
		: 'hover:bg-muted/30'}"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onpointerleave={onPointerUp}
>
	<TemporalEventStatusButton {item} {updatingEventId} compact onQuickAction={onQuickAction} />
	<button type="button" class="flex min-w-0 flex-1 flex-col gap-1 text-left" onclick={onClickSelect}>
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
			{#if item.projectLabel}
				<span
					class="text-muted-foreground rounded-full border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px]"
				>
					{item.projectLabel}
				</span>
			{/if}
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
			{#if isTaskListItem(item)}
				<span
					class="text-muted-foreground rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
				>
					{m.graph_timeline_open_loop()}
				</span>
			{/if}
			{#if showWhen && item.startAt}
				<span class="text-muted-foreground font-mono text-[11px]">Due: {formatWhen(item, timeZone)}</span>
			{/if}
			<span class="text-muted-foreground font-mono text-[10px]">created {formatCreatedDate(item)}</span>
			{#if overdueLabel}
				<span class="text-destructive font-mono text-[11px]">{overdueLabel}</span>
			{/if}
		</div>
	</button>
</li>
