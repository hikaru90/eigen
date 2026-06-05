<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ListIcon from '@lucide/svelte/icons/list';
	import Columns3Icon from '@lucide/svelte/icons/columns-3';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { filterItemsByRange, filterItemsByStatus, type TemporalStatusFilter } from './temporal-events-utils';
	import TemporalEventDetail from './TemporalEventDetail.svelte';
	import TemporalEventsListView from './TemporalEventsListView.svelte';
	import TemporalEventsCalendarView from './TemporalEventsCalendarView.svelte';
	import TemporalEventsKanbanView from './TemporalEventsKanbanView.svelte';

	type Props = {
		onSelectItem?: (item: TemporalEventListItem | null) => void;
		selectedItemId?: string | null;
	};

	let { onSelectItem, selectedItemId = null }: Props = $props();

	type Phase =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ready'; items: TemporalEventListItem[] }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'idle' });
	let rangeFilter = $state<'all' | 'upcoming' | 'past'>('all');
	let statusFilter = $state<TemporalStatusFilter>('open');
	let layoutView = $state<'list' | 'calendar' | 'kanban'>('list');
	let updatingThoughtId = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	const filteredItems = $derived(
		phase.kind === 'ready'
			? filterItemsByRange(filterItemsByStatus(phase.items, statusFilter), rangeFilter)
			: []
	);

	const totalReadyCount = $derived(phase.kind === 'ready' ? phase.items.length : 0);

	const selectedItem = $derived(
		phase.kind === 'ready' ? (filteredItems.find((i) => i.id === selectedItemId) ?? null) : null
	);

	onMount(() => {
		let cancelled = false;
		(async () => {
			phase = { kind: 'loading' };
			try {
				const res = await fetch('/api/temporal-events');
				if (!res.ok) {
					const text = await res.text();
					throw new Error(`${res.status}: ${text || 'unknown error'}`);
				}
				const body = (await res.json()) as { items: TemporalEventListItem[] };
				if (cancelled) return;
				phase = { kind: 'ready', items: body.items };
			} catch (err) {
				if (cancelled) return;
				phase = {
					kind: 'error',
					message: err instanceof Error ? err.message : String(err)
				};
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function selectItem(item: TemporalEventListItem) {
		onSelectItem?.(selectedItemId === item.id ? null : item);
	}

	function applyThoughtStatusLocally(thoughtId: string, status: 'open' | 'completed') {
		if (phase.kind !== 'ready') return;
		phase = {
			kind: 'ready',
			items: phase.items.map((item) =>
				item.thoughtId === thoughtId ? { ...item, thoughtStatus: status } : item
			)
		};
	}

	async function setThoughtStatus(thoughtId: string, status: 'open' | 'completed') {
		actionError = null;
		updatingThoughtId = thoughtId;
		try {
			const res = await fetch(`/api/thoughts/${thoughtId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}
			applyThoughtStatusLocally(thoughtId, status);
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			updatingThoughtId = null;
		}
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div class="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
		<Tabs.Root bind:value={layoutView} class="shrink-0">
			<Tabs.List variant="line" class="h-8">
				<Tabs.Trigger value="list" class="gap-1 px-2 text-xs">
					<ListIcon class="size-3.5" aria-hidden="true" />
					List
				</Tabs.Trigger>
				<Tabs.Trigger value="calendar" class="gap-1 px-2 text-xs">
					<CalendarIcon class="size-3.5" aria-hidden="true" />
					Calendar
				</Tabs.Trigger>
				<Tabs.Trigger value="kanban" class="gap-1 px-2 text-xs">
					<Columns3Icon class="size-3.5" aria-hidden="true" />
					Kanban
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<span class="text-muted-foreground hidden text-xs sm:inline">Filter</span>
		<Select.Root type="single" bind:value={rangeFilter}>
			<Select.Trigger class="h-8 w-[9rem] font-mono text-xs">
				{rangeFilter === 'all' ? 'All' : rangeFilter === 'upcoming' ? 'Upcoming' : 'Past'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">All</Select.Item>
				<Select.Item value="upcoming">Upcoming</Select.Item>
				<Select.Item value="past">Past</Select.Item>
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" bind:value={statusFilter}>
			<Select.Trigger class="h-8 w-[9.5rem] font-mono text-xs">
				{statusFilter === 'open' ? 'Open' : 'Show completed'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="open">Open</Select.Item>
				<Select.Item value="all">Show completed</Select.Item>
			</Select.Content>
		</Select.Root>

		{#if phase.kind === 'ready'}
			<span class="text-muted-foreground ml-auto font-mono text-[11px]">
				{filteredItems.length} events
			</span>
		{/if}
	</div>

	{#if phase.kind === 'loading'}
		<div class="flex flex-1 flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">Loading temporal events…</p>
		</div>
	{:else if phase.kind === 'error'}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 px-6">
			<p class="text-destructive text-sm font-medium">Could not load events</p>
			<p class="text-muted-foreground text-center text-xs">{phase.message}</p>
		</div>
	{:else if phase.kind === 'ready' && filteredItems.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
			{#if totalReadyCount === 0}
				<p class="text-muted-foreground text-sm">No temporal events yet.</p>
				<p class="text-muted-foreground/70 text-xs">
					Capture thoughts with dates, deadlines, or plans — enrichment extracts them into this timeline.
				</p>
			{:else if statusFilter === 'open'}
				<p class="text-muted-foreground text-sm">No open events match this filter.</p>
				<p class="text-muted-foreground/70 text-xs">
					Switch to “Show completed” to see finished items, or adjust the date filter.
				</p>
			{:else}
				<p class="text-muted-foreground text-sm">No events match this filter.</p>
			{/if}
		</div>
	{:else if phase.kind === 'ready'}
		<div class="flex min-h-0 flex-1 flex-col">
			{#if layoutView === 'list'}
				<TemporalEventsListView
					items={filteredItems}
					{selectedItemId}
					{updatingThoughtId}
					onSelect={selectItem}
					onSetStatus={setThoughtStatus}
				/>
			{:else if layoutView === 'calendar'}
				<TemporalEventsCalendarView
					items={filteredItems}
					{selectedItemId}
					onSelect={selectItem}
				/>
			{:else}
				<TemporalEventsKanbanView
					items={filteredItems}
					{selectedItemId}
					{updatingThoughtId}
					onSelect={selectItem}
					onSetStatus={setThoughtStatus}
				/>
			{/if}
		</div>

		{#if actionError}
			<p class="text-destructive border-border shrink-0 border-t px-4 py-2 text-xs">{actionError}</p>
		{/if}

		{#if selectedItem}
			<TemporalEventDetail
				item={selectedItem}
				{updatingThoughtId}
				onSetStatus={setThoughtStatus}
			/>
		{/if}
	{/if}
</div>
