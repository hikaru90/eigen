<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { splitTodayFocusAndLater, type TodaySegment } from './temporal-events-utils';
	import { isOverdueItem } from '$lib/graph/timeline-overdue';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalTimelineTaskRow from './TemporalTimelineTaskRow.svelte';

	type Props = {
		items: TemporalEventListItem[];
		doneItems: TemporalEventListItem[];
		doneLoading?: boolean;
		overdueItems: TemporalEventListItem[];
		overdueLoading?: boolean;
		selectedItemId: string | null;
		updatingEventId?: string | null;
		timeZone: string;
		segment: TodaySegment;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
		onLongPress?: (item: TemporalEventListItem) => void;
	};

	let {
		items,
		doneItems,
		doneLoading = false,
		overdueItems,
		overdueLoading = false,
		selectedItemId,
		updatingEventId = null,
		timeZone,
		segment,
		onSelect,
		onQuickAction,
		onLongPress
	}: Props = $props();

	const { focus, later } = $derived(splitTodayFocusAndLater(items, timeZone));
</script>

<div class="min-h-0 flex-1 overflow-y-auto pb-4" role="listbox" aria-label={m.graph_timeline_today_aria()}>
	{#if segment === 'todo'}
		{#if focus.length === 0 && later.length === 0}
			{#if overdueItems.length > 0}
				<p class="text-muted-foreground px-4 py-8 text-center text-sm">
					{m.graph_timeline_todo_all_overdue({ count: overdueItems.length })}
				</p>
			{:else}
				<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_focus_empty()}</p>
			{/if}
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
							onSelect={onSelect}
							onQuickAction={onQuickAction}
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
							onSelect={onSelect}
							onQuickAction={onQuickAction}
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
							onSelect={onSelect}
							onQuickAction={onQuickAction}
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
							onSelect={onSelect}
							onQuickAction={onQuickAction}
							{onLongPress}
						/>
			{/each}
		</ul>
	{/if}
</div>
