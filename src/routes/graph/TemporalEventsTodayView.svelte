<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import {
		splitTodayEngageSections,
		type EngageFilters,
		type NowSegment
	} from './temporal-events-utils';
	import { isOverdueItem } from '$lib/graph/timeline-overdue';
	import { m } from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import TemporalTimelineTaskRow from './TemporalTimelineTaskRow.svelte';

	type Props = {
		items: TemporalEventListItem[];
		doneItems: TemporalEventListItem[];
		doneLoading?: boolean;
		overdueItems: TemporalEventListItem[];
		overdueLoading?: boolean;
		overdueCount?: number;
		selectedItemId: string | null;
		updatingEventId?: string | null;
		timeZone: string;
		segment: NowSegment;
		engageFilters?: EngageFilters;
		statusRow?: Snippet;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
		onLongPress?: (item: TemporalEventListItem) => void;
		onGoToOverdue?: () => void;
	};

	let {
		items,
		doneItems,
		doneLoading = false,
		overdueItems,
		overdueLoading = false,
		overdueCount = 0,
		selectedItemId,
		updatingEventId = null,
		timeZone,
		segment,
		engageFilters,
		statusRow,
		onSelect,
		onQuickAction,
		onLongPress,
		onGoToOverdue
	}: Props = $props();

	const engageSections = $derived(
		splitTodayEngageSections(items, timeZone, engageFilters)
	);
	const { focus, later, lowEnergy } = $derived(engageSections);
</script>

<div class="min-h-0 flex-1 overflow-y-auto pb-4" role="listbox" aria-label={m.graph_timeline_now_aria()}>
	{#if overdueCount > 0 && onGoToOverdue}
		<div
			class="border-border bg-muted/30 flex items-center justify-between gap-2 border-b px-3 py-1 {segment !==
			'todo'
				? 'pointer-events-none invisible'
				: ''}"
			aria-hidden={segment !== 'todo'}
		>
			<button
				type="button"
				class="text-destructive min-w-0 flex-1 text-left text-xs underline"
				onclick={() => onGoToOverdue()}
			>
				{m.graph_timeline_now_overdue_banner({ count: overdueCount })}
			</button>
			{#if statusRow}
				<div class="shrink-0">{@render statusRow()}</div>
			{/if}
		</div>
	{/if}
	{#if segment === 'todo'}
		{#if focus.length === 0 && later.length === 0 && lowEnergy.length === 0}
			<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_focus_empty()}</p>
		{:else}
			{#if focus.length > 0}
				<section class="border-border border-b">
					<h3
						class="text-muted-foreground bg-muted/20 sticky top-0 z-10 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-widest"
					>
						{m.graph_timeline_focus()}
					</h3>
					<ul>
						{#each focus as item (item.id)}
							<TemporalTimelineTaskRow
								{item}
								{selectedItemId}
								{updatingEventId}
								{timeZone}
								showWhen={!!item.startAt}
								showOverdueDuration={isOverdueItem(item)}
								{onSelect}
								{onQuickAction}
								{onLongPress}
							/>
						{/each}
					</ul>
				</section>
			{/if}

			{#if later.length > 0}
				<section class="border-border border-b">
					<h3
						class="text-muted-foreground bg-muted/20 sticky top-0 z-10 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-widest"
					>
						{m.graph_temporal_agenda_section_later()}
					</h3>
					<ul>
						{#each later as item (item.id)}
							<TemporalTimelineTaskRow
								{item}
								{selectedItemId}
								{updatingEventId}
								{timeZone}
								showWhen={!!item.startAt}
								showOverdueDuration={isOverdueItem(item)}
								{onSelect}
								{onQuickAction}
								{onLongPress}
							/>
						{/each}
					</ul>
				</section>
			{/if}

			{#if lowEnergy.length > 0}
				<section class="border-border border-b">
					<h3
						class="text-muted-foreground bg-muted/20 sticky top-0 z-10 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-widest"
					>
						{m.graph_timeline_low_energy()}
					</h3>
					<ul>
						{#each lowEnergy as item (item.id)}
							<TemporalTimelineTaskRow
								{item}
								{selectedItemId}
								{updatingEventId}
								{timeZone}
								showWhen={!!item.startAt}
								showOverdueDuration={isOverdueItem(item)}
								{onSelect}
								{onQuickAction}
								{onLongPress}
							/>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	{:else if segment === 'done'}
		{#if doneLoading}
			<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_temporal_loading()}</p>
		{:else if doneItems.length === 0}
			<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_done_empty()}</p>
		{:else}
			<ul>
				{#each doneItems as item (item.id)}
					<TemporalTimelineTaskRow
						{item}
						{selectedItemId}
						{updatingEventId}
						{timeZone}
						showWhen={!!item.startAt}
						{onSelect}
						{onQuickAction}
						{onLongPress}
					/>
				{/each}
			</ul>
		{/if}
	{:else if overdueLoading}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_temporal_loading()}</p>
	{:else if overdueItems.length === 0}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_overdue_empty()}</p>
	{:else}
		<ul>
			{#each overdueItems as item (item.id)}
				<TemporalTimelineTaskRow
					{item}
					{selectedItemId}
					{updatingEventId}
					{timeZone}
					showWhen={!!item.startAt}
					showOverdueDuration
					{onSelect}
					{onQuickAction}
					{onLongPress}
				/>
			{/each}
		</ul>
	{/if}
</div>
