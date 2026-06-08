<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { filterItemsForUpcomingView, groupByProject } from './temporal-events-utils';
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

	const viewItems = $derived(filterItemsForUpcomingView(items, timeZone));
	const projectGroups = $derived(
		groupByProject(viewItems, m.graph_timeline_no_project(), timeZone)
	);
</script>

<div class="min-h-0 flex-1 overflow-y-auto pb-28" role="listbox" aria-label={m.graph_timeline_upcoming_aria()}>
	{#if projectGroups.length === 0}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_upcoming_empty()}</p>
	{:else}
		{#each projectGroups as group (group.projectKey)}
			<section class="border-border border-b">
				<h3
					class="text-muted-foreground bg-muted/20 sticky top-0 z-10 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-widest"
				>
					{m.graph_timeline_project_group({ name: group.projectLabel })}
				</h3>
				<ul>
					{#each group.items as item (item.id)}
						<TemporalTimelineTaskRow
							{item}
							{selectedItemId}
							{updatingEventId}
							onSelect={onSelect}
							onQuickAction={onQuickAction}
						/>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>
