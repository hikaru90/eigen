<script lang="ts">
	import { tick } from 'svelte';
	import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';
	import { nodeFillForGraph, customEntityFillsFromLegendSections } from '$lib/graph/graph-ontology-legend';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { GraphLegendSection } from '$lib/graph/graph-ontology-legend';
	import {
		canRunUmap,
		computeUmapNeighbors,
		fallbackProjection2d,
		l2NormalizeEmbeddings
	} from './embedding-projection';

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
	let scheduleLayoutChart: (() => void) | null = null;
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

			if (items.length === 0) {
				phase = { kind: 'ready', count: 0, thoughtCount: 0, entityCount: 0, legendEntries: [] };
				return;
			}

			// ── UMAP projection ──────────────────────────────────────────────────
			const embeddings = l2NormalizeEmbeddings(items);
			const nNeighbors = computeUmapNeighbors(items.length);
			const nEpochs = items.length > 200 ? 300 : 500;

			let coords: number[][];
			if (canRunUmap(items.length, nNeighbors)) {
				const { UMAP } = await import('umap-js');
				if (cancelled) return;

				phase = { kind: 'projecting', epoch: 0, totalEpochs: nEpochs };

				const umap = new UMAP({ nNeighbors, nEpochs, nComponents: 2, minDist: 0.1, spread: 1.0 });

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
				coords = fallbackProjection2d(items.length);
			}

			await tick();
			if (cancelled) return;
			if (!rootEl) {
				phase = { kind: 'error', message: 'Chart container is not mounted.' };
				return;
			}

			// ── D3 render ────────────────────────────────────────────────────────
			const d3 = await import('d3');
			if (cancelled || !rootEl) return;

			const customFills = customEntityFillsFromLegendSections(graphLegendSections);

			type Point = { item: EmbeddingSnapshotItem; x: number; y: number; cx: number; cy: number };

			const points: Point[] = items.map((item, i) => ({
				item,
				x: coords[i][0],
				y: coords[i][1],
				cx: 0,
				cy: 0
			}));

			const margin = { top: 24, right: 24, bottom: 24, left: 24 };
			const MIN_LAYOUT_PX = 24;

			/** Pad degenerate UMAP output so a tight cluster still maps across the viewport. */
			function paddedExtent(values: number[]): [number, number] {
				const [lo, hi] = d3.extent(values) as [number, number];
				if (lo === hi) {
					const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
					return [lo - pad, hi + pad];
				}
				const span = hi - lo;
				const pad = span * 0.05;
				return [lo - pad, hi + pad];
			}

			let svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null = null;
			let gZoom: d3.Selection<SVGGElement, unknown, SVGSVGElement, unknown> | null = null;
			let dotGroups: d3.Selection<SVGGElement, Point, SVGGElement, unknown> | null = null;
			let zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
			let chartCreated = false;

			/** Each dot sits under `gZoom`'s zoom transform; `scale(1/k)` keeps circles + labels a constant screen size. */
			function updateDotGroupTransforms(k: number) {
				if (!dotGroups) return;
				const inv = 1 / k;
				dotGroups.attr('transform', (p) => `translate(${p.cx},${p.cy}) scale(${inv})`);
			}

			function applyHighlight(selId: string | null) {
				if (!dotGroups) return;
				dotGroups.each(function (p) {
					const sel = d3.select(this);
					const on = selId !== null && p.item.id === selId;
					sel.select<SVGCircleElement>('circle')
						.attr('r', on ? 7 : 5)
						.attr('stroke-width', on ? 3 : 0.8)
						.attr('stroke', on ? '#fbbf24' : 'currentColor')
						.attr('filter', on ? 'url(#embedding-dot-glow)' : null);
				});
			}

			function centerViewOnDataMean(w: number, h: number) {
				if (!svg || !zoom) return;
				const mx = (d3.mean(points, (d) => d.cx) ?? w / 2) as number;
				const my = (d3.mean(points, (d) => d.cy) ?? h / 2) as number;
				svg.call(zoom.transform, d3.zoomIdentity.translate(w / 2 - mx, h / 2 - my));
			}

			function layoutChart() {
				if (cancelled || !rootEl) return;
				const w = rootEl.clientWidth;
				const h = rootEl.clientHeight;
				if (w < MIN_LAYOUT_PX || h < MIN_LAYOUT_PX) return;

				const xScale = d3
					.scaleLinear()
					.domain(paddedExtent(points.map((p) => p.x)))
					.range([margin.left, w - margin.right]);
				const yScale = d3
					.scaleLinear()
					.domain(paddedExtent(points.map((p) => p.y)))
					.range([margin.top, h - margin.bottom]);

				for (const p of points) {
					p.cx = xScale(p.x);
					p.cy = yScale(p.y);
				}

				if (!chartCreated) {
					chartCreated = true;
					svg = d3
						.select(rootEl)
						.append('svg')
						.attr('class', 'embedding-svg block h-full w-full touch-none')
						.attr('width', w)
						.attr('height', h);

					svg
						.append('defs')
						.append('filter')
						.attr('id', 'embedding-dot-glow')
						.attr('x', '-60%')
						.attr('y', '-60%')
						.attr('width', '220%')
						.attr('height', '220%')
						.call((f) => {
							f.append('feGaussianBlur')
								.attr('in', 'SourceAlpha')
								.attr('stdDeviation', 3)
								.attr('result', 'embBlur');
							const m = f.append('feMerge');
							m.append('feMergeNode').attr('in', 'embBlur');
							m.append('feMergeNode').attr('in', 'SourceGraphic');
						});

					gZoom = svg.append('g');

					svg.on('click.embedding-clear', (event) => {
						const el = event.target as Element | null;
						if (!el?.closest?.('.embedding-dot')) onSelectItem?.(null);
					});

					dotGroups = gZoom
						.selectAll<SVGGElement, Point>('g.embedding-dot')
						.data(points, (p) => p.item.id)
						.join((enter) => {
							const g = enter.append('g').attr('class', 'embedding-dot');

							g.append('circle')
								.attr('r', 5)
								.attr('fill', (p) => nodeFillForGraph(p.item.kind, p.item.subtype, customFills))
								.attr('stroke', 'currentColor')
								.attr('stroke-width', 0.8)
								.attr('opacity', 0.85);

							g.append('title').text(
								(p) => `${p.item.kind}: ${p.item.label}\n${p.item.subtype}`
							);

							g.append('text')
								.attr('class', 'emb-label')
								.attr('x', 8)
								.attr('y', 4)
								.attr('font-size', '10px')
								.attr('font-family', 'monospace')
								.attr('fill', 'currentColor')
								.attr('stroke', 'var(--background, #fff)')
								.attr('stroke-width', '3')
								.attr('paint-order', 'stroke')
								.attr('pointer-events', 'none')
								.text((p) => {
									const base = p.item.label;
									return base.length > 32 ? `${base.slice(0, 30)}…` : base;
								});

							return g;
						})
						.style('cursor', 'pointer')
						.on('click.select', (event, p) => {
							event.stopPropagation();
							onSelectItem?.(p.item);
						});

					zoom = d3
						.zoom<SVGSVGElement, unknown>()
						.scaleExtent([0.1, 20])
						.on('zoom', (event) => {
							if (!gZoom) return;
							gZoom.attr('transform', event.transform.toString());
							updateDotGroupTransforms(event.transform.k);
						});

					svg.call(zoom);
				} else if (svg) {
					svg.attr('width', w).attr('height', h);
				}

				centerViewOnDataMean(w, h);
				if (svg && zoom) {
					const k = d3.zoomTransform(svg.node() as SVGSVGElement).k;
					updateDotGroupTransforms(k);
				}
			}

			scheduleApplyHighlight = applyHighlight;
			scheduleLayoutChart = layoutChart;

			const ro = new ResizeObserver(() => {
				layoutChart();
				queueMicrotask(() => applyHighlight(selectedItemId ?? null));
			});
			ro.observe(rootEl);
			queueMicrotask(() => {
				layoutChart();
				applyHighlight(selectedItemId ?? null);
			});

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
				scheduleApplyHighlight = null;
				scheduleLayoutChart = null;
				ro.disconnect();
				svg?.remove();
				svg = null;
				gZoom = null;
				dotGroups = null;
				zoom = null;
				chartCreated = false;
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

	let scheduleApplyHighlight: ((id: string | null) => void) | null = null;

	$effect(() => {
		if (!visible) return;
		queueMicrotask(() => scheduleLayoutChart?.());
	});

	$effect(() => {
		const id = selectedItemId ?? null;
		queueMicrotask(() => scheduleApplyHighlight?.(id));
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
				<p class="text-foreground text-sm font-medium">Projecting to 2D…</p>
				<p class="text-muted-foreground mt-1 text-xs">Epoch {phase.epoch} / {phase.totalEpochs}</p>
				<div class="bg-muted mt-2 h-1.5 w-48 overflow-hidden rounded-full">
					<div
						class="bg-primary h-full rounded-full transition-all duration-150"
						style="width: {Math.round((phase.epoch / phase.totalEpochs) * 100)}%"
					></div>
				</div>
			</div>
			<p class="text-muted-foreground/60 max-w-xs text-center text-[10px] leading-relaxed">
				UMAP is computing a 2D layout from your embedding vectors in the browser.
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

	<!-- D3 canvas -->
	<div
		bind:this={rootEl}
		class="text-foreground h-full min-h-0 w-full"
		role="img"
		aria-label="Embedding map — 2D UMAP projection of your thoughts and entities"
	></div>

	{#if phase.kind === 'ready' && phase.count > 0}
		<!-- Floating legend — bottom-left -->
		<div
			class="border-border/60 bg-background/90 pointer-events-none absolute bottom-8 left-3 max-w-[190px] rounded-md border px-3 py-2 backdrop-blur-sm"
			aria-label="Embedding map legend"
		>
			<p class="text-muted-foreground mb-2 text-[9px] font-semibold uppercase tracking-wide">
				{phase.thoughtCount} thoughts · {phase.entityCount} entities
			</p>
			<div class="space-y-1">
				{#each phase.legendEntries as entry (entry.subtype)}
					<div class="flex items-center gap-1.5">
						<span
							class="inline-block size-2 shrink-0 rounded-full ring-1 ring-black/10"
							style="background-color: {entry.fill}"
							aria-hidden="true"
						></span>
						<span class="text-foreground/75 truncate font-mono text-[10px]">{entry.subtype}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Bottom hint -->
		<p class="text-muted-foreground/50 pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px]">
			Click a dot to inspect · proximity is approximate · axes have no meaning
		</p>
	{/if}
</div>
