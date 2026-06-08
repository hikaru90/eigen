<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import {
		entityKindKeyFromLegendItem,
		type GraphLegendSection
	} from '$lib/graph/graph-ontology-legend';
	import { GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';

	let {
		legendSections,
		graphStats = '',
		panelId = 'graph-legend-panel',
		visibleEntityTypes = $bindable(new Set<string>())
	}: {
		legendSections: GraphLegendSection[];
		graphStats?: string;
		panelId?: string;
		visibleEntityTypes?: Set<string>;
	} = $props();

	const entityKindsSection = $derived(
		legendSections.find((s) => s.title === GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE) ?? null
	);

	const entityItems = $derived(entityKindsSection?.items ?? []);
	const hasEntities = $derived(entityItems.length > 0);
	const showLegend = $derived(hasEntities || graphStats.trim().length > 0);
	const filterActive = $derived(visibleEntityTypes.size > 0);

	let legendExpanded = $state(false);

	function toggleEntityType(itemKey: string) {
		const kindKey = entityKindKeyFromLegendItem(itemKey);
		const next = new Set(visibleEntityTypes);
		if (next.has(kindKey)) {
			next.delete(kindKey);
		} else {
			next.add(kindKey);
		}
		visibleEntityTypes = next;
	}

	function clearEntityTypeFilter() {
		visibleEntityTypes = new Set();
	}
</script>

{#if showLegend}
	<aside
		class="border-border/60 bg-background/90 pointer-events-none flex w-full flex-col justify-end overflow-hidden rounded-md border backdrop-blur-sm {legendExpanded &&
		(hasEntities || graphStats.trim().length > 0)
			? 'max-h-56'
			: ''}"
		aria-label={m.graph_aria_entity_type_filter()}
	>
		<div
			class="text-foreground pointer-events-auto flex min-h-0 w-full flex-col justify-end text-[10px] leading-none"
		>
			{#if legendExpanded && (hasEntities || graphStats.trim().length > 0)}
				<div id={panelId} class="flex min-h-0 flex-1 flex-col overflow-hidden">
					{#if hasEntities}
						<div class="min-h-0 flex-1 overflow-y-auto px-1 pt-1">
							<ul class="flex flex-col gap-1" role="list">
								{#each entityItems as item (item.key)}
									{@const kindKey = entityKindKeyFromLegendItem(item.key)}
									{@const isSelected = filterActive && visibleEntityTypes.has(kindKey)}
									<li class="min-w-0">
										<button
											type="button"
											class="border-border/60 bg-muted/25 text-foreground hover:bg-muted/40 focus-visible:ring-ring/50 inline-flex w-full min-w-0 items-center gap-1.5 rounded border px-1 py-1 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none {filterActive &&
											!isSelected
												? 'opacity-40'
												: ''} {isSelected
												? 'border-black text-black dark:border-white dark:text-white'
												: ''}"
											title={item.hint}
											aria-pressed={filterActive ? isSelected : false}
											onclick={() => toggleEntityType(item.key)}
										>
											{#if item.fill}
												<span
													class="size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
													style="background-color: {item.fill}"
													aria-hidden="true"
												></span>
											{/if}
											<span class="truncate font-medium">{item.label}</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if graphStats}
						<p
							class="text-muted-foreground border-border/40 shrink-0 border-t px-1 py-1 font-mono text-[9px] leading-tight tabular-nums"
						>
							{graphStats}
						</p>
					{/if}
				</div>
			{/if}

			<div
				class="flex shrink-0 items-center justify-between gap-1 px-1 {legendExpanded &&
				(hasEntities || graphStats.trim().length > 0)
					? 'border-border/40 border-t'
					: ''}"
			>
				<button
					type="button"
					class="text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1 rounded-sm py-2 pr-1 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
					aria-expanded={legendExpanded}
					aria-controls={panelId}
					onclick={() => (legendExpanded = !legendExpanded)}
				>
					{#if legendExpanded}
						<ChevronDown class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{:else}
						<ChevronUp class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{/if}
					<span class="truncate font-semibold tracking-tight">{m.graph_filter()}</span>
					{#if filterActive}
						<span
							class="bg-primary/15 text-primary shrink-0 rounded px-1 font-mono text-[9px] tabular-nums"
						>
							{visibleEntityTypes.size}
						</span>
					{/if}
				</button>
				<div class="flex shrink-0 items-center justify-end gap-1">
					{#if filterActive}
						<button
							type="button"
							class="text-primary hover:text-primary/80 focus-visible:ring-ring/50 shrink-0 rounded-sm font-medium focus-visible:ring-1 focus-visible:outline-none"
							onclick={clearEntityTypeFilter}
						>
							{m.graph_show_all()}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</aside>
{/if}
