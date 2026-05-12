<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { graphOntologyLegendSections, nodeFillForGraph } from '$lib/graph/graph-ontology-legend';
	import Link2 from '@lucide/svelte/icons/link-2';
	import SearchIcon from '@lucide/svelte/icons/search';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const legendSections = $derived(data.graphLegendSections ?? graphOntologyLegendSections);

	let rootEl: HTMLDivElement | undefined;
	let search = $state('');
	let edgeKind = $state<string>('all');
	let searchPopoverOpen = $state(false);
	let edgePopoverOpen = $state(false);

	const searchFilterActive = $derived(search.trim().length > 0);
	const edgeFilterActive = $derived(edgeKind !== 'all');
	let status = $state<string>('');
	let scheduleGraphUpdate: (() => void) | null = null;
	let scheduleGraphResize: (() => void) | null = null;
	let scheduleApplyHighlight: ((id: string | null) => void) | null = null;
	let scheduleRestorePreEntityZoom: (() => void) | null = null;
	let selectedNode = $state<(typeof data.snapshot.nodes)[number] | null>(null);

	let legendScrollEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		const el = legendScrollEl;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey) return;
			if (el.scrollWidth <= el.clientWidth + 1) return;
			if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
				return;
			}
			el.scrollLeft += e.deltaY;
			e.preventDefault();
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	const nodeById = $derived(new Map(data.snapshot.nodes.map((n) => [n.id, n])));

	const selectedEdges = $derived.by(() => {
		if (!selectedNode) return [];
		const id = selectedNode.id;
		return data.snapshot.edges.filter((e) => e.sourceId === id || e.targetId === id);
	});

	type SimNode = {
		id: string;
		kind: string;
		label: string;
		subtype: string;
		x?: number;
		y?: number;
		fx?: number | null;
		fy?: number | null;
	};

	type SimLink = {
		id: string;
		source: string | SimNode;
		target: string | SimNode;
		relationType: string;
		kind: string;
	};

	let teardown: (() => void) | undefined;

	function norm(s: string): string {
		return s.trim().toLowerCase();
	}

	$effect(() => {
		search;
		edgeKind;
		queueMicrotask(() => scheduleGraphUpdate?.());
	});

	$effect(() => {
		data.snapshot;
		queueMicrotask(() => scheduleGraphUpdate?.());
	});

	$effect(() => {
		const id = selectedNode?.id ?? null;
		queueMicrotask(() => scheduleApplyHighlight?.(id));
	});

	$effect(() => {
		if (selectedNode !== null) return;
		queueMicrotask(() => scheduleRestorePreEntityZoom?.());
	});

	onMount(() => {
		let cancelled = false;

		(async () => {
			const d3 = await import('d3');
			if (cancelled || !rootEl) return;

			const persistentNodes = new Map<string, SimNode>();

			function simNodeFromSnapshot(n: (typeof data.snapshot.nodes)[number]): SimNode {
				let s = persistentNodes.get(n.id);
				if (!s) {
					s = { id: n.id, kind: n.kind, label: n.label, subtype: n.subtype };
					persistentNodes.set(n.id, s);
				} else {
					s.kind = n.kind;
					s.label = n.label;
					s.subtype = n.subtype;
				}
				return s;
			}

			function prunePersistentToSnapshot(snapshot: typeof data.snapshot) {
				const keep = new Set(snapshot.nodes.map((n) => n.id));
				for (const id of persistentNodes.keys()) {
					if (!keep.has(id)) persistentNodes.delete(id);
				}
			}

			const svg = d3
				.select(rootEl)
				.append('svg')
				.attr('class', 'graph-svg block h-full w-full touch-none');
			svg
				.append('defs')
				.append('filter')
				.attr('id', 'graph-node-selected-glow')
				.attr('x', '-40%')
				.attr('y', '-40%')
				.attr('width', '180%')
				.attr('height', '180%')
				.call((f) => {
					f.append('feGaussianBlur')
						.attr('in', 'SourceAlpha')
						.attr('stdDeviation', 2)
						.attr('result', 'graphBlur');
					const m = f.append('feMerge');
					m.append('feMergeNode').attr('in', 'graphBlur');
					m.append('feMergeNode').attr('in', 'SourceGraphic');
				});

			const gZoom = svg.append('g');
			const gLinks = gZoom.append('g').attr('class', 'graph-links').attr('stroke', 'currentColor').attr('stroke-opacity', 0.35);
			const gNodes = gZoom.append('g').attr('class', 'graph-nodes');

			const zoom = d3
				.zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.15, 8])
				.on('zoom', (event) => {
					gZoom.attr('transform', event.transform.toString());
				});
			svg.call(zoom);
			svg.on('click.details-clear', (event) => {
				const el = event.target as Element | null;
				if (!el?.closest?.('.graph-node')) selectedNode = null;
			});

			let preEntityZoomTransform: ReturnType<typeof d3.zoomIdentity> | null = null;
			let focusSessionBaseK: number | null = null;

			function restorePreEntityZoom() {
				const svgEl = svg.node();
				if (!svgEl || !preEntityZoomTransform) return;
				const t = preEntityZoomTransform;
				preEntityZoomTransform = null;
				focusSessionBaseK = null;
				resizeSvg();
				const next = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
				svg.interrupt('zoom-center');
				svg
					.transition('zoom-center')
					.duration(520)
					.ease(d3.easeCubicInOut)
					.call(zoom.transform, next);
			}

			function scheduleRestorePreEntityZoomInner() {
				requestAnimationFrame(() => {
					if (selectedNode !== null) return;
					restorePreEntityZoom();
				});
			}

			/** `panOnly`: after resize, pan without changing scale. `focus`: one zoom step from `focusSessionBaseK` then pan. */
			function centerViewOnNode(d: SimNode, mode: 'focus' | 'panOnly' = 'focus') {
				const svgEl = svg.node();
				if (!svgEl || !rootEl) return;
				resizeSvg();

				if (simulation) {
					let i = 0;
					const cap = 500;
					while (
						i < cap &&
						(!Number.isFinite(d.x) ||
							!Number.isFinite(d.y) ||
							simulation.alpha() > 0.02)
					) {
						simulation.tick();
						i++;
					}
				}

				const nx = d.x ?? 0;
				const ny = d.y ?? 0;
				if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

				const w =
					svgEl instanceof SVGSVGElement && svgEl.width.baseVal
						? Math.max(1, svgEl.width.baseVal.value)
						: Math.max(1, svgEl.clientWidth);
				const h =
					svgEl instanceof SVGSVGElement && svgEl.height.baseVal
						? Math.max(1, svgEl.height.baseVal.value)
						: Math.max(1, svgEl.clientHeight);
				const cx = w / 2;
				const cy = h / 2;

				const t = d3.zoomTransform(svgEl);
				const [minK, maxK] = zoom.scaleExtent();
				const FOCUS_ZOOM_STEP = 1.32;
				const baseK = focusSessionBaseK ?? t.k;
				const targetK =
					mode === 'panOnly'
						? t.k
						: Math.min(maxK, Math.max(minK, Math.min(2.35, baseK * FOCUS_ZOOM_STEP)));

				svg.interrupt('zoom-center');
				const tr = svg.transition('zoom-center').duration(320).ease(d3.easeCubicInOut);
				if (mode === 'panOnly' || Math.abs(t.k - targetK) <= 0.04) {
					tr.call(zoom.translateTo, nx, ny, [cx, cy]);
				} else {
					tr.call(zoom.scaleTo, targetK, [cx, cy])
						.transition()
						.duration(320)
						.ease(d3.easeCubicInOut)
						.call(zoom.translateTo, nx, ny, [cx, cy]);
				}
			}

			function scheduleCenterViewOnNode(nodeId: string) {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						const sim = persistentNodes.get(nodeId);
						if (!sim || selectedNode?.id !== nodeId) return;
						centerViewOnNode(sim);
					});
				});
			}

			function maybeRecenterSelectedNode() {
				const n = selectedNode;
				if (!n) return;
				const id = n.id;
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						if (selectedNode?.id !== id) return;
						const simFresh = persistentNodes.get(id);
						if (!simFresh) return;
						centerViewOnNode(simFresh, 'panOnly');
					});
				});
			}

			function resizeSvg() {
				if (!rootEl) return;
				const w = rootEl.clientWidth;
				const h = Math.max(1, rootEl.clientHeight);
				svg.attr('width', w).attr('height', h);
				return { w, h };
			}

			let simulation: d3.Simulation<SimNode, SimLink> | null = null;
			let linkSelection = gLinks.selectAll<SVGLineElement, SimLink>('line');
			let nodeSelection = gNodes.selectAll<SVGGElement, SimNode>('g.graph-node');

			const dragBehavior = d3
				.drag<SVGGElement, SimNode>()
				.on('start', (event, d) => {
					if (!event.active) simulation?.alphaTarget(0.35).restart();
					d.fx = d.x;
					d.fy = d.y;
				})
				.on('drag', (event, d) => {
					d.fx = event.x;
					d.fy = event.y;
				})
				.on('end', (event, d) => {
					if (!event.active) simulation?.alphaTarget(0);
					d.fx = null;
					d.fy = null;
				});

			function nodeRadius(d: SimNode) {
				return d.kind === 'Entity' ? 9 : 7;
			}

			function nodeFill(d: SimNode) {
				return nodeFillForGraph(d.kind, d.subtype);
			}

			function labelText(d: SimNode) {
				const base = d.label || d.id;
				return base.length > 42 ? `${base.slice(0, 40)}…` : base;
			}

			function applyHighlight(selectedId: string | null) {
				nodeSelection.each(function (d) {
					const sel = d3.select(this);
					const circle = sel.select<SVGCircleElement>('circle');
					const on = selectedId !== null && d.id === selectedId;
					circle
						.attr('stroke-width', on ? 3.2 : 1)
						.attr('stroke', on ? '#fbbf24' : 'currentColor')
						.attr('filter', on ? 'url(#graph-node-selected-glow)' : null);
				});
			}

			function ticked() {
				linkSelection
					.attr('x1', (d) => (d.source as SimNode).x ?? 0)
					.attr('y1', (d) => (d.source as SimNode).y ?? 0)
					.attr('x2', (d) => (d.target as SimNode).x ?? 0)
					.attr('y2', (d) => (d.target as SimNode).y ?? 0);

				nodeSelection.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			}

			function onNodeClick(event: MouseEvent, d: SimNode) {
				event.stopPropagation();
				const prev = selectedNode;
				const hit = data.snapshot.nodes.find((n) => n.id === d.id);
				selectedNode = hit ?? null;
				if (hit) {
					if (!prev) {
						const svgEl = svg.node();
						if (svgEl) {
							const cur = d3.zoomTransform(svgEl);
							preEntityZoomTransform = cur.copy();
							focusSessionBaseK = cur.k;
						}
					}
					if (prev?.id !== hit.id) {
						scheduleCenterViewOnNode(hit.id);
					}
				}
				scheduleApplyHighlight?.(hit?.id ?? null);
			}

			function updateGraph() {
				const dims = resizeSvg();
				if (!dims) return;

				prunePersistentToSnapshot(data.snapshot);

				const rawNodes: SimNode[] = data.snapshot.nodes.map((n) => simNodeFromSnapshot(n));
				const q = norm(search);
				const nodeMatch = (n: SimNode) =>
					q.length === 0 || norm(n.label).includes(q) || norm(n.id).includes(q) || norm(n.subtype).includes(q);

				const visibleIds = new Set(rawNodes.filter(nodeMatch).map((n) => n.id));
				if (q.length > 0) {
					for (const e of data.snapshot.edges) {
						if (visibleIds.has(e.sourceId) || visibleIds.has(e.targetId)) {
							visibleIds.add(e.sourceId);
							visibleIds.add(e.targetId);
						}
					}
				}

				const nodes = rawNodes.filter((n) => visibleIds.has(n.id));
				if (selectedNode && !visibleIds.has(selectedNode.id)) {
					selectedNode = null;
				}
				const edgeFilter = (e: (typeof data.snapshot.edges)[0]) => {
					if (edgeKind !== 'all' && e.kind !== edgeKind) return false;
					return visibleIds.has(e.sourceId) && visibleIds.has(e.targetId);
				};
				const links: SimLink[] = data.snapshot.edges
					.filter(edgeFilter)
					.map((e) => ({
						id: e.id,
						source: e.sourceId,
						target: e.targetId,
						relationType: e.relationType,
						kind: e.kind
					}));

				linkSelection = gLinks
					.selectAll<SVGLineElement, SimLink>('line')
					.data(links, (d) => d.id)
					.join('line')
					.attr('stroke-width', 1.2);

				nodeSelection = gNodes
					.selectAll<SVGGElement, SimNode>('g.graph-node')
					.data(nodes, (d) => d.id)
					.join(
						(enter) => {
							const g = enter.append('g').attr('class', 'graph-node');
							g.append('circle')
								.attr('r', nodeRadius)
								.attr('fill', nodeFill)
								.attr('stroke', 'currentColor')
								.attr('stroke-width', 1);
							g.append('title').text((d) => `${d.kind}: ${d.label || d.id}\n${d.subtype}`);
							g.append('text')
								.attr('x', 12)
								.attr('y', 4)
								.attr('class', 'fill-foreground text-[10px] font-mono')
								.text(labelText);
							return g;
						},
						(update) => {
							update.select('title').text((d) => `${d.kind}: ${d.label || d.id}\n${d.subtype}`);
							update
								.select('text')
								.text(labelText);
							update
								.select('circle')
								.attr('r', nodeRadius)
								.attr('fill', nodeFill);
							return update;
						},
						(exit) => exit.remove()
					)
					.style('cursor', 'pointer')
					.call(dragBehavior)
					.on('click.details', onNodeClick);

				if (!simulation) {
					simulation = d3
						.forceSimulation<SimNode>(nodes)
						.force(
							'link',
							d3
								.forceLink<SimNode, SimLink>(links)
								.id((d) => d.id)
								.distance((l) => (l.kind === 'entity_relation' ? 100 : 70))
						)
						.force('charge', d3.forceManyBody<SimNode>().strength(-140))
						.force('center', d3.forceCenter(dims.w / 2, dims.h / 2))
						.force('collision', d3.forceCollide<SimNode>().radius(22))
						.on('tick', ticked);
				} else {
					simulation.nodes(nodes);
					const linkForce = simulation.force('link') as ReturnType<typeof d3.forceLink<SimNode, SimLink>>;
					linkForce.links(links);
					simulation.force('center', d3.forceCenter(dims.w / 2, dims.h / 2));
					simulation.force(
						'collision',
						d3.forceCollide<SimNode>().radius(22)
					);
					simulation.alpha(0.35).restart();
				}

				applyHighlight(selectedNode?.id ?? null);
				status = `${nodes.length} nodes · ${links.length} edges (live FalkorDB)`;
			}

			function resizeGraph() {
				const dims = resizeSvg();
				if (!dims || !simulation) return;
				simulation.force('center', d3.forceCenter(dims.w / 2, dims.h / 2));
				simulation.alpha(0.08).restart();
			}

			scheduleGraphUpdate = updateGraph;
			scheduleGraphResize = resizeGraph;
			scheduleApplyHighlight = (id) => applyHighlight(id);
			scheduleRestorePreEntityZoom = scheduleRestorePreEntityZoomInner;

			let lastGraphResizeHeight: number | null = null;

			updateGraph();

			const ro = new ResizeObserver(() => {
				scheduleGraphResize?.();
				const h = rootEl?.clientHeight ?? 0;
				if (selectedNode && lastGraphResizeHeight !== null && h !== lastGraphResizeHeight) {
					maybeRecenterSelectedNode();
				}
				lastGraphResizeHeight = h;
			});
			ro.observe(rootEl);

			teardown = () => {
				cancelled = true;
				scheduleGraphUpdate = null;
				scheduleGraphResize = null;
				scheduleApplyHighlight = null;
				scheduleRestorePreEntityZoom = null;
				preEntityZoomTransform = null;
				focusSessionBaseK = null;
				simulation?.stop();
				ro.disconnect();
				svg.remove();
			};
		})();

		return () => teardown?.();
	});
</script>

<div class="h-screen overflow-hidden">
	<Card.Root class="mt-4 flex h-[calc(100vh-7.5rem)] flex-col overflow-hidden bg-transparent shadow-none">
		<Card.Header class="min-w-0 gap-2 pb-2">
			<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<div class="flex shrink-0 items-center gap-1">
					<Popover.Root bind:open={searchPopoverOpen}>
						<Popover.Trigger
							class="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-none border shadow-none transition-colors focus-visible:ring-1 focus-visible:outline-none {searchFilterActive
								? 'ring-primary/40 bg-muted/40 ring-1'
								: ''}"
							aria-label="Search nodes"
							aria-expanded={searchPopoverOpen}
						>
							<SearchIcon class="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
						</Popover.Trigger>
						<Popover.Content align="start" side="bottom" sideOffset={6} class="w-[min(calc(100vw-2rem),22rem)] gap-2 p-3">
							<Label for="graph-search" class="text-xs">Search nodes</Label>
							<Input
								id="graph-search"
								class="font-mono text-xs"
								placeholder="Filter by label, id, or subtype…"
								bind:value={search}
							/>
						</Popover.Content>
					</Popover.Root>
					<Popover.Root bind:open={edgePopoverOpen}>
						<Popover.Trigger
							class="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-none border shadow-none transition-colors focus-visible:ring-1 focus-visible:outline-none {edgeFilterActive
								? 'ring-primary/40 bg-muted/40 ring-1'
								: ''}"
							aria-label="Edge type filter"
							aria-expanded={edgePopoverOpen}
						>
							<Link2 class="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
						</Popover.Trigger>
						<Popover.Content align="start" side="bottom" sideOffset={6} class="w-64 gap-2 p-3">
							<Label class="text-xs">Edge type</Label>
							<Select.Root type="single" bind:value={edgeKind}>
								<Select.Trigger class="w-full font-mono text-xs">
									{edgeKind === 'all'
										? 'All edges'
										: edgeKind === 'thought_link'
											? 'Thought links'
											: edgeKind === 'mention'
												? 'Mentions'
												: 'Entity relations'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="all">All edges</Select.Item>
									<Select.Item value="thought_link">Thought → Thought</Select.Item>
									<Select.Item value="mention">Thought → Entity</Select.Item>
									<Select.Item value="entity_relation">Entity → Entity</Select.Item>
								</Select.Content>
							</Select.Root>
						</Popover.Content>
					</Popover.Root>
				</div>
				<form method="post" action="?/recomputeOntology" use:enhance class="contents">
					<Button type="submit" variant="outline" size="xs" class="shrink-0">
						Recompute ontology
					</Button>
				</form>
				{#if status}
					<p class="text-muted-foreground min-w-0 font-mono text-[11px] leading-tight">{status}</p>
				{/if}
				{#if form?.ontologyMessage}
					<p
						class="w-full min-w-0 text-[11px] leading-tight {form.ontologyFailed
							? 'text-destructive'
							: 'text-muted-foreground'}"
					>
						{form.ontologyMessage}
					</p>
				{/if}
			</div>
			<aside
				class="border-border/80 bg-muted/10 w-full min-w-0 max-w-full rounded-md border px-2 py-1"
				aria-label="Graph ontology legend"
			>
				<div
					bind:this={legendScrollEl}
					class="min-w-0 w-full max-w-full touch-pan-x overflow-x-auto overscroll-x-contain scroll-pl-2 scroll-pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				>
					<div
						class="text-foreground flex w-max min-w-full flex-nowrap items-center gap-x-2 text-[10px] leading-none"
					>
						{#each legendSections as section, si (section.title)}
							<div class="flex shrink-0 flex-nowrap items-center gap-x-2">
								{#if si > 0}
									<span class="text-muted-foreground/45 shrink-0 select-none" aria-hidden="true">·</span>
								{/if}
								<span
									class="text-muted-foreground shrink-0 font-semibold tracking-tight"
									title={section.title}>{section.title}:</span>
								{#each section.items as item (item.key)}
									<span
										class="border-border/60 bg-muted/25 text-foreground inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5"
										title={item.hint}
									>
										{#if item.fill}
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
										<span class="font-medium">{item.label}</span>
									</span>
								{/each}
							</div>
						{/each}
					</div>
				</div>
			</aside>
		</Card.Header>
		<Card.Content class="flex min-h-0 flex-1 flex-col p-0">
			<div class="relative min-h-0 w-full flex-1">
				<div
					bind:this={rootEl}
					class="text-foreground h-full min-h-0 w-full"
					role="img"
					aria-label="Interactive graph visualization"
				></div>
			</div>
			{#if selectedNode}
				<div
					class="border-border bg-background/95 shrink-0 border-t px-4 py-3 backdrop-blur-sm"
					role="region"
					aria-label="Selected node details"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1 space-y-1">
							<p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
								{selectedNode.kind === 'Entity' ? 'Entity' : 'Thought'}
							</p>
							<p class="text-foreground truncate text-sm font-semibold">
								{selectedNode.label || '—'}
							</p>
							<dl class="text-muted-foreground grid gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-2">
								<div class="contents">
									<dt class="text-muted-foreground/80">Type</dt>
									<dd class="text-foreground truncate">{selectedNode.subtype || '—'}</dd>
								</div>
								<div class="contents">
									<dt class="text-muted-foreground/80">Id</dt>
									<dd class="text-foreground truncate">{selectedNode.id}</dd>
								</div>
							</dl>
						</div>
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground shrink-0 rounded-md px-2 py-1 text-xs"
							onclick={() => (selectedNode = null)}
						>
							Close
						</button>
					</div>
					{#if selectedEdges.length > 0}
						<div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
							<p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
								Connections ({selectedEdges.length})
							</p>
							<ul class="max-h-32 space-y-1.5 overflow-y-auto font-mono text-[11px]">
								{#each selectedEdges as e (e.id)}
									{@const otherId = e.sourceId === selectedNode.id ? e.targetId : e.sourceId}
									{@const other = nodeById.get(otherId)}
									<li class="text-foreground flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
										<span class="text-muted-foreground shrink-0">{e.kind}</span>
										<span class="text-muted-foreground shrink-0">·</span>
										<span class="min-w-0 truncate">{e.relationType}</span>
										<span class="text-muted-foreground shrink-0">→</span>
										<span class="min-w-0 truncate" title={otherId}>
											{other?.kind === 'Entity' ? 'Entity' : other?.kind === 'Thought' ? 'Thought' : '?'}:
											{other?.label || otherId}
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<style>
	:global(html),
	:global(body) {
		overflow: hidden;
	}
</style>
