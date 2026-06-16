<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import {
		completedEventSummaryClass,
		formatWhen,
		groupByMatrixQuadrant,
		isTemporalEventCompleted,
		MATRIX_QUADRANT_ORDER,
		type MatrixQuadrant
	} from './temporal-events-utils';
	import { graphMatrixQuadrantLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';

	type Props = {
		items: TemporalEventListItem[];
		selectedItemId: string | null;
		updatingEventId?: string | null;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let {
		items,
		selectedItemId,
		updatingEventId = null,
		onSelect,
		onQuickAction
	}: Props = $props();

	const grouped = $derived(groupByMatrixQuadrant(items));
	const visibleQuadrants = $derived(
		MATRIX_QUADRANT_ORDER.filter((q) => (grouped.get(q)?.length ?? 0) > 0)
	);
</script>

<div
	class="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-2 sm:grid-cols-2"
	role="region"
	aria-label={m.graph_timeline_matrix_aria()}
>
	{#if visibleQuadrants.length === 0}
		<p class="text-muted-foreground col-span-full m-auto text-sm">{m.graph_timeline_matrix_empty()}</p>
	{:else}
		{#each visibleQuadrants as quadrant (quadrant)}
			{@const quadrantItems = grouped.get(quadrant as MatrixQuadrant) ?? []}
			<section class="border-border bg-muted/10 flex min-h-[8rem] flex-col rounded-md border">
				<header class="border-border border-b px-2 py-2">
					<h3 class="text-foreground text-xs font-semibold">
						{graphMatrixQuadrantLabel(quadrant)}
					</h3>
					<span class="text-muted-foreground font-mono text-[10px]">{quadrantItems.length}</span>
				</header>
				<ul class="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
					{#each quadrantItems as item (item.id)}
						<li>
							<div
								role="button"
								tabindex="0"
								class="border-border bg-background hover:bg-muted/30 flex w-full cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors {selectedItemId ===
								item.id
									? 'ring-primary ring-2'
									: ''}"
								onclick={() => onSelect(item)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSelect(item);
									}
								}}
							>
								<div class="min-w-0 flex-1 text-left">
									<p
										class="text-foreground text-xs font-medium {completedEventSummaryClass(
											isTemporalEventCompleted(item)
										)}"
									>
										{item.semanticSummary}
									</p>
									<p class="text-muted-foreground mt-0.5 font-mono text-[10px]">{formatWhen(item)}</p>
								</div>
								<TemporalEventStatusButton
									{item}
									{updatingEventId}
									compact
									onQuickAction={onQuickAction}
								/>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>
