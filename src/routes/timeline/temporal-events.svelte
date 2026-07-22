<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { AssignProjectResponse } from '../api/timeline/projects/assign/+server';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import {
		filterActiveItems,
		filterItemsByKinds,
		filterItemsByRange,
		filterItemsByStatus,
		filterItemsForUpcomingView,
		filterTodayTodoOpenItems,
		mergePriorDayOverdueIntoItems,
		filterPriorDayOverdueItems,
		filterSnoozedItems,
		isTaskListItem,
		findTemporalListItemByRef,
		type TemporalRangeFilter,
		type TemporalStatusFilter,
		type NowSegment
	} from './temporal-events-utils';
	import { filterCompletedTodayItems } from '$lib/graph/timeline-completed-today';
	import { isTemporalEventCompleted } from './temporal-events-utils';
	import { m } from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/ui/button';
	import TemporalEventDetail from './TemporalEventDetail.svelte';
	import TemporalEventsTodayView from './TemporalEventsTodayView.svelte';
	import TemporalEventsProjectsView from './TemporalEventsProjectsView.svelte';
	import TemporalTimelineHeader from './TemporalTimelineHeader.svelte';
	import TemporalTimelineNudge from './TemporalTimelineNudge.svelte';
	import TemporalTimelineOptionsPopover from './TemporalTimelineOptionsPopover.svelte';
	import TimelineProjectAssignDialog from './TimelineProjectAssignDialog.svelte';
	import TimelineAgentAssignDialog from './TimelineAgentAssignDialog.svelte';
	import TemporalTodaySegmentTabs from './TemporalTodaySegmentTabs.svelte';
	import {
		notifyThoughtChanged,
		notifyThoughtRefreshAll,
		subscribeThoughtSync
	} from '$lib/stores/thought-sync';
	import { currentUserView } from '$lib/stores/current-user-view';
	import { appendViewToSearchParams, type CurrentUserView } from '$lib/memory/current-user-view';
	import { shouldRefetchForViewChange } from './timeline-client-loads';
	import {
		postTimelineQuickAction,
		type TimelineQuickAction
	} from './timeline-item-actions';
	import { get } from 'svelte/store';

	type Props = {
		onSelectItem?: (item: TemporalEventListItem | null) => void;
		selectedItemId?: string | null;
		initialEventId?: string | null;
		/** Prefetched temporal events from page server load (avoids initial API call). */
		prefetchedEvents?: TemporalEventListItem[];
		/** Prefetched pagination cursor from page server load. */
		prefetchedNextCursor?: { startAt: string; id: string } | null;
		userTimeZone?: string;
		userName?: string | null;
		eventNotificationsEnabled?: boolean;
		eventReminderLeadMinutes?: number;
		initialSegment?: NowSegment | null;
	};

	let {
		onSelectItem,
		selectedItemId = null,
		initialEventId = null,
		prefetchedEvents,
		prefetchedNextCursor = null,
		userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
		eventNotificationsEnabled = false,
		eventReminderLeadMinutes = 10,
		initialSegment = null
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
	let orderBy = $state<'ingest' | 'todo'>(
		typeof localStorage !== 'undefined'
			? (localStorage.getItem('timeline-order-by') as 'ingest' | 'todo') ?? 'ingest'
			: 'ingest'
	);
	let sortDirection = $state<'asc' | 'desc'>(
		typeof localStorage !== 'undefined'
			? (localStorage.getItem('timeline-sort-direction') as 'asc' | 'desc') ?? 'desc'
			: 'desc'
	);
	let dataView = $state<CurrentUserView>(get(currentUserView));
	let projectsMode = $state(
		typeof localStorage !== 'undefined'
			? localStorage.getItem('timeline-projects-mode') === 'true'
			: false
	);

	let nowSegment = $state<NowSegment>('todo');
	let updatingEventId = $state<string | null>(null);
	let actionBusy = $state(false);
	let actionError = $state<string | null>(null);
	let lastActionSummary = $state<string | null>(null);
	let overdueItems = $state<TemporalEventListItem[]>([]);
	let overdueLoading = $state(false);
	let doneItems = $state<TemporalEventListItem[]>([]);
	let doneLoading = $state(false);
	type TimelineStats = {
		todoTodayCount: number;
		doneTodayCount: number;
		overdueCount: number;
	};
	let timelineStats = $state<TimelineStats | null>(null);
	let assignProjectOpen = $state(false);
	let assignProjectItem = $state<TemporalEventListItem | null>(null);
	let assignAgentOpen = $state(false);
	let assignAgentItem = $state<TemporalEventListItem | null>(null);
	let refreshingAll = $state(false);
	let internalSelectedItemId = $state<string | null>(null);
	let filtersPopoverOpen = $state(false);
	/** Block thought-sync reload while this surface already refreshed + is notifying. */
	let suppressThoughtSyncReload = $state(false);

	const filtersActive = $derived(
		statusFilter !== 'open' ||
			rangeFilter !== 'relevant' ||
			kindFilter.length > 0
	);

	const selectionControlled = $derived(onSelectItem !== undefined);
	const activeSelectedItemId = $derived(
		selectionControlled ? selectedItemId : internalSelectedItemId
	);


	const refreshBusy = $derived(
		refreshingAll || phase.kind === 'loading' || overdueLoading || doneLoading
	);

	const silentReloadEligible = $derived(phase.kind === 'ready');

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
		mergePriorDayOverdueIntoItems(displayItems, overdueItems, { orderBy, sortDirection })
	);
	const todayTodoItems = $derived(filterTodayTodoOpenItems(todayTodoSourceItems, userTimeZone));

	const nowTabCounts = $derived(
		timelineStats
			? {
					todo: timelineStats.todoTodayCount,
					done: timelineStats.doneTodayCount,
					overdue: timelineStats.overdueCount
				}
			: {
					todo: todayTodoItems.length,
					done: doneItems.length,
					overdue: overdueItems.length
				}
	);

	const selectedItem = $derived.by(() => {
		if (phase.kind !== 'ready' || !activeSelectedItemId) return null;
		return (
			filteredItems.find((i) => i.id === activeSelectedItemId) ??
			doneItems.find((i) => i.id === activeSelectedItemId) ??
			overdueItems.find((i) => i.id === activeSelectedItemId) ??
			null
		);
	});

	function setSelection(item: TemporalEventListItem | null) {
		if (selectionControlled) {
			onSelectItem?.(item);
		} else {
			internalSelectedItemId = item?.id ?? null;
		}
	}

	const showGlobalEmpty = $derived(
		phase.kind === 'ready' &&
			filteredItems.length === 0 &&
			!projectsMode &&
			nowSegment === 'todo'
	);

	const totalReadyCount = $derived(phase.kind === 'ready' ? phase.items.length : 0);

	function persistLocal(key: string, value: string) {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(key, value);
		}
	}

	async function loadEvents(append = false, options?: { silent?: boolean }) {
		const silent = options?.silent ?? false;
		if (!append && !silent) phase = { kind: 'loading' };
		actionError = null;
		try {
			const params = new SvelteURLSearchParams({
				range: rangeFilter,
				status: 'all',
				includeTasks: 'true',
				orderBy,
				sortDirection
			});
			appendViewToSearchParams(params, dataView);
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
					setSelection(body.items.find((i) => i.id === initialEventId) ?? null);
				}
			}
		} catch (err) {
			if (silent && phase.kind === 'ready') return;
			phase = {
				kind: 'error',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	onMount(() => {
		// Page load: show prefetch if present, then fetch list + stats once.
		if (prefetchedEvents && prefetchedEvents.length > 0) {
			phase = {
				kind: 'ready',
				items: prefetchedEvents,
				nextCursor: prefetchedNextCursor ?? null
			};
			if (initialEventId && prefetchedEvents.some((i) => i.id === initialEventId)) {
				setSelection(prefetchedEvents.find((i) => i.id === initialEventId) ?? null);
			}
		}
		void loadEvents(false, { silent: phase.kind === 'ready' });
		void loadOverdueItems();
		void loadStats();
		if (initialSegment === 'overdue') {
			setNowSegment('overdue');
		}

		let previousView: CurrentUserView | null = null;
		const unsubscribeView = currentUserView.subscribe((view) => {
			const refetch = shouldRefetchForViewChange(previousView, view);
			previousView = view;
			dataView = view;
			// Initial store subscribe mirrors current value — mount already loaded lists.
			if (refetch) onFilterChange();
		});

		const unsubscribeSync = subscribeThoughtSync((message) => {
			if (suppressThoughtSyncReload) return;
			const reloadTimeline =
				message.type === 'refresh-all' ||
				(message.type === 'changed' && message.scope === 'global');
			if (reloadTimeline) {
				void reloadTimelineData({ silent: true });
			}
		});

		return () => {
			unsubscribeView();
			unsubscribeSync();
		};
	});

	async function withThoughtSyncReloadSuppressedAsync<T>(fn: () => Promise<T>): Promise<T> {
		suppressThoughtSyncReload = true;
		try {
			return await fn();
		} finally {
			suppressThoughtSyncReload = false;
		}
	}

	async function loadOverdueItems(options?: { silent?: boolean }) {
		const silent = options?.silent ?? overdueItems.length > 0;
		if (!silent) overdueLoading = true;
		try {
			const params = new SvelteURLSearchParams({
				range: 'all',
				status: 'open',
				includeTasks: 'true',
				orderBy,
				sortDirection
			});
			appendViewToSearchParams(params, dataView);
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

	async function loadDoneItems(options?: { silent?: boolean }) {
		const silent = options?.silent ?? doneItems.length > 0;
		if (!silent) doneLoading = true;
		try {
			const params = new SvelteURLSearchParams({
				range: 'all',
				status: 'all',
				includeTasks: 'true'
			});
			appendViewToSearchParams(params, dataView);
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

	async function loadStats() {
		try {
			const res = await fetch('/api/timeline/stats');
			if (!res.ok) return;
			timelineStats = (await res.json()) as TimelineStats;
		} catch {
			// ignore
		}
	}

	function selectItem(item: TemporalEventListItem) {
		lastActionSummary = null;
		setSelection(activeSelectedItemId === item.id ? null : item);
	}

	function deselectItem() {
		lastActionSummary = null;
		setSelection(null);
	}

	function goToTaskFromProjects(itemId: string) {
		if (phase.kind !== 'ready') return;
		const pools = [todayTodoSourceItems, doneItems, overdueItems, phase.items];
		let item: TemporalEventListItem | null = null;
		for (const pool of pools) {
			item = findTemporalListItemByRef(pool, itemId);
			if (item) break;
		}
		if (!item) return;
		lastActionSummary = null;
		setSelection(item);
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
			await withThoughtSyncReloadSuppressedAsync(async () => {
				await reloadTimelineData({ silent: true });
				if (result.item.thoughtId) {
					notifyThoughtChanged(result.item.thoughtId, 'lifecycle', 'global');
				}
			});
			lastActionSummary = result.summary;
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
			updatingEventId = null;
		}
	}

	/** Same mark-done / reopen / archive path for Tasks, Projects, and project detail. */
	async function runTimelineQuickAction(eventId: string, action: TimelineQuickAction) {
		actionError = null;
		lastActionSummary = null;
		actionBusy = true;
		updatingEventId = eventId;
		try {
			const result = await postTimelineQuickAction(eventId, action);
			await withThoughtSyncReloadSuppressedAsync(async () => {
				await reloadTimelineData({ silent: true });
				if (result.item.thoughtId) {
					notifyThoughtChanged(result.item.thoughtId, 'lifecycle', 'global');
				}
			});
			lastActionSummary = result.summary;
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
			updatingEventId = null;
		}
	}

	function onQuickAction(eventId: string, action: 'mark_done' | 'reopen' | 'archive') {
		void runTimelineQuickAction(eventId, action);
	}

	function onInstruction(eventId: string, instruction: string) {
		void postEventAction(eventId, { instruction });
	}

	function onReschedule(eventId: string, startAt: string, endAt: string) {
		void postEventAction(eventId, { action: 'reschedule', startAt, endAt });
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
			if (activeSelectedItemId === eventId) deselectItem();
			await reloadTimelineData({ silent: true });
			lastActionSummary = result.summary;
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
		} finally {
			actionBusy = false;
		}
	}

	function onFilterChange() {
		void loadEvents(false, { silent: silentReloadEligible });
		if (nowSegment === 'overdue') void loadOverdueItems({ silent: overdueItems.length > 0 });
		if (nowSegment === 'done') void loadDoneItems({ silent: doneItems.length > 0 });
		void loadStats();
	}

	function setStatusFilter(next: TemporalStatusFilter) {
		statusFilter = next;
		onFilterChange();
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

	const showFiltersInHeader = $derived(true);

	function refreshAll() {
		refreshingAll = true;
		void (async () => {
			try {
				await withThoughtSyncReloadSuppressedAsync(async () => {
					await reloadTimelineData({ silent: silentReloadEligible });
					notifyThoughtRefreshAll('manual', 'global');
				});
			} finally {
				refreshingAll = false;
			}
		})();
	}

	async function reloadTimelineData(options?: { silent?: boolean }) {
		await loadEvents(false, { silent: options?.silent ?? false });
		await Promise.all([
			loadOverdueItems({ silent: overdueItems.length > 0 }),
			loadDoneItems({ silent: doneItems.length > 0 }),
			loadStats()
		]);
	}

	function toggleProjectsMode() {
		projectsMode = !projectsMode;
		persistLocal('timeline-projects-mode', String(projectsMode));
		filtersPopoverOpen = false;
	}

	function setNowSegment(segment: NowSegment) {
		nowSegment = segment;
		if (projectsMode) {
			projectsMode = false;
			persistLocal('timeline-projects-mode', 'false');
		}
		if (segment === 'overdue') void loadOverdueItems({ silent: overdueItems.length > 0 });
		if (segment === 'done') void loadDoneItems({ silent: doneItems.length > 0 });
	}

	function goToOverdue() {
		setNowSegment('overdue');
	}

	function openProjectAssign(item: TemporalEventListItem) {
		assignProjectItem = item;
		assignProjectOpen = true;
	}

	function closeProjectAssign() {
		assignProjectOpen = false;
		assignProjectItem = null;
	}

	function applyProjectLabelLocally(thoughtId: string, projectLabel: string, projectEntityId: string) {
		const patch = (item: TemporalEventListItem) =>
			item.thoughtId === thoughtId ? { ...item, projectLabel, projectEntityId } : item;
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

	function onProjectAssigned(payload: AssignProjectResponse & { thoughtId: string }) {
		applyProjectLabelLocally(payload.thoughtId, payload.projectLabel, payload.projectEntityId);
		lastActionSummary = payload.eligible
			? m.graph_timeline_assign_project_success({ project: payload.projectLabel })
			: m.graph_timeline_assign_project_linked_hub({ name: payload.projectLabel });
		closeProjectAssign();
		void loadEvents(false, { silent: true });
		void loadStats();
	}

	function openAgentAssign(item: TemporalEventListItem) {
		assignAgentItem = item;
		assignAgentOpen = true;
	}

	function closeAgentAssign() {
		assignAgentOpen = false;
		assignAgentItem = null;
	}

	function onAgentAssigned(payload: { agentName: string; assignmentId: string }) {
		lastActionSummary = m.graph_timeline_assign_agent_success({ agent: payload.agentName });
		closeAgentAssign();
	}
</script>

<div class="relative flex h-full min-h-0 w-full flex-col overflow-hidden overscroll-none pt-14 md:pt-24">
	<TemporalTimelineHeader
		{projectsMode}
		nowSegment={nowSegment}
		onToggleProjectsMode={toggleProjectsMode}
	>
		{#snippet titleActions()}
			<div
				class="flex items-center gap-1 {showFiltersInHeader ? '' : 'pointer-events-none invisible'}"
				aria-hidden={!showFiltersInHeader}
			>
				<TemporalTimelineOptionsPopover
					bind:open={filtersPopoverOpen}
					{filtersActive}
					{statusFilter}
					{rangeFilter}
					{kindFilter}
					{orderBy}
					{sortDirection}
					onStatusFilterChange={setStatusFilter}
					onRangeFilterChange={(next) => {
						rangeFilter = next;
						onFilterChange();
					}}
					onToggleKind={toggleKind}
					onClearKinds={clearKindFilter}
					onOrderByChange={(next) => {
						orderBy = next;
						persistLocal('timeline-order-by', next);
						onFilterChange();
					}}
					onSortDirectionToggle={() => {
						sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
						persistLocal('timeline-sort-direction', sortDirection);
						onFilterChange();
					}}
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-7 shrink-0 text-black hover:bg-black/5 dark:text-foreground dark:hover:bg-white/10"
					title={m.graph_temporal_refresh()}
					disabled={refreshBusy}
					onclick={refreshAll}
				>
					<RefreshCwIcon class="size-3.5 {refreshBusy ? 'animate-spin' : ''}" aria-hidden="true" />
					<span class="sr-only">{m.graph_temporal_refresh()}</span>
				</Button>
			</div>
		{/snippet}
		{#if !projectsMode}
			<TemporalTodaySegmentTabs
				segment={nowSegment}
				tabCounts={nowTabCounts}
				onSegmentChange={setNowSegment}
			/>
		{/if}
	</TemporalTimelineHeader>

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
			{#if projectsMode}
				<TemporalEventsProjectsView
					onGoToTask={goToTaskFromProjects}
					{orderBy}
					{sortDirection}
				/>
			{:else}
				<TemporalEventsTodayView
					items={todayTodoItems}
					{doneItems}
					{doneLoading}
					{overdueItems}
					{overdueLoading}
					overdueCount={overdueItems.length}
					selectedItemId={activeSelectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					segment={nowSegment}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
					onLongPress={openProjectAssign}
					onGoToOverdue={goToOverdue}
				/>
				{#if nowSegment === 'todo'}
					<div class="shrink-0" class:pb-28={projectsMode || !phase.nextCursor}>
						<TemporalTimelineNudge onAccept={onReschedule} />
					</div>
				{/if}
			{/if}

			{#if !projectsMode && phase.nextCursor}
				<div class="border-border shrink-0 border-t px-3 py-2 pb-28 text-center">
					<Button type="button" variant="outline" size="sm" class="h-8 text-xs" onclick={() => loadEvents(true)}>
						{m.graph_timeline_load_more()}
					</Button>
				</div>
			{/if}

		</div>

		{#if actionError}
			<p class="text-destructive border-border shrink-0 border-t px-4 py-2 text-xs">{actionError}</p>
		{/if}
	{/if}

	<TemporalEventDetail
		item={selectedItem}
		timeZone={userTimeZone}
		{updatingEventId}
		{actionBusy}
		{lastActionSummary}
		{eventNotificationsEnabled}
		{eventReminderLeadMinutes}
		{onQuickAction}
		{onInstruction}
		{onDelete}
		showAssignAgent={selectedItem
			? !isTemporalEventCompleted(selectedItem) &&
				(isTaskListItem(selectedItem) || selectedItem.projectEntityId !== null)
			: false}
		onAssignAgent={selectedItem ? () => openAgentAssign(selectedItem) : undefined}
		onClose={deselectItem}
	/>

	<TimelineProjectAssignDialog
		bind:open={assignProjectOpen}
		item={assignProjectItem}
		onClose={closeProjectAssign}
		onAssigned={onProjectAssigned}
	/>

	<TimelineAgentAssignDialog
		bind:open={assignAgentOpen}
		item={assignAgentItem}
		nested={selectedItem !== null}
		onClose={closeAgentAssign}
		onAssigned={onAgentAssigned}
	/>
</div>
