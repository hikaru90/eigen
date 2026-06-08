<script lang="ts">
	import { tick } from 'svelte';
	import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';
	import { nodeFillForGraph, customEntityFillsFromLegendSections } from '$lib/graph/graph-ontology-legend';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { GraphLegendSection } from '$lib/graph/graph-ontology-legend';
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
		/** When false the tab panel is hidden — defer fetch/UMAP until visible so layout has size. */
		visible?: boolean;
		onSelectItem?: (item: EmbeddingSnapshotItem | null) => void;
		selectedItemId?: string | null;
	};

	let {
		graphLegendSections,
		visible = true,
		onSelectItem,
		selectedItemId = null
	}: Props = $props();

	type LegendEntry = { subtype: string; fill: string };

	type Phase =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'projecting'; epoch: number; totalEpochs: number }
		| { kind: 'ready'; count: number; thoughtCount: number; entityCount: number; legendEntries: LegendEntry[] }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'idle' });
	let rootEl: HTMLDivElement | undefined;

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
	let legendExpanded = $state(false);

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

			if (items.length === 0) {
				phase = { kind: 'ready', count: 0, thoughtCount: 0, entityCount: 0, legendEntries: [] };
				return;
			}

			// ── UMAP projection (3D) ───────────────────────────────────────────
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

			// ── Three.js render ──────────────────────────────────────────────────
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

			const ro = new ResizeObserver(() => {
				mapHandle?.resize();
			});
			ro.observe(rootEl);
			queueMicrotask(() => mapHandle?.resize());

			// Build legend from observed subtypes
			const seenKeys = new Set<string>();
			const legendEntries: LegendEntry[] = [];
			for (const item of items) {
				if (!seenKeys.has(item.subtype)) {
					seenKeys.add(item.subtype);
					legendEntries.push({
						subtype: item.subtype,
						fill: nodeFillForGraph(item.kind, item.subtype, customFills)
					});
				}
			}
			legendEntries.sort((a, b) => a.subtype.localeCompare(b.subtype));

			phase = {
				kind: 'ready',
				count: items.length,
				thoughtCount: items.filter((i) => i.kind === 'Thought').length,
				entityCount: items.filter((i) => i.kind === 'Entity').length,
				legendEntries
			};

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
</script>

<div class="relative flex h-full min-h-0 w-full flex-col">

	{#if phase.kind === 'loading'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">Fetching embeddings…</p>
		</div>

	{:else if phase.kind === 'projecting'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<div class="text-center">
				<p class="text-foreground text-sm font-medium">Projecting to 3D…</p>
				<p class="text-muted-foreground mt-1 text-xs">Epoch {phase.epoch} / {phase.totalEpochs}</p>
				<div class="bg-muted mt-2 h-1.5 w-48 overflow-hidden rounded-full">
					<div
						class="bg-primary h-full rounded-full transition-all duration-150"
						style="width: {Math.round((phase.epoch / phase.totalEpochs) * 100)}%"
					></div>
				</div>
			</div>
			<p class="text-muted-foreground/60 max-w-xs text-center text-[10px] leading-relaxed">
				UMAP is computing a 3D layout from your embedding vectors in the browser.
			</p>
		</div>

	{:else if phase.kind === 'error'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8">
			<p class="text-destructive text-center text-sm font-medium">Projection failed</p>
			<p class="text-muted-foreground text-center text-xs">{phase.message}</p>
		</div>

	{:else if phase.kind === 'ready' && phase.count === 0}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
			<p class="text-muted-foreground text-sm">No embeddings found.</p>
			<p class="text-muted-foreground/70 text-xs">Capture some thoughts — embeddings are computed during ingest.</p>
		</div>
	{/if}

	<div
		bind:this={rootEl}
		class="text-foreground relative h-full min-h-0 w-full overflow-hidden"
		role="img"
		aria-label="Embedding map — 3D UMAP projection of your thoughts and entities"
	></div>

	{#if phase.kind === 'ready' && phase.count > 0}
		<aside
			class="border-border/60 bg-background/90 pointer-events-none absolute bottom-16 left-3 z-0 w-[min(calc(100vw-1.5rem),11rem)] rounded-md border px-1 py-1 backdrop-blur-sm {legendExpanded
				? 'h-56'
				: ''}"
			aria-label="Embedding map legend"
		>
			<div
				class="text-foreground pointer-events-auto flex min-h-0 flex-col gap-1 text-[10px] leading-none {legendExpanded
					? 'h-full'
					: ''}"
			>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-6 w-full shrink-0 items-center gap-0.5 rounded-sm text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
					aria-expanded={legendExpanded}
					aria-controls="embedding-map-legend-panel"
					onclick={() => (legendExpanded = !legendExpanded)}
				>
					{#if legendExpanded}
						<ChevronDown class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{:else}
						<ChevronRight class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
					{/if}
					<span class="truncate font-semibold tracking-tight">Legend</span>
				</button>

				{#if legendExpanded}
					<div id="embedding-map-legend-panel" class="flex min-h-0 flex-1 flex-col gap-1">
						<div class="relative min-h-0 flex-1 overflow-hidden">
							<ul class="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto" role="list">
								{#each phase.legendEntries as entry (entry.subtype)}
									<li class="min-w-0">
										<span
											class="border-border/60 bg-muted/25 text-foreground inline-flex w-full min-w-0 items-center gap-1 rounded border px-1 py-px"
										>
											<span
												class="h-2 w-2 shrink-0 rounded-full ring-1 ring-border/60"
												style="background-color: {entry.fill}"
												aria-hidden="true"
											></span>
											<span class="truncate font-mono font-medium">{entry.subtype}</span>
										</span>
									</li>
								{/each}
							</ul>
						</div>
						<p class="text-muted-foreground shrink-0 font-mono text-[9px] leading-tight tabular-nums">
							{phase.thoughtCount} thoughts · {phase.entityCount} entities
						</p>
					</div>
				{/if}
			</div>
		</aside>

		<p class="text-muted-foreground/50 pointer-events-none absolute bottom-12 left-1/2 z-0 -translate-x-1/2 whitespace-nowrap text-[9px]">
			Drag to orbit · shift-drag or two-finger drag to pan · pinch or scroll to zoom · click a dot to inspect
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
