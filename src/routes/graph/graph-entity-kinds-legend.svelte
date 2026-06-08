<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { GraphLegendSection } from '$lib/graph/graph-ontology-legend';

	const ENTITY_KINDS_TITLE = 'Your ontology: entity kinds';
	const RELATION_KINDS_TITLE = 'Your ontology: relation kinds';

	let {
		legendSections,
		graphStats = ''
	}: { legendSections: GraphLegendSection[]; graphStats?: string } = $props();

	const entityKindsSection = $derived(
		legendSections.find((s) => s.title === ENTITY_KINDS_TITLE) ?? null
	);
	const relationKindsSection = $derived(
		legendSections.find((s) => s.title === RELATION_KINDS_TITLE) ?? null
	);

	const hasEntities = $derived((entityKindsSection?.items.length ?? 0) > 0);
	const hasRelations = $derived((relationKindsSection?.items.length ?? 0) > 0);
	const hasLegendContent = $derived(hasEntities || hasRelations);
	const canExpand = $derived(hasLegendContent || graphStats.trim().length > 0);
	const showLegend = $derived(canExpand);

	let legendTab = $state<'entities' | 'relations'>('entities');
	let legendExpanded = $state(false);

	$effect(() => {
		if (legendTab === 'entities' && !hasEntities && hasRelations) {
			legendTab = 'relations';
		} else if (legendTab === 'relations' && !hasRelations && hasEntities) {
			legendTab = 'entities';
		}
	});
</script>

{#snippet legendList(items: GraphLegendSection['items'], showFill: boolean)}
	<ul class="flex flex-col gap-0.5" role="list">
		{#each items as item (item.key)}
			<li class="min-w-0">
				<span
					class="border-border/60 bg-muted/25 text-foreground inline-flex w-full min-w-0 items-center gap-1 rounded border px-1 py-px"
					title={item.hint}
				>
					{#if showFill && item.fill}
						<span
							class="h-2 w-2 shrink-0 rounded-full ring-1 ring-border/60"
							style="background-color: {item.fill}"
							aria-hidden="true"
						></span>
					{:else}
						<span
							class="bg-muted-foreground/45 h-2 w-2 shrink-0 rounded-sm"
							aria-hidden="true"
						></span>
					{/if}
					<span class="truncate font-medium">{item.label}</span>
				</span>
			</li>
		{/each}
	</ul>
{/snippet}

{#if showLegend}
	<aside
		class="border-border/60 bg-background/90 pointer-events-none w-full rounded-md border px-1 py-1 backdrop-blur-sm {legendExpanded
			? 'h-56'
			: ''}"
		aria-label="Graph ontology legend"
	>
		<div
			class="text-foreground pointer-events-auto flex min-h-0 flex-col gap-1 text-[10px] leading-none {legendExpanded
				? 'h-full'
				: ''}"
		>
			{#if canExpand}
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-6 w-full shrink-0 items-center gap-0.5 rounded-sm text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
					aria-expanded={legendExpanded}
					aria-controls="graph-legend-panel"
					onclick={() => (legendExpanded = !legendExpanded)}
				>
					{#if legendExpanded}
						<ChevronDown class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{:else}
						<ChevronRight class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{/if}
					<span class="truncate font-semibold tracking-tight">Legend</span>
				</button>
			{/if}

			{#if legendExpanded}
				<div id="graph-legend-panel" class="flex min-h-0 flex-1 flex-col gap-1">
					{#if hasLegendContent && hasEntities && hasRelations}
						<Tabs.Root bind:value={legendTab} class="w-full shrink-0">
							<Tabs.List variant="line" class="h-6 w-full">
								<Tabs.Trigger value="entities" class="flex-1 px-1 text-[10px]">Entities</Tabs.Trigger>
								<Tabs.Trigger value="relations" class="flex-1 px-1 text-[10px]">Relations</Tabs.Trigger>
							</Tabs.List>
						</Tabs.Root>
					{:else if hasLegendContent && hasEntities}
						<span class="text-muted-foreground truncate font-semibold tracking-tight">
							{ENTITY_KINDS_TITLE}
						</span>
					{:else if hasLegendContent}
						<span class="text-muted-foreground truncate font-semibold tracking-tight">
							{RELATION_KINDS_TITLE}
						</span>
					{/if}

					{#if hasLegendContent}
						<div class="relative min-h-0 flex-1 overflow-hidden">
							{#if hasEntities && (legendTab === 'entities' || !hasRelations)}
								<div class="absolute inset-0 overflow-y-auto">
									{@render legendList(entityKindsSection?.items ?? [], true)}
								</div>
							{:else if hasRelations}
								<div class="absolute inset-0 overflow-y-auto">
									{@render legendList(relationKindsSection?.items ?? [], false)}
								</div>
							{/if}
						</div>
					{/if}

					{#if graphStats}
						<p class="text-muted-foreground shrink-0 font-mono text-[9px] leading-tight tabular-nums">
							{graphStats}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</aside>
{/if}
