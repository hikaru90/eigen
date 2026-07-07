<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import {
		splitTodayEngageSections,
		groupByProject,
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

	/** Split items into project-grouped and ungrouped (no project label). */
	const projectGroups = $derived(() => {
		const withProject = items.filter((i) => i.projectLabel && i.projectLabel.trim());
		return groupByProject(withProject, m.graph_timeline_no_project(), timeZone);
	});

	/** Items without a project get the existing energy-based split. */
	const ungroupedItems = $derived(
		items.filter((i) => !i.projectLabel || !i.projectLabel.trim())
	);

	const engageSections = $derived(
		splitTodayEngageSections(ungroupedItems, timeZone, engageFilters)
	);
	const { focus, later, lowEnergy } = $derived(engageSections);

	const hasAnyItems = $derived(
		projectGroups().length > 0 || focus.length > 0 || later.length > 0 || lowEnergy.length > 0
	);
</script>

<div class="min-h-0 flex-1 overflow-y-auto pb-4" role="listbox" aria-label={m.graph_timeline_tasks_aria()}>
	{#if segment === 'todo'}
		{#if !hasAnyItems}
			<p class="text-muted-foreground px-4 py-8 text-center text-sm">{m.graph_timeline_focus_empty()}</p>
		{:else}
			{#each projectGroups() as group (group.projectKey)}
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
			{/each}

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
