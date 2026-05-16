<script lang="ts">
	import { onMount } from 'svelte';
	import { nodeFillForGraph, customEntityFillsFromLegendSections, type GraphLegendSection } from '$lib/graph/graph-ontology-legend';

	type GraphVizNode = {
		id: string;
		kind: 'Thought' | 'Entity';
		label: string;
		subtype: string;
	};

	type GraphVizEdge = {
		id: string;
		sourceId: string;
		targetId: string;
		relationType: string;
		kind: string;
	};

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

	let {
		nodes,
		edges,
		legendSections = [],
		statusSuffix = '',
		height = '400px'
	}: {
		nodes: GraphVizNode[];
		edges: GraphVizEdge[];
		legendSections?: GraphLegendSection[];
		statusSuffix?: string;
		height?: string;
	} = $props();

	let rootEl: HTMLDivElement | undefined;
	let status = $state('');

	onMount(() => {
		let cancelled = false;
		let teardown: (() => void) | undefined;

		(async () => {
			const d3 = await import('d3');
			if (cancelled || !rootEl) return;

			const persistentNodes = new Map<string, SimNode>();

			function simNodeFromSnapshot(n: GraphVizNode): SimNode {
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

			const svg = d3
				.select(rootEl)
				.append('svg')
				.attr('class', 'block h-full w-full touch-none');

			svg
				.append('defs')
				.append('filter')
				.attr('id', 'fg-node-glow')
				.attr('x', '-40%').attr('y', '-40%')
				.attr('width', '180%').attr('height', '180%')
				.call((f) => {
					f.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', 2).attr('result', 'blur');
					const m = f.append('feMerge');
					m.append('feMergeNode').attr('in', 'blur');
					m.append('feMergeNode').attr('in', 'SourceGraphic');
				});

			const gZoom = svg.append('g');
			const gLinks = gZoom.append('g').attr('stroke', 'currentColor').attr('stroke-opacity', 0.35);
			const gNodes = gZoom.append('g');

			const zoom = d3
				.zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.15, 8])
				.on('zoom', (event) => {
					gZoom.attr('transform', event.transform.toString());
				});
			svg.call(zoom);

			function resizeSvg() {
				if (!rootEl) return;
				const w = rootEl.clientWidth;
				const h = Math.max(1, rootEl.clientHeight);
				svg.attr('width', w).attr('height', h);
				return { w, h };
			}

			const customEntityFills = customEntityFillsFromLegendSections(legendSections);

			function nodeFill(d: SimNode) {
				return nodeFillForGraph(d.kind, d.subtype, customEntityFills);
			}

			function labelText(d: SimNode) {
				const base = d.label || d.id;
				return base.length > 42 ? `${base.slice(0, 40)}…` : base;
			}

			function ticked(
				linkSel: ReturnType<typeof gLinks.selectAll<SVGGElement, SimLink>>,
				nodeSel: ReturnType<typeof gNodes.selectAll<SVGGElement, SimNode>>
			) {
				linkSel.select('line')
					.attr('x1', (d) => (d.source as SimNode).x ?? 0)
					.attr('y1', (d) => (d.source as SimNode).y ?? 0)
					.attr('x2', (d) => (d.target as SimNode).x ?? 0)
					.attr('y2', (d) => (d.target as SimNode).y ?? 0);

				linkSel.select('circle')
					.attr('cx', (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
					.attr('cy', (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2);

				linkSel.select('text')
					.attr('x', (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
					.attr('y', (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2);

				nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			}

			const dims = resizeSvg();
			if (!dims) return;

			const simNodes: SimNode[] = nodes.map((n) => simNodeFromSnapshot(n));
			const simLinks: SimLink[] = edges.map((e) => ({
				id: e.id,
				source: e.sourceId,
				target: e.targetId,
				relationType: e.relationType,
				kind: e.kind
			}));

			let linkSel = gLinks
				.selectAll<SVGGElement, SimLink>('g')
				.data(simLinks, (d) => d.id)
				.join((enter) => {
					const g = enter.append('g');
					g.append('line').attr('stroke-width', 1.2);
					g.append('circle').attr('r', 2).attr('fill', 'currentColor').attr('stroke', 'none');
					g.append('text')
						.attr('class', 'fill-muted-foreground text-[9px] font-mono')
						.attr('text-anchor', 'middle')
						.attr('dy', '1.4em')
						.attr('stroke', 'var(--background)')
						.attr('stroke-width', '2.5')
						.attr('paint-order', 'stroke')
						.text((d) => d.relationType || d.kind);
					return g;
				});

			let nodeSel = gNodes
				.selectAll<SVGGElement, SimNode>('g')
				.data(simNodes, (d) => d.id)
				.join((enter) => {
					const g = enter.append('g').style('cursor', 'default');
					g.append('circle').attr('r', 8).attr('fill', nodeFill).attr('stroke', 'currentColor').attr('stroke-width', 1);
					g.append('title').text((d) => `${d.kind}: ${d.label || d.id}\n${d.subtype}`);
					g.append('text')
						.attr('x', 12).attr('y', 4)
						.attr('class', 'fill-foreground text-[10px] font-mono')
						.text(labelText);
					return g;
				});

			const simulation = d3
				.forceSimulation<SimNode>(simNodes)
				.force('link', d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(40))
				.force('charge', d3.forceManyBody<SimNode>().strength(-500))
				.force('x', d3.forceX<SimNode>(dims.w / 2).strength(0.08))
				.force('y', d3.forceY<SimNode>(dims.h / 2).strength(0.08))
				.force('collision', d3.forceCollide<SimNode>().radius(40))
				.on('tick', () => ticked(linkSel, nodeSel));

			// Run headless to present an already-relaxed layout on first paint
			simulation.stop();
			for (let i = 0; i < 80; i++) simulation.tick();
			ticked(linkSel, nodeSel);
			simulation.restart();

			status = `${simNodes.length} nodes · ${simLinks.length} edges${statusSuffix ? ' · ' + statusSuffix : ''}`;

			const ro = new ResizeObserver(() => {
				const d = resizeSvg();
				if (!d || !simulation) return;
				simulation.force('x', d3.forceX<SimNode>(d.w / 2).strength(0.08));
				simulation.force('y', d3.forceY<SimNode>(d.h / 2).strength(0.08));
				simulation.alpha(0.08).restart();
			});
			ro.observe(rootEl);

			teardown = () => {
				cancelled = true;
				simulation.stop();
				ro.disconnect();
				svg.remove();
			};
		})();

		return () => teardown?.();
	});
</script>

<div class="flex h-full min-h-0 flex-col">
	{#if status}
		<p class="text-muted-foreground mb-1 font-mono text-[11px] leading-tight">{status}</p>
	{/if}
	<div
		bind:this={rootEl}
		class="text-foreground min-h-0 w-full flex-1"
		style="height: {height}"
		role="img"
		aria-label="Force-directed graph visualization"
	></div>
</div>
