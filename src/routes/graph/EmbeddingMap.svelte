<script lang="ts">
	import { onMount } from 'svelte';
	import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';
	import { nodeFillForGraph, customEntityFillsFromLegendSections } from '$lib/graph/graph-ontology-legend';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { GraphLegendSection } from '$lib/graph/graph-ontology-legend';

	type Props = {
		graphLegendSections: GraphLegendSection[];
		/** Raised when the user clicks a dot — parent renders the detail panel. */
		onSelectItem?: (item: EmbeddingSnapshotItem | null) => void;
		selectedItemId?: string | null;
	};

	let { graphLegendSections, onSelectItem, selectedItemId = null }: Props = $props();

	// ── State ────────────────────────────────────────────────────────────────────
	type Phase =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'projecting'; epoch: number; totalEpochs: number }
		| { kind: 'ready'; count: number }
		| { kind: 'error'; message: string };

	let phase = $state<Phase>({ kind: 'idle' });
	let rootEl: HTMLDivElement | undefined;

	// Retry logic — exactly 3 attempts per the failure policy, then hard error.
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
					// Brief back-off: 300ms * attempt
					await new Promise((r) => setTimeout(r, 300 * attempt));
				}
			}
		}
		throw lastErr;
	}

	// ── D3 scatter plot ──────────────────────────────────────────────────────────
	let teardown: (() => void) | undefined;

	onMount(() => {
		let cancelled = false;

		(async () => {
			// ── 1. Fetch embedding snapshot ──────────────────────────────────────
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
				phase = {
					kind: 'error',
					message: err instanceof Error ? err.message : String(err)
				};
				return;
			}

			if (cancelled) return;

			if (items.length === 0) {
				phase = { kind: 'ready', count: 0 };
				return;
			}

			// ── 2. Run UMAP client-side (main thread, async with epoch callbacks) ─
			const { UMAP } = await import('umap-js');
			if (cancelled) return;

			const embeddings = items.map((i) => i.embedding);
			const nNeighbors = Math.min(15, Math.max(2, Math.floor(items.length / 4)));
			const nEpochs = items.length > 200 ? 200 : 400;

			phase = { kind: 'projecting', epoch: 0, totalEpochs: nEpochs };

			const umap = new UMAP({
				nNeighbors,
				nEpochs,
				nComponents: 2,
				minDist: 0.1,
				spread: 1.0
			});

			let coords: number[][];
			try {
				// fitAsync yields to the event loop each epoch, keeping the UI responsive
				coords = await umap.fitAsync(embeddings, (epochNumber) => {
					if (cancelled) return false; // returning false aborts the fit
					phase = { kind: 'projecting', epoch: epochNumber, totalEpochs: nEpochs };
					return true;
				});
			} catch (err) {
				if (cancelled) return;
				phase = {
					kind: 'error',
					message: `UMAP projection failed: ${err instanceof Error ? err.message : String(err)}`
				};
				return;
			}

			if (cancelled || !rootEl) return;

			// ── 3. Render D3 SVG scatter plot ────────────────────────────────────
			const d3 = await import('d3');
			if (cancelled || !rootEl) return;

			const customFills = customEntityFillsFromLegendSections(graphLegendSections);

			type Point = {
				item: EmbeddingSnapshotItem;
				x: number;
				y: number;
				cx: number; // scaled canvas x
				cy: number; // scaled canvas y
			};

			const points: Point[] = items.map((item, i) => ({
				item,
				x: coords[i][0],
				y: coords[i][1],
				cx: 0,
				cy: 0
			}));

			const w = rootEl.clientWidth;
			const h = Math.max(1, rootEl.clientHeight);

			const margin = { top: 20, right: 20, bottom: 20, left: 20 };
			const xExtent = d3.extent(points, (p) => p.x) as [number, number];
			const yExtent = d3.extent(points, (p) => p.y) as [number, number];

			const xScale = d3
				.scaleLinear()
				.domain(xExtent)
				.range([margin.left, w - margin.right])
				.nice();
			const yScale = d3
				.scaleLinear()
				.domain(yExtent)
				.range([margin.top, h - margin.bottom])
				.nice();

			for (const p of points) {
				p.cx = xScale(p.x);
				p.cy = yScale(p.y);
			}

			const svg = d3
				.select(rootEl)
				.append('svg')
				.attr('class', 'embedding-svg block h-full w-full touch-none')
				.attr('width', w)
				.attr('height', h);

			// Add glow filter for selected dot
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

			const gZoom = svg.append('g');

			// Zoom behaviour — same pattern as the graph tab
			const zoom = d3
				.zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.1, 20])
				.on('zoom', (event) => {
					gZoom.attr('transform', event.transform.toString());
				});
			svg.call(zoom);

			// Clear selection on background click
			svg.on('click.embedding-clear', (event) => {
				const el = event.target as Element | null;
				if (!el?.closest?.('.embedding-dot')) {
					onSelectItem?.(null);
				}
			});

			function resizeSvg() {
				if (!rootEl) return;
				const nw = rootEl.clientWidth;
				const nh = Math.max(1, rootEl.clientHeight);
				svg.attr('width', nw).attr('height', nh);
			}

			// Draw dots
			const dotGroups = gZoom
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
					return g;
				})
				.attr('transform', (p) => `translate(${p.cx},${p.cy})`)
				.style('cursor', 'pointer')
				.on('click.select', (event, p) => {
					event.stopPropagation();
					onSelectItem?.(p.item);
				});

			// Apply highlight when selectedItemId changes
			function applyHighlight(selId: string | null) {
				dotGroups.each(function (p) {
					const sel = d3.select(this);
					const circle = sel.select<SVGCircleElement>('circle');
					const on = selId !== null && p.item.id === selId;
					circle
						.attr('r', on ? 7 : 5)
						.attr('stroke-width', on ? 3 : 0.8)
						.attr('stroke', on ? '#fbbf24' : 'currentColor')
						.attr('filter', on ? 'url(#embedding-dot-glow)' : null);
				});
			}

			applyHighlight(selectedItemId);

			// Watch for external selectedItemId changes via a reactive effect
			// We expose a setter that the $effect below will call.
			const startHighlightWatch = () => {
				// Use MutationObserver alternative: poll via requestAnimationFrame loop
				// since we can't use $effect inside onMount. Instead, expose a setter.
				scheduleApplyHighlight = applyHighlight;
			};
			startHighlightWatch();

			const ro = new ResizeObserver(() => {
				resizeSvg();
			});
			ro.observe(rootEl);

			phase = { kind: 'ready', count: items.length };

			teardown = () => {
				cancelled = true;
				scheduleApplyHighlight = null;
				ro.disconnect();
				svg.remove();
			};
		})();

		return () => {
			teardown?.();
			teardown = undefined;
		};
	});

	// Exposed so the parent can trigger highlight updates without re-mounting
	let scheduleApplyHighlight: ((id: string | null) => void) | null = null;

	$effect(() => {
		const id = selectedItemId ?? null;
		queueMicrotask(() => scheduleApplyHighlight?.(id));
	});
</script>

<div class="relative flex h-full min-h-0 w-full flex-col">
	<!-- Status overlay while loading or projecting -->
	{#if phase.kind === 'loading'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<p class="text-muted-foreground text-sm">Fetching embeddings…</p>
		</div>
	{:else if phase.kind === 'projecting'}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
			<LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
			<div class="text-center">
				<p class="text-foreground text-sm font-medium">Projecting embeddings</p>
				<p class="text-muted-foreground mt-1 text-xs">
					Epoch {phase.epoch} / {phase.totalEpochs}
				</p>
				<!-- Progress bar -->
				<div class="bg-muted mt-2 h-1.5 w-48 overflow-hidden rounded-full">
					<div
						class="bg-primary h-full rounded-full transition-all duration-200"
						style="width: {Math.round((phase.epoch / phase.totalEpochs) * 100)}%"
					></div>
				</div>
			</div>
			<p class="text-muted-foreground/70 max-w-xs text-center text-[10px]">
				UMAP is computing a 2D layout of your embedding vectors in the browser. This may take up
				to 30 seconds for large datasets.
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
			<p class="text-muted-foreground/70 text-xs">
				Capture some thoughts first — embeddings are computed during ingest.
			</p>
		</div>
	{/if}

	<!-- The D3 SVG is mounted directly into this div -->
	<div
		bind:this={rootEl}
		class="text-foreground h-full min-h-0 w-full"
		role="img"
		aria-label="Embedding map — 2D UMAP projection of your thoughts and entities"
	></div>

	<!-- Disclaimer caption at the bottom -->
	{#if phase.kind === 'ready' && phase.count > 0}
		<p
			class="text-muted-foreground/60 pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-center text-[10px]"
		>
			Semantic neighborhood · dot proximity is approximate · axes have no meaning
		</p>
	{/if}
</div>
