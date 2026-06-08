<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import LayoutListIcon from '@lucide/svelte/icons/layout-list';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import {
		filterItemsByKinds,
		filterItemsByRange,
		filterItemsByStatus,
		KANBAN_KIND_ORDER,
		kindLabel,
		type TemporalRangeFilter,
		type TemporalStatusFilter
	} from './temporal-events-utils';
	import TemporalEventDetail from './TemporalEventDetail.svelte';
	import TemporalEventsAgendaView from './TemporalEventsAgendaView.svelte';
	import TemporalEventsCalendarView from './TemporalEventsCalendarView.svelte';

	type Props = {
		onSelectItem?: (item: TemporalEventListItem | null) => void;
		selectedItemId?: string | null;
		initialEventId?: string | null;
		userTimeZone?: string;
	};

	let {
		onSelectItem,
		selectedItemId = null,
		initialEventId = null,
		userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
	}: Props = $props();

	type Phase =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ready'; items: TemporalEventListItem[] }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'idle' });
	let rangeFilter = $state<TemporalRangeFilter>('relevant');
	let statusFilter = $state<TemporalStatusFilter>('open');
	let kindFilter = $state<string[]>([]);
	let layoutView = $state<'agenda' | 'calendar'>('agenda');
	let updatingEventId = $state<string | null>(null);
	let actionBusy = $state(false);
	let actionError = $state<string | null>(null);
	let lastActionSummary = $state<string | null>(null);

	const filteredItems = $derived(
		phase.kind === 'ready'
			? filterItemsByKinds(
					filterItemsByRange(filterItemsByStatus(phase.items, statusFilter), rangeFilter),
					kindFilter
				)
			: []
	);

	const totalReadyCount = $derived(phase.kind === 'ready' ? phase.items.length : 0);

	const selectedItem = $derived(
		phase.kind === 'ready' ? (filteredItems.find((i) => i.id === selectedItemId) ?? null) : null
	);

	async function loadEvents() {
		phase = { kind: 'loading' };
		actionError = null;
		try {
			const params = new URLSearchParams({
				range: rangeFilter,
				status: statusFilter
			});
			if (kindFilter.length > 0) params.set('kinds', kindFilter.join(','));
			const res = await fetch(`/api/temporal-events?${params}`);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as { items: TemporalEventListItem[] };
			phase = { kind: 'ready', items: body.items };
			if (initialEventId && body.items.some((i) => i.id === initialEventId)) {
				onSelectItem?.(body.items.find((i) => i.id === initialEventId) ?? null);
			}
		} catch (err) {
			phase = {
				kind: 'error',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	onMount(() => {
		void loadEvents();
	});

	function selectItem(item: TemporalEventListItem) {
		lastActionSummary = null;
		onSelectItem?.(selectedItemId === item.id ? null : item);
	}

	function applyItemLocally(updated: TemporalEventListItem) {
		if (phase.kind !== 'ready') return;
		phase = {
			kind: 'ready',
			items: phase.items.map((item) => (item.id === updated.id ? updated : item))
		};
	}

	async function postEventAction(
		eventId: string,
		body: { action?: string; instruction?: string }
	) {
		actionError = null;
		lastActionSummary = null;
		actionBusy = true;
		updatingEventId = eventId;
		try {
			const res = await fetch(`/api/temporal-events/${eventId}/action`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}
			const result = (await res.json()) as { item: TemporalEventListItem; summary: string };
			applyItemLocally(result.item);
			lastActionSummary = result.summary;
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
			updatingEventId = null;
		}
	}

	function onQuickAction(
		eventId: string,
		action: 'mark_done' | 'reopen' | 'cancel' | 'dismiss'
	) {
		void postEventAction(eventId, { action });
	}

	function onInstruction(eventId: string, instruction: string) {
		void postEventAction(eventId, { instruction });
	}

	async function onDelete(eventId: string) {
		actionError = null;
		actionBusy = true;
		try {
			const res = await fetch(`/api/temporal-events/${eventId}`, { method: 'DELETE' });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}
			const result = (await res.json()) as { summary: string };
			if (phase.kind === 'ready') {
				phase = {
					kind: 'ready',
					items: phase.items.filter((i) => i.id !== eventId)
				};
			}
			lastActionSummary = result.summary;
			if (selectedItemId === eventId) onSelectItem?.(null);
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
		}
	}

	function toggleKind(kind: string) {
		kindFilter = kindFilter.includes(kind)
			? kindFilter.filter((k) => k !== kind)
			: [...kindFilter, kind];
	}

	function onFilterChange() {
		void loadEvents();
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div class="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
		<Tabs.Root bind:value={layoutView} class="shrink-0">
			<Tabs.List variant="line" class="h-8">
				<Tabs.Trigger value="agenda" class="gap-1 px-2 text-xs">
					<LayoutListIcon class="size-3.5" aria-hidden="true" />
					Agenda
				</Tabs.Trigger>
				<Tabs.Trigger value="calendar" class="gap-1 px-2 text-xs">
					<CalendarIcon class="size-3.5" aria-hidden="true" />
					Calendar
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<Select.Root
			type="single"
			value={rangeFilter}
			onValueChange={(v) => {
				if (v) {
					rangeFilter = v as TemporalRangeFilter;
					onFilterChange();
				}
			}}
		>
			<Select.Trigger class="h-8 w-[9rem] font-mono text-xs">
				{rangeFilter === 'all'
					? 'All'
					: rangeFilter === 'relevant'
						? 'Relevant'
						: rangeFilter === 'upcoming'
							? 'Upcoming'
							: 'Past'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="relevant">Relevant</Select.Item>
				<Select.Item value="upcoming">Upcoming</Select.Item>
				<Select.Item value="past">Past</Select.Item>
				<Select.Item value="all">All</Select.Item>
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={statusFilter}
			onValueChange={(v) => {
				if (v) {
					statusFilter = v as TemporalStatusFilter;
					onFilterChange();
				}
			}}
		>
			<Select.Trigger class="h-8 w-[9.5rem] font-mono text-xs">
				{statusFilter === 'open' ? 'Open' : 'Show completed'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="open">Open</Select.Item>
				<Select.Item value="all">Show completed</Select.Item>
			</Select.Content>
		</Select.Root>

		<Button
			type="button"
			variant="outline"
			size="icon"
			class="size-8"
			title="Refresh"
			onclick={() => loadEvents()}
		>
			<RefreshCwIcon class="size-3.5" aria-hidden="true" />
			<span class="sr-only">Refresh</span>
		</Button>

		{#if phase.kind === 'ready'}
			<span class="text-muted-foreground ml-auto font-mono text-[11px]">
				{filteredItems.length} events
			</span>
		{/if}
	</div>

	<div class="border-border flex shrink-0 flex-wrap gap-1 border-b px-3 py-1.5">
		{#each KANBAN_KIND_ORDER as kind (kind)}
			<button
				type="button"
				class="rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors {kindFilter.includes(
					kind
				)
					? 'border-primary bg-primary/10 text-foreground'
					: 'border-border text-muted-foreground hover:bg-muted/50'}"
				onclick={() => toggleKind(kind)}
			>
				{kindLabel(kind)}
			</button>
		{/each}
		{#if kindFilter.length > 0}
			<button
				type="button"
				class="text-muted-foreground px-2 py-0.5 font-mono text-[10px] underline"
				onclick={() => {
					kindFilter = [];
					onFilterChange();
				}}
			>
				Clear kinds
			</button>
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
			{#if layoutView === 'agenda'}
				<TemporalEventsAgendaView
					items={filteredItems}
					{selectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
				/>
			{:else}
				<TemporalEventsCalendarView
					items={filteredItems}
					{selectedItemId}
					onSelect={selectItem}
				/>
			{/if}
		</div>

		{#if actionError}
			<p class="text-destructive border-border shrink-0 border-t px-4 py-2 text-xs">{actionError}</p>
		{/if}

		{#if selectedItem}
			<TemporalEventDetail
				item={selectedItem}
				{updatingEventId}
				{actionBusy}
				{lastActionSummary}
				{onQuickAction}
				{onInstruction}
				{onDelete}
			/>
		{/if}
	{/if}
</div>
