<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import {
		KANBAN_KIND_ORDER,
		type TemporalRangeFilter,
		type TemporalStatusFilter
	} from './temporal-events-utils';
	import { graphKindLabel, graphTemporalRangeLabel } from '$lib/graph/graph-i18n';
	import { GRAPH_FILTER_GLASS_SELECT } from '$lib/graph/graph-filter-chrome';
	import { m } from '$lib/paraglide/messages.js';

	type Props = {
		statusFilter: TemporalStatusFilter;
		rangeFilter: TemporalRangeFilter;
		kindFilter: string[];
		onStatusFilterChange: (next: TemporalStatusFilter) => void;
		onRangeFilterChange: (next: TemporalRangeFilter) => void;
		onToggleKind: (kind: string) => void;
		onClearKinds: () => void;
	};

	let {
		statusFilter,
		rangeFilter,
		kindFilter,
		onStatusFilterChange,
		onRangeFilterChange,
		onToggleKind,
		onClearKinds
	}: Props = $props();
</script>

<div class="flex flex-col gap-3">
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
			<Select.Content class="{GRAPH_FILTER_GLASS_SELECT} shadow-xl shadow-black/5">
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
</div>
