<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import {
		entityKindKeyFromLegendItem,
		type GraphLegendSection
	} from '$lib/graph/graph-ontology-legend';
	import { GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE } from '$lib/graph/graph-i18n';
	import { graphFilterGlassPanelClass } from '$lib/graph/graph-filter-chrome';
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

	const legendPanelExpanded = $derived(
		legendExpanded && (hasEntities || graphStats.trim().length > 0)
	);

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
		class="{graphFilterGlassPanelClass(legendPanelExpanded)} pointer-events-none flex w-full flex-col justify-start overflow-hidden {legendPanelExpanded
			? 'max-h-56'
			: 'h-9'}"
		aria-label={m.graph_aria_entity_type_filter()}
	>
		<div
			class="text-foreground pointer-events-auto flex min-h-0 w-full flex-col justify-start text-xs leading-none"
		>
			<div
				class="flex h-9 shrink-0 items-center justify-between gap-1 px-2 {legendPanelExpanded
					? 'border-border/40 border-b'
					: ''}"
			>
				<button
					type="button"
					class="text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground focus-visible:ring-ring/50 flex h-7 min-w-0 flex-1 items-center gap-1 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
					aria-expanded={legendExpanded}
					aria-controls={panelId}
					onclick={() => (legendExpanded = !legendExpanded)}
				>
					{#if legendExpanded}
						<ChevronUp class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{:else}
						<ChevronDown class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{/if}
					<span class="truncate text-xs font-semibold tracking-tight">{m.graph_filter()}</span>
					{#if filterActive}
						<span
							class="bg-black/10 text-foreground dark:bg-white/15 shrink-0 rounded-full px-1.5 font-mono text-[10px] tabular-nums"
						>
							{visibleEntityTypes.size}
						</span>
					{/if}
				</button>
				<div class="flex shrink-0 items-center justify-end gap-1">
					{#if filterActive}
						<button
							type="button"
							class="text-foreground/80 hover:text-foreground focus-visible:ring-ring/50 h-7 shrink-0 rounded-full px-1.5 text-xs font-medium focus-visible:ring-1 focus-visible:outline-none"
							onclick={clearEntityTypeFilter}
						>
							{m.graph_show_all()}
						</button>
					{/if}
				</div>
			</div>

			{#if legendPanelExpanded}
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
							data-testid="graph-stats"
							class="text-muted-foreground border-border/40 shrink-0 border-t px-1 py-1 font-mono text-[10px] leading-tight tabular-nums"
						>
							{graphStats}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</aside>
{/if}
