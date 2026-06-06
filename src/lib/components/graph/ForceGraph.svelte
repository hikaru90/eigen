<script lang="ts">
	import { onMount } from 'svelte';
	import { filterGraphVizEdgesToNodes, resolveForceLinks } from '$lib/graph/sanitize-viz-snapshot';
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
		height = '400px',
		interactive = true,
		showStatus = true,
		/** 0–1 scroll-driven zoom when `interactive` is false (marketing story). */
		presentationProgress = 0,
		/** node id → beat progress when the node fades in (presentation mode). */
		presentationReveals = {} as Record<string, number>
	}: {
		nodes: GraphVizNode[];
		edges: GraphVizEdge[];
		legendSections?: GraphLegendSection[];
		statusSuffix?: string;
		height?: string;
		interactive?: boolean;
		showStatus?: boolean;
		presentationProgress?: number;
		presentationReveals?: Record<string, number>;
	} = $props();

	const fillParent = $derived(height === '100%');

	let rootEl: HTMLDivElement | undefined;
	let status = $state('');
	let applyPresentationFrame: ((t: number) => void) | null = null;
	let lastPresentationProgress = 0;
	let presentationMounted = $state(false);

	function clampPresentationProgress(t: number) {
		return Math.min(1, Math.max(0, t));
	}

	function easePresentation(t: number) {
		const x = clampPresentationProgress(t);
		return x * x * (3 - 2 * x);
	}

	$effect(() => {
		if (interactive) return;
		void presentationMounted;
		lastPresentationProgress = clampPresentationProgress(presentationProgress);
		applyPresentationFrame?.(lastPresentationProgress);
	});

	onMount(() => {
		let cancelled = false;
		let teardown: (() => void) | undefined;

		(async () => {
			const d3 = await import('d3');
			if (cancelled || !rootEl) return;

			async function waitForLayout(el: HTMLElement): Promise<{ w: number; h: number } | null> {
				const deadline = performance.now() + 2500;
				while (performance.now() < deadline) {
					if (cancelled) return null;
					const w = el.clientWidth;
					const h = el.clientHeight;
					if (w >= 80 && h >= 80) return { w, h: Math.max(1, h) };
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				}
				return null;
			}

			const layout = await waitForLayout(rootEl);
			if (cancelled || !rootEl || !layout) return;

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
			if (interactive) {
				svg.call(zoom);
			}

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

			const dims = resizeSvg() ?? layout;
			if (!dims) return;

			const sanitized = filterGraphVizEdgesToNodes(nodes, edges);
			const simNodes: SimNode[] = sanitized.nodes.map((n) => simNodeFromSnapshot(n));
			const simLinks: SimLink[] = resolveForceLinks(simNodes, sanitized.edges);

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
					const inner = g.append('g').attr('class', 'fg-node-inner');
					inner
						.append('circle')
						.attr('class', 'fg-node-flash-bg')
						.attr('r', 8)
						.attr('fill', '#28F97F')
						.attr('stroke', 'none')
						.attr('opacity', 0);
					inner
						.append('circle')
						.attr('class', 'fg-node-reveal-ring')
						.attr('r', 8)
						.attr('fill', 'none')
						.attr('stroke', '#28F97F')
						.attr('stroke-width', 2)
						.attr('opacity', 0);
					inner
						.append('circle')
						.attr('class', 'fg-node-core')
						.attr('r', 8)
						.attr('fill', nodeFill)
						.attr('stroke', 'currentColor')
						.attr('stroke-width', 1);
					g.append('title').text((d) => `${d.kind}: ${d.label || d.id}\n${d.subtype}`);
					inner
						.append('text')
						.attr('x', 12)
						.attr('y', 4)
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

			function relayoutSimulation(d: { w: number; h: number }, alpha = 1) {
				simulation.force('x', d3.forceX<SimNode>(d.w / 2).strength(0.08));
				simulation.force('y', d3.forceY<SimNode>(d.h / 2).strength(0.08));
				simulation.alpha(alpha).restart();
				simulation.stop();
				for (let i = 0; i < 80; i += 1) simulation.tick();
				ticked(linkSel, nodeSel);
				simulation.restart();
			}

			status = `${simNodes.length} nodes · ${simLinks.length} edges${statusSuffix ? ' · ' + statusSuffix : ''}`;

			const presentationRevealMap = presentationReveals;
			const presentationMode = !interactive && Object.keys(presentationRevealMap).length > 0;
			const revealWindow = 0.1;

			function nodeRevealAt(nodeId: string) {
				if (!(nodeId in presentationRevealMap)) return 1;
				return presentationRevealMap[nodeId] ?? 1;
			}

			function nodeRevealProgress(nodeId: string, t: number) {
				const at = nodeRevealAt(nodeId);
				if (at >= 1) return 0;
				if (at <= 0) return 1;
				if (t <= at) return 0;
				return clampPresentationProgress((t - at) / revealWindow);
			}

			function nodeIsVisible(nodeId: string, t: number) {
				return nodeRevealProgress(nodeId, t) > 0.001;
			}

			function linkEndpointId(endpoint: string | SimNode) {
				return typeof endpoint === 'string' ? endpoint : endpoint.id;
			}

			// Freeze layout — marketing graph is a staged demo, not a live simulation.
			for (const node of simNodes) {
				node.fx = node.x;
				node.fy = node.y;
			}
			simulation.stop();

			applyPresentationFrame = (t: number) => {
				if (!rootEl) return;
				const w = rootEl.clientWidth;
				const h = Math.max(1, rootEl.clientHeight);
				const eased = easePresentation(t);
				const kEnd = 1.47;
				const kStart = kEnd * 0.5;
				const k = kStart + (kEnd - kStart) * eased;
				const tx = w * 0.5 * (1 - k) + eased * 9;
				const ty = h * 0.5 * (1 - k) - eased * 7;
				gZoom.attr('transform', `translate(${tx},${ty}) scale(${k})`);

				nodeSel.each(function (d) {
					const at = nodeRevealAt(d.id);
					const rawT = nodeRevealProgress(d.id, t);
					const rt = easePresentation(rawT);
					const visible = rawT > 0.001;
					const outer = d3.select(this);

					outer.style('display', visible ? null : 'none');

					if (!visible) return;

					const inner = outer.select<SVGGElement>('.fg-node-inner');
					const pop = at > 0 ? 0.08 + rt * 0.92 : 1;
					const overshoot = at > 0 && rawT < 1 ? 1 + Math.sin(rawT * Math.PI) * 0.12 : 1;
					const revealFlash = at > 0 && rawT > 0 && rawT < 1 ? (1 - rawT) ** 0.45 : 0;
					inner
						.attr('opacity', at > 0 ? rt : 1)
						.attr('transform', `scale(${pop * overshoot})`);

					inner
						.select('.fg-node-flash-bg')
						.attr('opacity', revealFlash)
						.attr('r', 8 + revealFlash * 5);

					inner
						.select('.fg-node-core')
						.attr('fill', revealFlash > 0.02 ? '#28F97F' : nodeFill(d));

					const ringOpacity = at > 0 && rawT > 0 && rawT < 1 ? (1 - rawT) * 0.95 : 0;
					inner
						.select('.fg-node-reveal-ring')
						.attr('opacity', ringOpacity)
						.attr('r', 8 + (1 - rawT) * 24);
				});

				linkSel.style('display', (d) => {
					const sourceId = linkEndpointId(d.source);
					const targetId = linkEndpointId(d.target);
					return nodeIsVisible(sourceId, t) && nodeIsVisible(targetId, t) ? null : 'none';
				});
				linkSel.attr('opacity', (d) => {
					const sourceId = linkEndpointId(d.source);
					const targetId = linkEndpointId(d.target);
					return Math.min(nodeRevealProgress(sourceId, t), nodeRevealProgress(targetId, t));
				});
			};
			if (presentationMode) {
				applyPresentationFrame(clampPresentationProgress(presentationProgress));
				presentationMounted = true;
			} else if (!interactive) {
				applyPresentationFrame(clampPresentationProgress(presentationProgress));
			}

			const ro = new ResizeObserver(() => {
				const d = resizeSvg();
				if (!d || !simulation) return;
				const grew =
					d.w > dims.w * 1.35 ||
					d.h > dims.h * 1.35 ||
					(dims.h <= 80 && d.h > 80);
				if (grew) {
					relayoutSimulation(d);
					if (!interactive && applyPresentationFrame) {
						applyPresentationFrame(lastPresentationProgress);
					}
					return;
				}
				simulation.force('x', d3.forceX<SimNode>(d.w / 2).strength(0.08));
				simulation.force('y', d3.forceY<SimNode>(d.h / 2).strength(0.08));
				if (!presentationMode) {
					simulation.alpha(0.08).restart();
				}
				if (!interactive && applyPresentationFrame) {
					applyPresentationFrame(lastPresentationProgress);
				}
			});
			ro.observe(rootEl);

			teardown = () => {
				cancelled = true;
				applyPresentationFrame = null;
				simulation.stop();
				ro.disconnect();
				svg.remove();
			};
		})();

		return () => teardown?.();
	});
</script>

<div class="flex h-full min-h-0 flex-col">
	{#if showStatus && status}
		<p class="text-muted-foreground mb-1 font-mono text-[11px] leading-tight">{status}</p>
	{/if}
	<div
		bind:this={rootEl}
		class="text-foreground min-h-0 w-full flex-1 {interactive ? '' : 'pointer-events-none'}"
		style={fillParent ? undefined : `height: ${height}`}
		role="img"
		aria-label="Force-directed graph visualization"
	></div>
</div>
