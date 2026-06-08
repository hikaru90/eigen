<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { splitTodayFocusAndLater } from './temporal-events-utils';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalTimelineTaskRow from './TemporalTimelineTaskRow.svelte';

	type Props = {
		items: TemporalEventListItem[];
		selectedItemId: string | null;
		updatingEventId?: string | null;
		timeZone: string;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let {
		items,
		selectedItemId,
		updatingEventId = null,
		timeZone,
		onSelect,
		onQuickAction
	}: Props = $props();

	const { focus, later } = $derived(splitTodayFocusAndLater(items, timeZone));
</script>

<div class="min-h-0 flex-1 overflow-y-auto pb-4" role="listbox" aria-label={m.graph_timeline_today_aria()}>
	{#if focus.length === 0 && later.length === 0}
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
							showWhen={!!item.startAt}
							onSelect={onSelect}
							onQuickAction={onQuickAction}
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
							showWhen={!!item.startAt}
							onSelect={onSelect}
							onQuickAction={onQuickAction}
						/>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>
