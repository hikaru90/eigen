<script lang="ts">
	import { onMount } from 'svelte';
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import type { AssignProjectResponse } from '../api/timeline/projects/assign/+server';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
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
		isOpenLoopItemId,
		type TemporalRangeFilter,
		type TemporalStatusFilter,
		thoughtIdFromOpenLoopItemId,
		type TimelineShellView,
		type NowSegment,
		type ProjectsLayout,
		type ProjectStatusFilter
	} from './temporal-events-utils';
	import { filterCompletedTodayItems } from '$lib/graph/timeline-completed-today';
	import { isTemporalEventCompleted } from './temporal-events-utils';
	import { m } from '$lib/paraglide/messages.js';
	import { Button } from '$lib/components/ui/button';
	import TemporalEventDetail from './TemporalEventDetail.svelte';
	import TemporalEventsAgendaView from './TemporalEventsAgendaView.svelte';
	import TemporalEventsTodayView from './TemporalEventsTodayView.svelte';
	import TemporalEventsMatrixView from './TemporalEventsMatrixView.svelte';
	import TemporalEventsProjectsView from './TemporalEventsProjectsView.svelte';
	import TemporalEventsReviewView from './TemporalEventsReviewView.svelte';
	import TemporalTimelineHeader from './TemporalTimelineHeader.svelte';
	import TemporalTimelineNudge from './TemporalTimelineNudge.svelte';
	import TimelineProjectAssignDialog from './TimelineProjectAssignDialog.svelte';
	import TemporalTodaySegmentTabs from './TemporalTodaySegmentTabs.svelte';
	import TemporalProjectsLayoutTabs from './TemporalProjectsLayoutTabs.svelte';
	import TemporalProjectStatusTabs from './TemporalProjectStatusTabs.svelte';
	import TemporalShellTabs from './TemporalShellTabs.svelte';
	import TemporalTimelineFiltersPopover from './TemporalTimelineFiltersPopover.svelte';

	type Props = {
		onSelectItem?: (item: TemporalEventListItem | null) => void;
		selectedItemId?: string | null;
		initialEventId?: string | null;
		userTimeZone?: string;
		userName?: string | null;
		eventNotificationsEnabled?: boolean;
		eventReminderLeadMinutes?: number;
		eventReminderKinds?: string[];
		visible?: boolean;
	};

	let {
		onSelectItem,
		selectedItemId = null,
		initialEventId = null,
		userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
		eventNotificationsEnabled = false,
		eventReminderLeadMinutes = 10,
		eventReminderKinds = ['appointment', 'reminder', 'deadline', 'inferred_event'],
		visible = true
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
	let shellView = $state<TimelineShellView>('now');
	let nowSegment = $state<NowSegment>('todo');
	let projectsLayout = $state<ProjectsLayout>('list');
	let projectStatusFilter = $state<ProjectStatusFilter>('all');
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

	const upcomingItems = $derived(filterItemsForUpcomingView(displayItems, userTimeZone));

	const nowTabCounts = $derived({
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
			shellView === 'now' &&
			nowSegment === 'todo'
	);

	const totalReadyCount = $derived(phase.kind === 'ready' ? phase.items.length : 0);

	const showFiltersBar = $derived(shellView !== 'review');

	const showFiltersInHeader = $derived(
		showFiltersBar && !(shellView === 'now' && nowSegment === 'todo' && overdueItems.length > 0)
	);

	async function loadEvents(append = false, options?: { silent?: boolean }) {
		const silent = options?.silent ?? false;
		if (!append && !silent) phase = { kind: 'loading' };
		actionError = null;
		try {
			const effectiveStatus: TemporalStatusFilter = shellView === 'now' ? 'open' : statusFilter;
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
		if (shellView === 'now' && nowSegment === 'overdue') {
			void loadOverdueItems();
		}
		if (shellView === 'now' && nowSegment === 'done') {
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
		return isTemporalEventCompleted(item) && (statusFilter === 'open' || shellView === 'now');
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
		if (nowSegment === 'overdue') void loadOverdueItems();
		if (nowSegment === 'done') void loadDoneItems();
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
				if (nowSegment === 'overdue') void loadOverdueItems();
				if (nowSegment === 'done') void loadDoneItems();
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
		if (nowSegment === 'overdue') void loadOverdueItems();
		if (nowSegment === 'done') void loadDoneItems();
	}

	function refreshAll() {
		void loadEvents();
		bumpStats();
		if (nowSegment === 'overdue') void loadOverdueItems();
		if (nowSegment === 'done') void loadDoneItems();
	}

	function setShellView(view: TimelineShellView) {
		shellView = view;
		if (view === 'now') {
			statusFilter = 'open';
		}
		if (view === 'projects') {
			projectsLayout = 'list';
		}
		filtersPopoverOpen = false;
	}

	function setNowSegment(segment: NowSegment) {
		nowSegment = segment;
		if (shellView !== 'now') shellView = 'now';
	}

	function goToOverdue() {
		setNowSegment('overdue');
	}

	function setProjectsLayout(layout: ProjectsLayout) {
		projectsLayout = layout;
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

	function onProjectAssigned(payload: AssignProjectResponse & { thoughtId: string }) {
		if (payload.isGtdProject) {
			applyProjectLabelLocally(payload.thoughtId, payload.projectLabel);
		}
		lastActionSummary = payload.eligible
			? m.graph_timeline_assign_project_success({ project: payload.projectLabel })
			: m.graph_timeline_assign_project_linked_hub({ name: payload.projectLabel });
		closeProjectAssign();
		bumpStats();
	}
</script>

<div class="relative flex h-full min-h-0 w-full flex-col overflow-hidden overscroll-none pt-10 pb-28 md:pt-20">
	<TemporalShellTabs
		{shellView}
		{refreshBusy}
		onShellChange={setShellView}
		onRefresh={refreshAll}
	/>

	{#snippet timelineFilters()}
		<TemporalTimelineFiltersPopover
			bind:open={filtersPopoverOpen}
			{filtersActive}
			{statusFilter}
			{rangeFilter}
			{kindFilter}
			onStatusFilterChange={setStatusFilter}
			onRangeFilterChange={(next) => {
				rangeFilter = next;
				onFilterChange();
			}}
			onToggleKind={toggleKind}
			onClearKinds={clearKindFilter}
		/>
	{/snippet}

	<TemporalTimelineHeader {shellView} nowSegment={nowSegment} {projectsLayout}>
		{#snippet titleActions()}
			{#if showFiltersBar}
				<div
					class={showFiltersInHeader ? '' : 'pointer-events-none invisible'}
					aria-hidden={!showFiltersInHeader}
				>
					{@render timelineFilters()}
				</div>
			{/if}
		{/snippet}
		{#if shellView === 'now'}
			<TemporalTodaySegmentTabs
				nav={{
					segment: nowSegment,
					tabCounts: nowTabCounts,
					statsRefreshKey,
					onSegmentChange: setNowSegment
				}}
			/>
		{/if}
		{#snippet projectsChrome()}
			{#if shellView === 'projects'}
				{#if projectsLayout === 'list'}
					<TemporalProjectStatusTabs
						filter={projectStatusFilter}
						onFilterChange={(f) => (projectStatusFilter = f)}
					/>
				{/if}
				<TemporalProjectsLayoutTabs layout={projectsLayout} onLayoutChange={setProjectsLayout} />
			{/if}
		{/snippet}
	</TemporalTimelineHeader>

	{#if snoozedItems.length > 0 && shellView !== 'review'}
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
			{#if shellView === 'now'}
				<TemporalEventsTodayView
					items={todayTodoSourceItems}
					{doneItems}
					{doneLoading}
					{overdueItems}
					{overdueLoading}
					overdueCount={overdueItems.length}
					{selectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					segment={nowSegment}
					statusRow={overdueItems.length > 0 ? timelineFilters : undefined}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
					onLongPress={openProjectAssign}
					onGoToOverdue={goToOverdue}
				/>
				{#if nowSegment === 'todo'}
					<TemporalTimelineNudge onAccept={onReschedule} />
				{/if}
			{:else if shellView === 'projects'}
				{#if projectsLayout === 'list'}
					<TemporalEventsProjectsView
						{selectedItemId}
						statusFilter={projectStatusFilter}
						onSelect={selectItem}
					/>
				{:else if projectsLayout === 'agenda'}
					<TemporalEventsAgendaView
						items={upcomingItems}
						{selectedItemId}
						{updatingEventId}
						timeZone={userTimeZone}
						onSelect={selectItem}
						onQuickAction={onQuickAction}
					/>
				{:else}
					<TemporalEventsMatrixView
						items={upcomingItems}
						{selectedItemId}
						{updatingEventId}
						onSelect={selectItem}
						onQuickAction={onQuickAction}
					/>
				{/if}
			{:else}
				<TemporalEventsReviewView
					items={displayItems}
					{selectedItemId}
					{updatingEventId}
					timeZone={userTimeZone}
					onSelect={selectItem}
					onQuickAction={onQuickAction}
					{onReschedule}
					onGoToOverdue={goToOverdue}
				/>
			{/if}

			{#if phase.nextCursor && shellView !== 'review'}
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
</div>
