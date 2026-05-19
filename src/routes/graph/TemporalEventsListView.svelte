<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { formatWhen, kindColor, kindLabel } from './temporal-events-utils';

	type Props = {
		items: TemporalEventListItem[];
		selectedItemId: string | null;
		onSelect: (item: TemporalEventListItem) => void;
	};

	let { items, selectedItemId, onSelect }: Props = $props();
</script>

<ul class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Temporal events list">
	{#each items as item (item.id)}
		<li>
			<button
				type="button"
				role="option"
				aria-selected={selectedItemId === item.id}
				class="border-border hover:bg-muted/40 flex w-full gap-3 border-b px-3 py-2.5 text-left transition-colors {selectedItemId ===
				item.id
					? 'bg-muted/50'
					: ''}"
				onclick={() => onSelect(item)}
			>
				<span
					class="mt-1 size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
					style="background-color: {kindColor(item.kind)}"
					aria-hidden="true"
				></span>
				<div class="min-w-0 flex-1 space-y-0.5">
					<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span class="text-foreground text-sm font-medium leading-snug">
							{item.semanticSummary}
						</span>
						<span
							class="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-wide"
						>
							{kindLabel(item.kind)}
						</span>
					</div>
					<p class="text-muted-foreground font-mono text-[11px]">{formatWhen(item)}</p>
					<p class="text-muted-foreground/80 line-clamp-1 text-[11px]">{item.thoughtText}</p>
				</div>
				{#if item.graphSyncStatus !== 'synced'}
					<span
						class="text-destructive shrink-0 font-mono text-[10px]"
						title={item.graphSyncError ?? 'Graph sync pending'}
					>
						{item.graphSyncStatus}
					</span>
				{/if}
			</button>
		</li>
	{/each}
</ul>
