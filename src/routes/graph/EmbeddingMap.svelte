<script lang="ts">
	import { tick } from 'svelte';
	import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';
	import {
		customEntityFillsFromLegendSections,
		filterNodesByEntityTypes,
		nodeFillForGraph,
		type GraphLegendSection
	} from '$lib/graph/graph-ontology-legend';
	import GraphEntityKindsLegend from './graph-entity-kinds-legend.svelte';
	import {
		filterNodesByAuthorLayers,
		isEmbeddingItemVisibleByAuthorLayers
	} from '$lib/graph/graph-author-layers';
	import { m } from '$lib/paraglide/messages.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import {
		ensureEmbeddingProjection,
		subscribeEmbeddingProjection,
		type EmbeddingProjectionPhase
	} from '$lib/graph/embedding-map-projection';
	import { createEmbeddingMap3d, type EmbeddingMap3dHandle } from './embedding-map-3d';
	import { createEmbeddingMapLite, type EmbeddingMapLiteHandle } from './embedding-map-lite';
	

	type Props = {
		graphLegendSections: GraphLegendSection[];
		visibleEntityTypes?: Set<string>;
		visibleAuthorLayers?: Set<string>;
		/** When false the tab panel is hidden — resize only; projection is prefetched at /memory layout. */
		visible?: boolean;
		onSelectItem?: (item: EmbeddingSnapshotItem | null) => void;
		selectedItemId?: string | null;
	};

	let {
		graphLegendSections,
		visibleEntityTypes = $bindable(new Set<string>()),
		visibleAuthorLayers = $bindable(new Set<string>()),
		visible = true,
		onSelectItem,
		selectedItemId = null
	}: Props = $props();

	let phase = $state<EmbeddingProjectionPhase>({ kind: 'idle' });
	let rootEl: HTMLDivElement | undefined;
	let snapshotItems = $state<EmbeddingSnapshotItem[]>([]);
	let liteMode = $state(false);

	const embeddingStats = $derived.by(() => {
		if (phase.kind !== 'ready' || snapshotItems.length === 0) return '';
		const filtered = filterNodesByAuthorLayers(
			filterNodesByEntityTypes(snapshotItems, visibleEntityTypes),
			visibleAuthorLayers
		);
		const thoughtCount = filtered.filter((item) => item.kind === 'Thought').length;
		const entityCount = filtered.filter((item) => item.kind === 'Entity').length;
		return m.graph_embedding_stats({ thoughts: thoughtCount, entities: entityCount });
	});

	let teardown: (() => void) | undefined;
	let mapHandle: EmbeddingMap3dHandle | EmbeddingMapLiteHandle | null = null;
	let mountedProjectionRevision: string | null = null;

	$effect(() => {
		const unsub = subscribeEmbeddingProjection((next) => {
			phase = next;
			if (next.kind === 'ready') {
				snapshotItems = next.items;
			}
		});
		void ensureEmbeddingProjection();
		return unsub;
	});

	$effect(() => {
		if (phase.kind !== 'ready' || !rootEl) return;
		if (mountedProjectionRevision === phase.revision && mapHandle) return;

		teardown?.();
		teardown = undefined;
		mapHandle?.dispose();
		mapHandle = null;

		let cancelled = false;

		(async () => {
			await tick();
			if (cancelled || !rootEl) return;

			const customFills = customEntityFillsFromLegendSections(graphLegendSections);
			const { items, coords, revision } = phase as Extract<
				EmbeddingProjectionPhase,
				{ kind: 'ready' }
			>;

			if (items.length === 0) {
				mountedProjectionRevision = revision;
				return;
			}

			const mapPoints = items.map((item, i) => ({
				item,
				x: coords[i][0],
				y: coords[i][1],
				z: coords[i][2],
				color: nodeFillForGraph(item.kind, item.subtype, customFills)
			}));

			if (liteMode) {
				const litePoints = items.map((item, i) => ({
					item,
					x: coords[i][0],
					y: coords[i][1],
					color: nodeFillForGraph(item.kind, item.subtype, customFills)
				}));
				mapHandle = createEmbeddingMapLite({
					container: rootEl,
					points: litePoints,
					onSelectItem
				});
			} else {
				mapHandle = createEmbeddingMap3d({
					container: rootEl,
					points: mapPoints,
					onSelectItem
				});
			}
			mapHandle.setSelectedId(selectedItemId ?? null);
			mapHandle.setVisibleSubtypes(visibleEntityTypes);
			mapHandle.setVisibleAuthorLayers(visibleAuthorLayers);

			const ro = new ResizeObserver(() => {
				mapHandle?.resize();
			});
			ro.observe(rootEl);
			queueMicrotask(() => mapHandle?.resize());

			mountedProjectionRevision = revision;

			teardown = () => {
				cancelled = true;
				ro.disconnect();
				mapHandle?.dispose();
				mapHandle = null;
			};
		})();

		return () => {
			teardown?.();
			teardown = undefined;
		};
	});

	/** Rebuild map when lite mode toggle changes */
	$effect(() => {
		void liteMode;
		mountedProjectionRevision = null;
	});

	$effect(() => {
		return () => {
			teardown?.();
			teardown = undefined;
			mountedProjectionRevision = null;
		};
	});

	$effect(() => {
		if (!visible) return;
		queueMicrotask(() => mapHandle?.resize());
	});

	$effect(() => {
		const id = selectedItemId ?? null;
		queueMicrotask(() => mapHandle?.setSelectedId(id));
	});

	$effect(() => {
		const types = visibleEntityTypes;
		queueMicrotask(() => mapHandle?.setVisibleSubtypes(types));
	});

	$effect(() => {
		const layers = visibleAuthorLayers;
		queueMicrotask(() => mapHandle?.setVisibleAuthorLayers(layers));
	});

	function toggleLiteMode() {
		liteMode = !liteMode;
	}
</script>

<div class="relative flex h-full min-h-0 w-full flex-col">

	{#if phase.kind === 'loading' || phase.kind === 'idle'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">{m.graph_embedding_fetching()}</p>
		</div>

	{:else if phase.kind === 'projecting'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<div class="text-center">
				<p class="text-foreground text-sm font-medium">{m.graph_embedding_projecting()}</p>
				<p class="text-muted-foreground mt-1 text-xs">
					{m.graph_embedding_epoch({ current: phase.epoch, total: phase.totalEpochs })}
				</p>
				<div class="bg-muted mt-2 h-1.5 w-48 overflow-hidden rounded-full">
					<div
						class="bg-primary h-full rounded-full transition-all duration-150"
						style="width: {Math.round((phase.epoch / phase.totalEpochs) * 100)}%"
					></div>
				</div>
			</div>
			<p class="text-muted-foreground/60 max-w-xs text-center text-[10px] leading-relaxed">
				{m.graph_embedding_umap_hint()}
			</p>
		</div>

	{:else if phase.kind === 'error'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8">
			<p class="text-destructive text-center text-sm font-medium">{m.graph_embedding_failed()}</p>
			<p class="text-muted-foreground text-center text-xs">{phase.message}</p>
		</div>

	{:else if phase.kind === 'ready' && phase.items.length === 0}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
			<p class="text-muted-foreground text-sm">{m.graph_embedding_empty()}</p>
			<p class="text-muted-foreground/70 text-xs">{m.graph_embedding_empty_hint()}</p>
		</div>
	{/if}

	<div
		bind:this={rootEl}
		class="text-foreground relative isolate z-0 h-full min-h-0 w-full overflow-hidden"
		role="img"
		aria-label={m.graph_embedding_aria()}
	></div>

	{#if phase.kind === 'ready' && phase.items.length > 0}
		<div
			class="pointer-events-none absolute top-10 left-3 z-20 flex w-[min(calc(100vw-1.5rem),11rem)] shrink-0 flex-col gap-2 md:top-14"
		>
			<GraphEntityKindsLegend
				bind:visibleEntityTypes
				legendSections={graphLegendSections}
				graphStats={embeddingStats}
				panelId="embedding-map-legend-panel"
			/>
		</div>

		<p class="text-muted-foreground/50 pointer-events-none absolute top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-[9px] md:top-12">
			{m.graph_embedding_controls()}
		</p>

		<!-- Lite mode toggle -->
		<div class="pointer-events-auto absolute top-10 right-3 z-20 md:top-14">
			<button
				type="button"
				onclick={toggleLiteMode}
				title={liteMode ? 'Switch to full 3D view' : 'Switch to lite 2D view (less battery)'}
				class="border-border/60 bg-background/85 hover:bg-background/95 flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] backdrop-blur-sm transition-colors"
				aria-label={liteMode ? 'Switch to 3D mode' : 'Switch to lite 2D mode'}
			>
				{#if liteMode}
					<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 2L2 7l10 5 10-5-10-5z" />
						<path d="M2 17l10 5 10-5" />
						<path d="M2 12l10 5 10-5" />
					</svg>
					3D
				{:else}
					<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<circle cx="8" cy="8" r="1.5" fill="currentColor" />
						<circle cx="16" cy="8" r="1.5" fill="currentColor" />
						<circle cx="8" cy="16" r="1.5" fill="currentColor" />
						<circle cx="16" cy="16" r="1.5" fill="currentColor" />
					</svg>
					Lite
				{/if}
			</button>
		</div>
	{/if}
</div>

<style>
	:global(.embedding-map-label) {
		max-width: 11rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 1px 4px;
		border-radius: 2px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 10px;
		line-height: 1.2;
		color: var(--foreground);
		background: color-mix(in oklab, var(--background) 88%, transparent);
		border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
		opacity: 0.92;
		pointer-events: none;
		user-select: none;
	}

	:global(.embedding-map-label--selected) {
		font-weight: 600;
		opacity: 1;
		border-color: #fbbf24;
		box-shadow: 0 0 0 1px color-mix(in oklab, #fbbf24 35%, transparent);
	}
</style>
