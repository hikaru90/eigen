<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LayoutListIcon from '@lucide/svelte/icons/layout-list';
	import SunIcon from '@lucide/svelte/icons/sun';
	import Grid3x3Icon from '@lucide/svelte/icons/grid-3x3';
	import Columns3Icon from '@lucide/svelte/icons/columns-3';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import * as Select from '$lib/components/ui/select';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import {
		estimatedMinutesForItems,
		filterActiveItems,
		filterItemsByKinds,
		filterItemsByRange,
		filterItemsByStatus,
		filterItemsForTodayView,
		filterItemsForUpcomingView,
		filterTodayTodoOpenItems,
		mergePriorDayOverdueIntoItems,
		filterPriorDayOverdueItems,
		filterSnoozedItems,
		isOpenLoopItemId,
		KANBAN_KIND_ORDER,
		type TemporalRangeFilter,
		type TemporalStatusFilter,
		thoughtIdFromOpenLoopItemId,
		type TimelineShellView,
		type TodaySegment
	} from './temporal-events-utils';
	import { filterCompletedTodayItems } from '$lib/graph/timeline-completed-today';
	import { isTemporalEventCompleted } from './temporal-events-utils';
	import { graphKindLabel, graphTemporalRangeLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventDetail from './TemporalEventDetail.svelte';
	import TemporalEventsAgendaView from './TemporalEventsAgendaView.svelte';
	import TemporalEventsTodayView from './TemporalEventsTodayView.svelte';
	import TemporalEventsProjectsView from './TemporalEventsProjectsView.svelte';
	import TemporalEventsUpcomingView from './TemporalEventsUpcomingView.svelte';
	import TemporalEventsWeekView from './TemporalEventsWeekView.svelte';
	import TemporalEventsMatrixView from './TemporalEventsMatrixView.svelte';
	import TemporalTimelineHeader from './TemporalTimelineHeader.svelte';
	import TemporalTimelineNudge from './TemporalTimelineNudge.svelte';
	import TimelineProjectAssignDialog from './TimelineProjectAssignDialog.svelte';

	type Props = {
		onSelectItem?: (item: TemporalEventListItem | null) => void;
		selectedItemId?: string | null;
		initialEventId?: string | null;
		userTimeZone?: string;
		userName?: string | null;
		eventNotificationsEnabled?: boolean;
		eventReminderLeadMinutes?: number;
		eventReminderKinds?: string[];
	};

	let {
		onSelectItem,
		selectedItemId = null,
		initialEventId = null,
		userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
		eventNotificationsEnabled = false,
		eventReminderLeadMinutes = 10,
		eventReminderKinds = ['appointment', 'reminder', 'deadline', 'inferred_event']
	}: Props = $props();

	type Phase =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ready'; items: TemporalEventListItem[]; nextCursor: { startAt: string; id: string } | null }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'idle' });
	let rangeFilter = $state<TemporalRangeFilter>('relevant');
	let statusFilter = $state<TemporalStatusFilter>('open');
	let kindFilter = $state<string[]>([]);
	let shellView = $state<TimelineShellView>('today');
	let todaySegment = $state<TodaySegment>('todo');
	let updatingEventId = $state<string | null>(null);
	let actionBusy = $state(false);
	let actionError = $state<string | null>(null);
	let lastActionSummary = $state<string | null>(null);
	let filtersPopoverOpen = $state(false);
	let overdueItems = $state<TemporalEventListItem[]>([]);
	let overdueLoading = $state(false);
	let doneItems = $state<TemporalEventListItem[]>([]);
	let doneLoading = $state(false);
	let statsRefreshKey = $state(0);
	let lastRefreshedAt = $state<Date | null>(null);
	let assignProjectOpen = $state(false);
	let assignProjectItem = $state<TemporalEventListItem | null>(null);

	const filtersActive = $derived(
		rangeFilter !== 'relevant' || kindFilter.length > 0 || statusFilter === 'all'
	);

	const refreshBusy = $derived(
		phase.kind === 'loading' || overdueLoading || doneLoading
	);

	const filteredItems = $derived(
		phase.kind === 'ready'
			? filterItemsByKinds(
					filterItemsByRange(filterItemsByStatus(phase.items, statusFilter), rangeFilter),
					kindFilter
				)
			: []
	);

	const displayItems = $derived(filterActiveItems(filteredItems));
	const snoozedItems = $derived(filterSnoozedItems(filteredItems));

	const todayTodoSourceItems = $derived(
		mergePriorDayOverdueIntoItems(displayItems, overdueItems)
	);
	const todayTodoItems = $derived(filterTodayTodoOpenItems(todayTodoSourceItems, userTimeZone));

	const shellViewItems = $derived(
		shellView === 'today'
			? filterItemsForTodayView(displayItems, userTimeZone)
			: shellView === 'upcoming'
				? filterItemsForUpcomingView(displayItems, userTimeZone)
				: shellView === 'projects'
					? []
					: displayItems
	);

	const headerTaskCount = $derived(
		shellView === 'today' && todaySegment === 'done'
			? doneItems.length
			: shellView === 'today' && todaySegment === 'overdue'
				? overdueItems.length
				: shellView === 'today' && todaySegment === 'todo'
					? todayTodoItems.length
					: shellViewItems.length
	);
	const headerEstimatedMinutes = $derived(
		shellView === 'today' && todaySegment === 'done'
			? estimatedMinutesForItems(doneItems)
			: shellView === 'today' && todaySegment === 'overdue'
				? estimatedMinutesForItems(overdueItems)
				: shellView === 'today' && todaySegment === 'todo'
					? estimatedMinutesForItems(todayTodoItems)
					: estimatedMinutesForItems(shellViewItems)
	);

	const todayTabCounts = $derived({
		todo: todayTodoItems.length,
		done: doneItems.length,
		overdue: overdueItems.length
	});

	const selectedItem = $derived.by(() => {
		if (phase.kind !== 'ready' || !selectedItemId) return null;
		return (
			filteredItems.find((i) => i.id === selectedItemId) ??
			doneItems.find((i) => i.id === selectedItemId) ??
			overdueItems.find((i) => i.id === selectedItemId) ??
			null
		);
	});

	const showGlobalEmpty = $derived(
		phase.kind === 'ready' &&
			filteredItems.length === 0 &&
			!(shellView === 'today' && todaySegment !== 'todo')
	);

	const totalReadyCount = $derived(phase.kind === 'ready' ? phase.items.length : 0);

	const visibleListCount = $derived(
		shellView === 'today' && todaySegment === 'done'
			? doneItems.length
			: shellView === 'today' && todaySegment === 'overdue'
				? overdueItems.length
				: filteredItems.length
	);

	function markRefreshed() {
		lastRefreshedAt = new Date();
	}

	async function loadEvents(append = false, options?: { silent?: boolean }) {
		const silent = options?.silent ?? false;
		if (!append && !silent) phase = { kind: 'loading' };
		actionError = null;
		try {
			const effectiveStatus: TemporalStatusFilter =
				shellView === 'today' ? 'open' : statusFilter;
			const params = new URLSearchParams({
				range: rangeFilter,
				status: effectiveStatus,
				includeOpenLoops: 'true'
			});
			if (kindFilter.length > 0) params.set('kinds', kindFilter.join(','));
			if (append && phase.kind === 'ready' && phase.nextCursor) {
				params.set('cursorStartAt', phase.nextCursor.startAt);
				params.set('cursorId', phase.nextCursor.id);
			}
			const res = await fetch(`/api/temporal-events?${params}`);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as {
				items: TemporalEventListItem[];
				nextCursor: { startAt: string; id: string } | null;
			};
			if (append && phase.kind === 'ready') {
				phase = {
					kind: 'ready',
					items: [...phase.items, ...body.items],
					nextCursor: body.nextCursor
				};
			} else {
				phase = { kind: 'ready', items: body.items, nextCursor: body.nextCursor };
				if (initialEventId && body.items.some((i) => i.id === initialEventId)) {
					onSelectItem?.(body.items.find((i) => i.id === initialEventId) ?? null);
				}
			}
			if (!append) markRefreshed();
		} catch (err) {
			if (silent && phase.kind === 'ready') return;
			phase = {
				kind: 'error',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	onMount(() => {
		void loadEvents();
		void loadOverdueItems();
	});

	async function loadOverdueItems() {
		overdueLoading = true;
		try {
			const params = new URLSearchParams({
				range: 'all',
				status: 'open',
				includeOpenLoops: 'true'
			});
			if (kindFilter.length > 0) params.set('kinds', kindFilter.join(','));
			const res = await fetch(`/api/temporal-events?${params}`);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as { items: TemporalEventListItem[] };
			overdueItems = filterPriorDayOverdueItems(
				filterActiveItems(filterItemsByKinds(body.items, kindFilter)),
				userTimeZone
			);
		} catch {
			overdueItems = [];
		} finally {
			overdueLoading = false;
		}
	}

	async function loadDoneItems() {
		doneLoading = true;
		try {
			const params = new URLSearchParams({
				range: 'all',
				status: 'all',
				includeOpenLoops: 'true'
			});
			if (kindFilter.length > 0) params.set('kinds', kindFilter.join(','));
			const res = await fetch(`/api/temporal-events?${params}`);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text || 'unknown error'}`);
			}
			const body = (await res.json()) as { items: TemporalEventListItem[] };
			doneItems = filterCompletedTodayItems(
				filterActiveItems(filterItemsByKinds(body.items, kindFilter)),
				userTimeZone
			);
		} catch {
			doneItems = [];
		} finally {
			doneLoading = false;
		}
	}

	function bumpStats() {
		statsRefreshKey += 1;
	}

	$effect(() => {
		if (shellView === 'today' && todaySegment === 'overdue') {
			void loadOverdueItems();
		}
		if (shellView === 'today' && todaySegment === 'done') {
			void loadDoneItems();
		}
	});

	function selectItem(item: TemporalEventListItem) {
		lastActionSummary = null;
		onSelectItem?.(selectedItemId === item.id ? null : item);
	}

	function deselectItem() {
		lastActionSummary = null;
		onSelectItem?.(null);
	}

	function applyItemLocally(updated: TemporalEventListItem) {
		if (phase.kind !== 'ready') return;
		phase = {
			kind: 'ready',
			items: phase.items.map((item) => (item.id === updated.id ? updated : item)),
			nextCursor: phase.nextCursor
		};
	}

	function removeItemLocally(itemId: string) {
		if (phase.kind !== 'ready') return;
		phase = {
			kind: 'ready',
			items: phase.items.filter((i) => i.id !== itemId),
			nextCursor: phase.nextCursor
		};
	}

	function shouldDropFromOpenList(item: TemporalEventListItem): boolean {
		return isTemporalEventCompleted(item) && (statusFilter === 'open' || shellView === 'today');
	}

	function syncListsAfterStatusChange(updated: TemporalEventListItem) {
		if (shouldDropFromOpenList(updated)) {
			removeItemLocally(updated.id);
			if (selectedItemId === updated.id) deselectItem();
		} else {
			applyItemLocally(updated);
		}

		overdueItems = overdueItems.filter((i) => i.id !== updated.id);
		if (isTemporalEventCompleted(updated)) {
			doneItems = filterCompletedTodayItems(
				filterActiveItems([...doneItems.filter((i) => i.id !== updated.id), updated]),
				userTimeZone
			);
		} else {
			doneItems = doneItems.filter((i) => i.id !== updated.id);
		}

		bumpStats();
		void loadEvents(false, { silent: true });
		if (todaySegment === 'overdue') void loadOverdueItems();
		if (todaySegment === 'done') void loadDoneItems();
	}

	async function postEventAction(
		eventId: string,
		body: { action?: string; instruction?: string; startAt?: string; endAt?: string }
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
			syncListsAfterStatusChange(result.item);
			lastActionSummary = result.summary;
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
			updatingEventId = null;
		}
	}

	async function postOpenLoopStatus(itemId: string, status: 'open' | 'completed') {
		const thoughtId = thoughtIdFromOpenLoopItemId(itemId);
		if (!thoughtId) return;
		actionError = null;
		actionBusy = true;
		updatingEventId = itemId;
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
			const existing =
				phase.kind === 'ready' ? phase.items.find((item) => item.id === itemId) : undefined;
			if (existing) {
				const nowIso = new Date().toISOString();
				syncListsAfterStatusChange({
					...existing,
					thoughtStatus: status,
					lifecycleStatus: status === 'completed' ? 'completed' : 'open',
					completedAt: status === 'completed' ? nowIso : null,
					lifecycleUpdatedAt: nowIso
				});
			} else {
				bumpStats();
				void loadEvents(false, { silent: true });
				if (todaySegment === 'overdue') void loadOverdueItems();
				if (todaySegment === 'done') void loadDoneItems();
			}
			lastActionSummary =
				status === 'completed' ? m.graph_timeline_open_loop_done() : m.graph_timeline_open_loop_reopen();
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
			updatingEventId = null;
		}
	}

	function onQuickAction(eventId: string, action: 'mark_done' | 'reopen' | 'cancel' | 'dismiss') {
		if (isOpenLoopItemId(eventId)) {
			void postOpenLoopStatus(eventId, action === 'mark_done' ? 'completed' : 'open');
			return;
		}
		if (action === 'cancel' || action === 'dismiss') {
			void postEventAction(eventId, { action });
			return;
		}
		void postEventAction(eventId, { action });
	}

	function onInstruction(eventId: string, instruction: string) {
		void postEventAction(eventId, { instruction });
	}

	function onReschedule(eventId: string, startAt: string, endAt: string) {
		void postEventAction(eventId, { action: 'reschedule', startAt, endAt });
	}

	async function onDelete(eventId: string) {
		if (isOpenLoopItemId(eventId)) {
			actionError = m.graph_timeline_open_loop_no_delete();
			return;
		}
		actionError = null;
		actionBusy = true;
		try {
			const res = await fetch(`/api/temporal-events/${eventId}`, { method: 'DELETE' });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `Request failed (${res.status})`);
			}
			const result = (await res.json()) as { summary: string };
			removeItemLocally(eventId);
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
		onFilterChange();
	}

	function clearKindFilter() {
		kindFilter = [];
		onFilterChange();
	}

	function setStatusFilter(next: TemporalStatusFilter) {
		statusFilter = next;
		onFilterChange();
	}

	function onFilterChange() {
		void loadEvents();
		if (todaySegment === 'overdue') void loadOverdueItems();
		if (todaySegment === 'done') void loadDoneItems();
	}

	function refreshAll() {
		void loadEvents();
		bumpStats();
		if (todaySegment === 'overdue') void loadOverdueItems();
		if (todaySegment === 'done') void loadDoneItems();
	}

	function setShellView(view: TimelineShellView) {
		shellView = view;
		if (view === 'today') {
			statusFilter = 'open';
		}
		if (view !== 'today') todaySegment = 'todo';
		filtersPopoverOpen = false;
	}

	function setTodaySegment(segment: TodaySegment) {
		todaySegment = segment;
		if (shellView !== 'today') shellView = 'today';
	}

	function openProjectAssign(item: TemporalEventListItem) {
		assignProjectItem = item;
		assignProjectOpen = true;
	}

	function closeProjectAssign() {
		assignProjectOpen = false;
		assignProjectItem = null;
	}

	function applyProjectLabelLocally(thoughtId: string, projectLabel: string) {
		const patch = (item: TemporalEventListItem) =>
			item.thoughtId === thoughtId ? { ...item, projectLabel } : item;
		if (phase.kind === 'ready') {
			phase = {
				kind: 'ready',
				items: phase.items.map(patch),
				nextCursor: phase.nextCursor
			};
		}
		doneItems = doneItems.map(patch);
		overdueItems = overdueItems.map(patch);
	}

	function onProjectAssigned(payload: { thoughtId: string; projectLabel: string }) {
		applyProjectLabelLocally(payload.thoughtId, payload.projectLabel);
		lastActionSummary = m.graph_timeline_assign_project_success({ project: payload.projectLabel });
		closeProjectAssign();
		bumpStats();
	}
</script>

<div class="relative flex h-full min-h-0 w-full flex-col pb-24">
	<TemporalTimelineHeader
		{shellView}
		todaySegment={todaySegment}
		taskCount={headerTaskCount}
		estimatedMinutes={headerEstimatedMinutes}
		timeZone={userTimeZone}
		tabCounts={todayTabCounts}
		{lastRefreshedAt}
		{refreshBusy}
		statsRefreshKey={statsRefreshKey}
		onRefresh={refreshAll}
		onTodaySegmentChange={setTodaySegment}
	/>

	<div class="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
		<div
			class="border-border bg-muted/30 inline-flex max-w-full rounded-md border p-0.5"
			role="group"
			aria-label={m.graph_timeline_views_aria()}
		>
			<button
				type="button"
				class="rounded-sm px-2 py-1 font-mono text-[11px] transition-colors sm:px-2.5 {shellView ===
				'week'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
				aria-pressed={shellView === 'week'}
				onclick={() => setShellView('week')}
			>
				<Grid3x3Icon class="mr-1 inline size-3 opacity-80" aria-hidden="true" />
				{m.graph_timeline_week()}
			</button>
			<button
				type="button"
				class="rounded-sm px-2 py-1 font-mono text-[11px] transition-colors sm:px-2.5 {shellView ===
				'agenda'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
				aria-pressed={shellView === 'agenda'}
				onclick={() => setShellView('agenda')}
			>
				<LayoutListIcon class="mr-1 inline size-3 opacity-80" aria-hidden="true" />
				{m.graph_temporal_agenda()}
			</button>
			<button
				type="button"
				class="rounded-sm px-2 py-1 font-mono text-[11px] transition-colors sm:px-2.5 {shellView ===
				'matrix'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
				aria-pressed={shellView === 'matrix'}
				onclick={() => setShellView('matrix')}
			>
				<Columns3Icon class="mr-1 inline size-3 opacity-80" aria-hidden="true" />
				{m.graph_timeline_matrix()}
			</button>
		</div>

		<Popover.Root bind:open={filtersPopoverOpen}>
			<Popover.Trigger
				id="timeline-filters-trigger"
				class="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 shadow-none transition-colors focus-visible:ring-1 focus-visible:outline-none {filtersActive
					? 'ring-primary/40 bg-muted/40 ring-1'
					: ''}"
				aria-label={m.graph_timeline_filters()}
				aria-expanded={filtersPopoverOpen}
				aria-controls="timeline-filters-panel"
			>
				<ListFilterIcon class="size-3.5 shrink-0 opacity-90" aria-hidden="true" />
				<span class="hidden font-mono text-[11px] sm:inline">{m.graph_timeline_filters()}</span>
			</Popover.Trigger>
			<Popover.Content
				id="timeline-filters-panel"
				align="start"
				side="bottom"
				sideOffset={6}
				class="w-56 gap-3 p-3"
				aria-labelledby="timeline-filters-trigger"
			>
				<p class="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">
					{m.graph_timeline_filters_advanced()}
				</p>
				<label class="flex cursor-pointer items-center gap-2 font-mono text-[11px]">
					<input
						type="checkbox"
						class="size-3.5"
						checked={statusFilter === 'all'}
						onchange={(e) => setStatusFilter(e.currentTarget.checked ? 'all' : 'open')}
					/>
					{m.graph_temporal_status_show_completed()}
				</label>
				<div class="space-y-1.5">
					<Label class="text-xs">{m.graph_timeline_filters_range()}</Label>
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
						<Select.Trigger class="h-8 w-full font-mono text-xs">
							{graphTemporalRangeLabel(rangeFilter)}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="relevant">{m.graph_temporal_range_relevant()}</Select.Item>
							<Select.Item value="upcoming">{m.graph_temporal_range_upcoming()}</Select.Item>
							<Select.Item value="past">{m.graph_temporal_range_past()}</Select.Item>
							<Select.Item value="all">{m.graph_temporal_range_all()}</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<fieldset class="space-y-1.5">
					<legend id="timeline-kinds-legend" class="text-xs font-medium">
						{m.graph_timeline_filters_kinds()}
					</legend>
					<div class="flex flex-col gap-1.5">
						{#each KANBAN_KIND_ORDER as kind (kind)}
							<label class="flex cursor-pointer items-center gap-2 font-mono text-[11px]">
								<input
									type="checkbox"
									class="size-3.5"
									checked={kindFilter.includes(kind)}
									aria-describedby="timeline-kinds-legend"
									onchange={() => toggleKind(kind)}
								/>
								{graphKindLabel(kind)}
							</label>
						{/each}
					</div>
					{#if kindFilter.length > 0}
						<button
							type="button"
							class="text-muted-foreground pt-1 font-mono text-[10px] underline"
							onclick={clearKindFilter}
						>
							{m.graph_temporal_clear_kinds()}
						</button>
					{/if}
				</fieldset>
			</Popover.Content>
		</Popover.Root>

		{#if phase.kind === 'ready'}
			<span class="text-muted-foreground ml-auto font-mono text-[11px]">
				{m.graph_temporal_events_count({ count: visibleListCount })}
			</span>
		{/if}
	</div>

	{#if snoozedItems.length > 0}
		<div class="border-border shrink-0 border-b px-3 py-1.5">
			<p class="text-muted-foreground mb-1 font-mono text-[10px] uppercase">
				{m.graph_timeline_snoozed()} ({snoozedItems.length})
			</p>
			<div class="flex flex-wrap gap-1">
				{#each snoozedItems as item (item.id)}
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground rounded-sm border border-border px-2 py-0.5 text-[10px]"
						onclick={() => selectItem(item)}
					>
						{item.semanticSummary}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if phase.kind === 'loading'}
		<div class="flex flex-1 flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">{m.graph_temporal_loading()}</p>
		</div>
	{:else if phase.kind === 'error'}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 px-6">
			<p class="text-destructive text-sm font-medium">{m.graph_temporal_load_error()}</p>
			<p class="text-muted-foreground text-center text-xs">{phase.message}</p>
		</div>
	{:else if phase.kind === 'ready' && shellView === 'projects'}
		<div class="flex min-h-0 flex-1 flex-col">
			<TemporalEventsProjectsView
				{selectedItemId}
				onSelect={selectItem}
			/>
		</div>
	{:else if showGlobalEmpty}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
			{#if totalReadyCount === 0}
				<p class="text-muted-foreground text-sm">{m.graph_temporal_empty()}</p>
				<p class="text-muted-foreground/70 text-xs">{m.graph_temporal_empty_hint()}</p>
			{:else if statusFilter === 'open'}
				<p class="text-muted-foreground text-sm">{m.graph_temporal_no_open()}</p>
				<p class="text-muted-foreground/70 text-xs">{m.graph_temporal_no_open_hint()}</p>
			{:else}
				<p class="text-muted-foreground text-sm">{m.graph_temporal_no_match()}</p>
			{/if}
		</div>
	{:else if phase.kind === 'ready'}
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			{#if shellView === 'today'}
				<TemporalEventsTodayView
					items={todayTodoSourceItems}
					{doneItems}
					{doneLoading}
					{overdueItems}
					{overdueLoading}
					{selectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					segment={todaySegment}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
					onLongPress={openProjectAssign}
				/>
				<TemporalTimelineNudge onAccept={onReschedule} />
			{:else if shellView === 'upcoming'}
				<TemporalEventsUpcomingView
					items={displayItems}
					{selectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
					onLongPress={openProjectAssign}
				/>
				<TemporalTimelineNudge onAccept={onReschedule} />
			{:else if shellView === 'week'}
				<TemporalEventsWeekView
					items={displayItems}
					{selectedItemId}
					timeZone={userTimeZone}
					onSelect={selectItem}
					{onReschedule}
				/>
			{:else if shellView === 'agenda'}
				<TemporalEventsAgendaView
					items={displayItems}
					{selectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
				/>
			{:else if shellView === 'matrix'}
				<TemporalEventsMatrixView
					items={displayItems}
					{selectedItemId}
					{updatingEventId}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
				/>
			{/if}

			{#if phase.nextCursor}
				<div class="border-border shrink-0 border-t px-3 py-2 text-center">
					<Button type="button" variant="outline" size="sm" class="h-8 text-xs" onclick={() => loadEvents(true)}>
						{m.graph_timeline_load_more()}
					</Button>
				</div>
			{/if}

			{#if selectedItem}
				<TemporalEventDetail
					item={selectedItem}
					timeZone={userTimeZone}
					{updatingEventId}
					{actionBusy}
					{lastActionSummary}
					{eventNotificationsEnabled}
					{eventReminderLeadMinutes}
					{eventReminderKinds}
					{onQuickAction}
					{onInstruction}
					{onDelete}
					onClose={deselectItem}
				/>
			{/if}
		</div>

		{#if actionError}
			<p class="text-destructive border-border shrink-0 border-t px-4 py-2 text-xs">{actionError}</p>
		{/if}
	{/if}

	<TimelineProjectAssignDialog
		bind:open={assignProjectOpen}
		item={assignProjectItem}
		onClose={closeProjectAssign}
		onAssigned={onProjectAssigned}
	/>

	<nav
		class="border-border bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t px-6 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm"
		aria-label={m.graph_timeline_bottom_nav()}
	>
		<div class="mx-auto grid max-w-lg grid-cols-3 gap-1">
			<button
				type="button"
				class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors {shellView ===
				'today'
					? 'text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => setShellView('today')}
			>
				<SunIcon class="size-4" aria-hidden="true" />
				<span>{m.graph_timeline_today()}</span>
				{#if shellView === 'today'}
					<span class="bg-foreground size-1 rounded-full" aria-hidden="true"></span>
				{:else}
					<span class="size-1" aria-hidden="true"></span>
				{/if}
			</button>
			<button
				type="button"
				class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors {shellView ===
				'projects'
					? 'text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => setShellView('projects')}
			>
				<FolderKanbanIcon class="size-4" aria-hidden="true" />
				<span>{m.graph_timeline_projects()}</span>
				{#if shellView === 'projects'}
					<span class="bg-foreground size-1 rounded-full" aria-hidden="true"></span>
				{:else}
					<span class="size-1" aria-hidden="true"></span>
				{/if}
			</button>
			<button
				type="button"
				class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors {shellView ===
				'upcoming'
					? 'text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => setShellView('upcoming')}
			>
				<CalendarDaysIcon class="size-4" aria-hidden="true" />
				<span>{m.graph_timeline_upcoming()}</span>
				{#if shellView === 'upcoming'}
					<span class="bg-foreground size-1 rounded-full" aria-hidden="true"></span>
				{:else}
					<span class="size-1" aria-hidden="true"></span>
				{/if}
			</button>
		</div>
	</nav>
</div>
