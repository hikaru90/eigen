<script lang="ts">
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import * as Popover from '$lib/components/ui/popover';
	import {
		type TemporalRangeFilter,
		type TemporalStatusFilter
	} from './temporal-events-utils';
	import {
		GRAPH_FILTER_GLASS_POPOVER,
		GRAPH_FILTER_POPOVER_WIDTH,
		graphFilterTriggerClass
	} from '$lib/graph/graph-filter-chrome';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalTimelineFiltersPanel from './TemporalTimelineFiltersPanel.svelte';

	type Props = {
		open?: boolean;
		filtersActive: boolean;
		statusFilter: TemporalStatusFilter;
		rangeFilter: TemporalRangeFilter;
		kindFilter: string[];
		onOpenChange?: (open: boolean) => void;
		onStatusFilterChange: (next: TemporalStatusFilter) => void;
		onRangeFilterChange: (next: TemporalRangeFilter) => void;
		onToggleKind: (kind: string) => void;
		onClearKinds: () => void;
	};

	let {
		open = $bindable(false),
		filtersActive,
		statusFilter,
		rangeFilter,
		kindFilter,
		onOpenChange,
		onStatusFilterChange,
		onRangeFilterChange,
		onToggleKind,
		onClearKinds
	}: Props = $props();
</script>

<Popover.Root bind:open {onOpenChange}>
	<div class="flex h-9 w-fit shrink-0 items-stretch gap-0.5 p-0.5">
		<Popover.Trigger
			id="timeline-filters-trigger"
			class={graphFilterTriggerClass(filtersActive)}
			aria-label={m.graph_timeline_filters()}
			aria-expanded={open}
			aria-controls="timeline-filters-panel"
		>
			<ListFilterIcon class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
		</Popover.Trigger>
	</div>
	<Popover.Content
		id="timeline-filters-panel"
		align="end"
		side="bottom"
		sideOffset={6}
		class="{GRAPH_FILTER_GLASS_POPOVER} {GRAPH_FILTER_POPOVER_WIDTH} gap-3 p-3 shadow-xl shadow-black/5"
		aria-labelledby="timeline-filters-trigger"
	>
		<TemporalTimelineFiltersPanel
			{statusFilter}
			{rangeFilter}
			{kindFilter}
			{onStatusFilterChange}
			{onRangeFilterChange}
			{onToggleKind}
			{onClearKinds}
		/>
	</Popover.Content>
</Popover.Root>
