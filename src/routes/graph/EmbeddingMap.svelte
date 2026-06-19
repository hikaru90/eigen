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
	import { m } from '$lib/paraglide/messages.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import {
		canRunUmap,
		centerAndScaleCoords3d,
		computeUmapNeighbors,
		fallbackProjection3d,
		l2NormalizeEmbeddings
	} from './embedding-projection';
	import { createEmbeddingMap3d, type EmbeddingMap3dHandle } from './embedding-map-3d';

	type Props = {
		graphLegendSections: GraphLegendSection[];
		visibleEntityTypes?: Set<string>;
		/** When false the tab panel is hidden — defer fetch/UMAP until visible so layout has size. */
		visible?: boolean;
		onSelectItem?: (item: EmbeddingSnapshotItem | null) => void;
		selectedItemId?: string | null;
	};

	let {
		graphLegendSections,
		visibleEntityTypes = $bindable(new Set<string>()),
		visible = true,
		onSelectItem,
		selectedItemId = null
	}: Props = $props();

	type Phase =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'projecting'; epoch: number; totalEpochs: number }
		| { kind: 'ready'; count: number }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'idle' });
	let rootEl: HTMLDivElement | undefined;
	let snapshotItems = $state<EmbeddingSnapshotItem[]>([]);

	const embeddingStats = $derived.by(() => {
		if (phase.kind !== 'ready' || snapshotItems.length === 0) return '';
		const filtered = filterNodesByEntityTypes(snapshotItems, visibleEntityTypes);
		const thoughtCount = filtered.filter((item) => item.kind === 'Thought').length;
		const entityCount = filtered.filter((item) => item.kind === 'Entity').length;
		return m.graph_embedding_stats({ thoughts: thoughtCount, entities: entityCount });
	});

	const MAX_FETCH_RETRIES = 3;

	async function fetchWithRetry(url: string, retries = MAX_FETCH_RETRIES): Promise<Response> {
		let lastErr: unknown;
		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				const res = await fetch(url);
				return res;
			} catch (err) {
				lastErr = err;
				if (attempt < retries) {
					await new Promise((r) => setTimeout(r, 300 * attempt));
				}
			}
		}
		throw lastErr;
	}

	let teardown: (() => void) | undefined;
	let mapHandle: EmbeddingMap3dHandle | null = null;
	let pipelineStarted = false;

	$effect(() => {
		if (!visible || pipelineStarted) return;
		pipelineStarted = true;

		let cancelled = false;

		(async () => {
			phase = { kind: 'loading' };
			let items: EmbeddingSnapshotItem[];
			try {
				const res = await fetchWithRetry('/api/embeddings/snapshot');
				if (!res.ok) {
					const text = await res.text();
					throw new Error(`Server returned ${res.status}: ${text || 'unknown error'}`);
				}
				const body = (await res.json()) as { items: EmbeddingSnapshotItem[] };
				items = body.items;
			} catch (err) {
				if (cancelled) return;
				phase = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
				return;
			}

			if (cancelled) return;

			snapshotItems = items;

			if (items.length === 0) {
				phase = { kind: 'ready', count: 0 };
				return;
			}

			const embeddings = l2NormalizeEmbeddings(items);
			const nNeighbors = computeUmapNeighbors(items.length);
			const nEpochs = items.length > 200 ? 300 : 500;

			let coords: number[][];
			if (canRunUmap(items.length, nNeighbors)) {
				const { UMAP } = await import('umap-js');
				if (cancelled) return;

				phase = { kind: 'projecting', epoch: 0, totalEpochs: nEpochs };

				const umap = new UMAP({ nNeighbors, nEpochs, nComponents: 3, minDist: 0.1, spread: 1.0 });

				try {
					coords = await umap.fitAsync(embeddings, (epochNumber) => {
						if (cancelled) return false;
						phase = { kind: 'projecting', epoch: epochNumber, totalEpochs: nEpochs };
						return true;
					});
				} catch (err) {
					if (cancelled) return;
					phase = {
						kind: 'error',
						message: `UMAP failed: ${err instanceof Error ? err.message : String(err)}`
					};
					return;
				}
			} else {
				coords = fallbackProjection3d(items.length);
			}

			coords = centerAndScaleCoords3d(coords);

			await tick();
			if (cancelled) return;
			if (!rootEl) {
				phase = { kind: 'error', message: 'Chart container is not mounted.' };
				return;
			}

			if (cancelled || !rootEl) return;

			const customFills = customEntityFillsFromLegendSections(graphLegendSections);

			const mapPoints = items.map((item, i) => ({
				item,
				x: coords[i][0],
				y: coords[i][1],
				z: coords[i][2],
				color: nodeFillForGraph(item.kind, item.subtype, customFills)
			}));

			mapHandle = createEmbeddingMap3d({
				container: rootEl,
				points: mapPoints,
				onSelectItem
			});
			mapHandle.setSelectedId(selectedItemId ?? null);
			mapHandle.setVisibleSubtypes(visibleEntityTypes);

			const ro = new ResizeObserver(() => {
				mapHandle?.resize();
			});
			ro.observe(rootEl);
			queueMicrotask(() => mapHandle?.resize());

			phase = { kind: 'ready', count: items.length };

			teardown = () => {
				cancelled = true;
				ro.disconnect();
				mapHandle?.dispose();
				mapHandle = null;
			};
		})();
	});

	$effect(() => {
		return () => {
			teardown?.();
			teardown = undefined;
			pipelineStarted = false;
			snapshotItems = [];
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
</script>

<div class="relative flex h-full min-h-0 w-full flex-col">

	{#if phase.kind === 'loading'}
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

	{:else if phase.kind === 'ready' && phase.count === 0}
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

	{#if phase.kind === 'ready' && phase.count > 0}
		<div
			class="pointer-events-none absolute top-10 left-3 z-20 w-[min(calc(100vw-1.5rem),11rem)] shrink-0 md:top-14"
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
