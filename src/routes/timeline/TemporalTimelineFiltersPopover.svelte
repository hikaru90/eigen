<script lang="ts">
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import * as Select from '$lib/components/ui/select';
	import * as Popover from '$lib/components/ui/popover';
	import { Label } from '$lib/components/ui/label';
	import {
		KANBAN_KIND_ORDER,
		type TemporalRangeFilter,
		type TemporalStatusFilter
	} from './temporal-events-utils';
	import { graphKindLabel, graphTemporalRangeLabel } from '$lib/graph/graph-i18n';
	import {
		GRAPH_FILTER_GLASS_ROW,
		graphFilterTriggerClass
	} from '$lib/graph/graph-filter-chrome';
	import { m } from '$lib/paraglide/messages.js';

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
				onchange={(e) => onStatusFilterChange(e.currentTarget.checked ? 'all' : 'open')}
			/>
			{m.graph_temporal_status_show_completed()}
		</label>
		<div class="space-y-1.5">
			<Label class="text-xs">{m.graph_timeline_filters_range()}</Label>
			<Select.Root
				type="single"
				value={rangeFilter}
				onValueChange={(v) => {
					if (v) onRangeFilterChange(v as TemporalRangeFilter);
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
							onchange={() => onToggleKind(kind)}
						/>
						{graphKindLabel(kind)}
					</label>
				{/each}
			</div>
			{#if kindFilter.length > 0}
				<button
					type="button"
					class="text-muted-foreground pt-1 font-mono text-[10px] underline"
					onclick={onClearKinds}
				>
					{m.graph_temporal_clear_kinds()}
				</button>
			{/if}
		</fieldset>
	</Popover.Content>
</Popover.Root>
