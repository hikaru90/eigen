<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { computeBallLinks, linksForShader, type BallLinkSegment } from '../../../routes/logo/ball-links';
	import {
		createMetaballRenderer,
		EIGEN_ACCENT_METABALL_COLOR,
		type Metaball,
		type MetaballRenderer
	} from '../../../routes/logo/metaball-gl';
	import {
		DEFAULT_METABALL_FIELD_PARAMS,
		type MetaballFieldParams
	} from '../../../routes/logo/metaball-params';

	type FloatingMetaball = {
		ox: number;
		oy: number;
		x: number;
		y: number;
		r: number;
		vx: number;
		vy: number;
		phase: number;
		drift: number;
	};

	const heroUsps = [
		'Self-hostable',
		'Open source',
		'Data sovereignty',
		'Context sharing',
		'Remember everything',
		'Temporal awareness',
		'MCP connections',
		'Data portability',
		'No subscription',
		'Full transparency',
		'Encrypted at rest',
		'Row-level security'
	] as const;

	const METABALL_COUNT = heroUsps.length;
	const METABALL_BASE_RADIUS = 60;
	const METABALL_RADIUS_VARIANCE = 22;
	const METABALL_DRIFT_MIN = 1.2;
	const METABALL_DRIFT_MAX = 3.2;
	const METABALL_LINK_NEIGHBORS = 2;
	const METABALL_LINK_DISTANCE_THINNING = 0.75;
	const METABALL_LINK_BASE_OPACITY = 0.3;
	const METABALL_BRIDGE_STRENGTH = 0.6;
	const METABALL_BRIDGE_THINNING = 0.75;
	const LINK_MAX_DISTANCE_RATIO = 0.48;
	const LINK_THICKNESS_MIN = 0.7;
	const LINK_THICKNESS_MAX = 2.8;

	let containerEl: HTMLElement | null = null;
	let metaballStageEl: HTMLDivElement | null = null;
	let metaballCanvasEl: HTMLCanvasElement | null = null;
	let progress = $state(0);
	let metaballWidth = $state(1);
	let metaballHeight = $state(1);
	let metaballRenderer: MetaballRenderer | null = null;
	let glError = $state<string | null>(null);
	let metaballs = $state<FloatingMetaball[]>([]);
	let shaderMetaballLinks = $state<BallLinkSegment[]>([]);
	let uspLabelPositions = $state<{ x: number; y: number }[]>([]);
	let metaballRaf = 0;
	let lastFrameTs = 0;
	let reduceMotion = false;
	const metaballFieldParams: MetaballFieldParams = {
		...DEFAULT_METABALL_FIELD_PARAMS,
		bridgeStrength: METABALL_BRIDGE_STRENGTH,
		bridgeThinning: METABALL_BRIDGE_THINNING,
		noiseMaskOuter: DEFAULT_METABALL_FIELD_PARAMS.noiseMaskOuter,
		noiseMaskInner: DEFAULT_METABALL_FIELD_PARAMS.noiseMaskInner
	};

	function clamp(value: number, min = 0, max = 1) {
		return Math.min(max, Math.max(min, value));
	}

	function segment(start: number, end: number) {
		return clamp((progress - start) / (end - start));
	}

	/** Smoothstep easing (0–1 in, 0–1 out). */
	function ease(t: number) {
		const x = clamp(t);
		return x * x * (3 - 2 * x);
	}

	/**
	 * Plateau opacity: quick eased fade-in, long hold at 1, eased fade-out.
	 * Wider gap between fadeInEnd and fadeOutStart = visible longer.
	 */
	function stageOpacity(fadeInStart: number, fadeInEnd: number, fadeOutStart: number, fadeOutEnd: number) {
		if (progress <= fadeInStart || progress >= fadeOutEnd) return 0;
		if (progress >= fadeInEnd && progress <= fadeOutStart) return 1;
		if (progress < fadeInEnd) return ease(segment(fadeInStart, fadeInEnd));
		return 1 - ease(segment(fadeOutStart, fadeOutEnd));
	}

	function fadeOutOpacity(fadeOutStart: number, fadeOutEnd: number) {
		if (progress <= fadeOutStart) return 1;
		if (progress >= fadeOutEnd) return 0;
		return 1 - ease(segment(fadeOutStart, fadeOutEnd));
	}

	function updateProgress() {
		if (!browser || !containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const travel = rect.height - window.innerHeight;
		if (travel <= 0) {
			progress = 0;
			return;
		}
		progress = clamp(-rect.top / travel);
	}

	function createSeededRandom(seed: number) {
		let state = seed >>> 0;
		return () => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 4294967296;
		};
	}

	function randomBetween(random: () => number, min: number, max: number) {
		return min + random() * (max - min);
	}

	/** Random canvas placement; rejects samples inside a center hole for the headline. */
	function randomBallOrigin(width: number, height: number, radius: number, random: () => number) {
		const cx = width / 2;
		const cy = height / 2;
		const span = Math.min(width, height);
		const minCenterDist = span * 0.2 + radius;
		const minCenterDistSq = minCenterDist * minCenterDist;

		for (let attempt = 0; attempt < 64; attempt += 1) {
			const ox = randomBetween(random, radius, Math.max(radius, width - radius));
			const oy = randomBetween(random, radius, Math.max(radius, height - radius));
			const dx = ox - cx;
			const dy = oy - cy;
			if (dx * dx + dy * dy >= minCenterDistSq) {
				return { ox, oy };
			}
		}

		const angle = randomBetween(random, 0, Math.PI * 2);
		const maxDist = Math.min(cx, cy, width - cx, height - cy) - radius - 8;
		const dist = randomBetween(random, minCenterDist, Math.max(minCenterDist, maxDist));
		return {
			ox: cx + Math.cos(angle) * dist,
			oy: cy + Math.sin(angle) * dist
		};
	}

	function initMetaballRenderer() {
		if (!metaballCanvasEl || metaballWidth < 1 || metaballHeight < 1) return;
		metaballRenderer?.dispose();
		try {
			metaballRenderer = createMetaballRenderer(metaballCanvasEl, metaballWidth, metaballHeight);
			glError = null;
		} catch (error) {
			metaballRenderer = null;
			glError = error instanceof Error ? error.message : 'WebGL2 unavailable';
		}
	}

	function syncMetaballCanvasSize(rect: DOMRectReadOnly) {
		if (!browser) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.max(1, Math.floor(rect.width * dpr));
		const h = Math.max(1, Math.floor(rect.height * dpr));
		if (w === metaballWidth && h === metaballHeight) return;

		const prevW = metaballWidth;
		const prevH = metaballHeight;
		if (metaballs.length > 0 && prevW > 1 && prevH > 1) {
			const sx = w / prevW;
			const sy = h / prevH;
			const scaleR = Math.min(sx, sy);
			metaballs = metaballs.map((ball) => ({
				...ball,
				ox: ball.ox * sx,
				oy: ball.oy * sy,
				x: ball.x * sx,
				y: ball.y * sy,
				r: ball.r * scaleR
			}));
		} else if (w > 1 && h > 1) {
			metaballWidth = w;
			metaballHeight = h;
			initializeMetaballs();
		}

		metaballWidth = w;
		metaballHeight = h;
		initMetaballRenderer();
	}

	function initializeMetaballs() {
		const random = createSeededRandom((Date.now() ^ (Math.random() * 0x1_0000_0000)) >>> 0);
		const span = Math.min(metaballWidth, metaballHeight);
		const driftMin = Math.max(METABALL_DRIFT_MIN, span * 0.01);
		const driftMax = Math.max(METABALL_DRIFT_MAX, span * 0.028);
		const next: FloatingMetaball[] = [];
		for (let i = 0; i < METABALL_COUNT; i += 1) {
			const baseRadius = Math.min(METABALL_BASE_RADIUS, span * (METABALL_COUNT > 10 ? 0.056 : 0.065));
			const r =
				baseRadius +
				randomBetween(random, -METABALL_RADIUS_VARIANCE, METABALL_RADIUS_VARIANCE) *
					(baseRadius / METABALL_BASE_RADIUS);
			const { ox, oy } = randomBallOrigin(metaballWidth, metaballHeight, r, random);
			next.push({
				ox,
				oy,
				x: 0,
				y: 0,
				r,
				vx: 0,
				vy: 0,
				phase: randomBetween(random, 0, Math.PI * 2),
				drift: randomBetween(random, driftMin, driftMax)
			});
		}
		for (const ball of next) {
			ball.x = ball.ox;
			ball.y = ball.oy;
		}
		metaballs = next;
	}

	function recomputeLinksAndRender() {
		const balls: Metaball[] = metaballs.map((ball) => ({ x: ball.x, y: ball.y, r: ball.r }));
		const refDistance = Math.hypot(metaballWidth, metaballHeight) * 0.35;
		const linkMaxDistance = Math.hypot(metaballWidth, metaballHeight) * LINK_MAX_DISTANCE_RATIO;
		const maxDistanceMultiple = linkMaxDistance / Math.max(refDistance, 1);
		const links = computeBallLinks(balls, {
			canvasWidth: metaballWidth,
			canvasHeight: metaballHeight,
			topology: 'nearest',
			neighborsPerBall: METABALL_LINK_NEIGHBORS,
			maxLinkDistance: maxDistanceMultiple,
			distanceThinning: METABALL_LINK_DISTANCE_THINNING,
			minStrokeWidth: LINK_THICKNESS_MIN,
			maxStrokeWidth: LINK_THICKNESS_MAX,
			baseStrokeOpacity: METABALL_LINK_BASE_OPACITY,
			bridgeStrength: METABALL_BRIDGE_STRENGTH,
			bridgeThinning: METABALL_BRIDGE_THINNING
		});
		shaderMetaballLinks = linksForShader(links);
		if (metaballs.length === heroUsps.length) {
			uspLabelPositions = metaballs.map((ball) => uspLabelCanvasPosition(ball));
		}
		metaballRenderer?.draw(
			balls,
			{ amount: 0, seed: 0 },
			metaballFieldParams,
			shaderMetaballLinks,
			EIGEN_ACCENT_METABALL_COLOR
		);
	}

	function tickMetaballs(timestamp: number) {
		const dt = lastFrameTs === 0 ? 0 : Math.min((timestamp - lastFrameTs) / 1000, 0.05);
		lastFrameTs = timestamp;
		if (metaballFrameOpacity > 0.02 && !reduceMotion && dt > 0) {
			const t = timestamp / 1000;
			metaballs = metaballs.map((ball) => {
				const x = ball.ox + Math.cos(t * 0.28 + ball.phase) * ball.drift;
				const y = ball.oy + Math.sin(t * 0.34 + ball.phase) * ball.drift;
				const vx = ball.vx;
				const vy = ball.vy;
				return { ...ball, x, y, vx, vy };
			});
			recomputeLinksAndRender();
		}
		metaballRaf = window.requestAnimationFrame(tickMetaballs);
	}

	onMount(() => {
		if (!browser) return;
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		updateProgress();
		const onScroll = () => updateProgress();
		const onResize = () => {
			updateProgress();
			if (metaballStageEl) syncMetaballCanvasSize(metaballStageEl.getBoundingClientRect());
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onResize, { passive: true });
		metaballRaf = window.requestAnimationFrame(tickMetaballs);
		return () => {
			window.cancelAnimationFrame(metaballRaf);
			metaballRenderer?.dispose();
			metaballRenderer = null;
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
		};
	});

	$effect(() => {
		const el = metaballStageEl;
		if (!browser || !el) return;

		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) syncMetaballCanvasSize(entry.contentRect);
		});
		ro.observe(el);
		syncMetaballCanvasSize(el.getBoundingClientRect());

		return () => ro.disconnect();
	});

	/** Fades metaballs out while scrolling the story; enter zoom is CSS on load, not scroll. */
	const metaballFrameOpacity = $derived(fadeOutOpacity(0.22, 0.34));
	/** Visible on first frame over metaballs; fades out as capture takes over. */
	const headlineOpacity = $derived(fadeOutOpacity(0.36, 0.46));
	const captureOpacity = $derived(stageOpacity(0.12, 0.18, 0.4, 0.48));
	const processOpacity = $derived(stageOpacity(0.24, 0.3, 0.52, 0.6));
	const graphOpacity = $derived(stageOpacity(0.36, 0.42, 0.64, 0.72));
	const retrievalOpacity = $derived(stageOpacity(0.5, 0.56, 0.78, 0.86));
	const timeOpacity = $derived(stageOpacity(0.62, 0.68, 0.94, 1));
	const graphScale = $derived(0.94 + ease(segment(0.36, 0.5)) * 0.06);
	const graphSpread = $derived(12 + ease(segment(0.38, 0.58)) * 40);
	const hitShift = $derived(24 - ease(segment(0.52, 0.78)) * 24);

	function isInteractive(opacity: number) {
		return opacity >= 0.12;
	}

	/** Horizontal offset outward from center; vertical center aligned with the ball. */
	function uspLabelCanvasPosition(ball: FloatingMetaball) {
		const cx = metaballWidth / 2;
		const dx = ball.x - cx;
		const dy = ball.y - metaballHeight / 2;
		const len = Math.hypot(dx, dy) || 1;
		const gap = ball.r * 1.35;
		return {
			x: ball.x + (dx / len) * gap,
			y: ball.y
		};
	}
</script>

<section bind:this={containerEl} class="relative mb-24 h-[550vh] md:mb-32">
	<div class="sticky top-0 z-10 flex h-dvh items-center overflow-hidden">
		<div
			bind:this={metaballStageEl}
			class="pointer-events-none absolute inset-0 z-0 overflow-hidden"
			style="opacity: {metaballFrameOpacity}"
			aria-hidden={metaballFrameOpacity < 0.12}
		>
			<div class="metaball-stage marketing-metaball-fly-in absolute inset-0 size-full">
				<canvas
					bind:this={metaballCanvasEl}
					class="metaball-canvas absolute inset-0 z-10 block h-full w-full touch-none select-none"
				></canvas>
				{#if uspLabelPositions.length === heroUsps.length && metaballWidth > 1}
					<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
						{#each heroUsps as label, i (label)}
							{@const pos = uspLabelPositions[i]}
							<span
								class="absolute max-w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/25 bg-white/88 px-2 py-0.5 text-center text-[10px] leading-tight font-medium tracking-tight text-black/85 shadow-sm backdrop-blur-sm sm:max-w-none sm:px-2.5 sm:text-[11px]"
								style="left: {(pos.x / metaballWidth) * 100}%; top: {(pos.y / metaballHeight) * 100}%"
							>
								{label}
							</span>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<div class="absolute inset-0 z-1 bg-[radial-gradient(circle_at_50%_45%,rgba(29,158,117,0.12),transparent_55%)]"></div>
		<div class="relative z-10 mx-auto flex h-full w-full max-w-6xl items-center justify-center px-4">
			<div
				class="pointer-events-none absolute inset-0"
				style="opacity: {headlineOpacity}"
				aria-hidden={headlineOpacity < 0.12}
			>
				<div class="absolute inset-0 flex items-center justify-center px-4">
					<h1
						class="marketing-pop-in relative z-10 select-text text-center text-5xl leading-[0.92] font-semibold tracking-tight sm:text-7xl md:text-8xl {isInteractive(
							headlineOpacity
						)
							? 'pointer-events-auto'
							: 'pointer-events-none'}"
					>
						Your memories.
						<span class="block text-[#0F6E56]">Not theirs.</span>
					</h1>
				</div>
			</div>

			<div
				class="pointer-events-none absolute inset-0 grid place-items-center px-4"
				style="opacity: {captureOpacity}"
			>
				<div
					class="select-text w-full max-w-2xl rounded-lg border-2 border-black bg-card p-4 shadow-[6px_6px_0px_0px_#000] dark:border-border dark:shadow-none md:p-6 {isInteractive(
						captureOpacity
					)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<p class="text-muted-foreground mb-2 text-xs uppercase tracking-widest">Capture</p>
					<div class="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
						Idea after customer call: tie Q3 roadmap to migration blockers and owner follow-up...
					</div>
				</div>
			</div>

			<div
				class="pointer-events-none absolute inset-0 grid place-items-center px-4"
				style="opacity: {processOpacity}"
			>
				<div
					class="select-text w-full max-w-3xl rounded-lg border border-border bg-card p-5 md:p-7 {isInteractive(
						processOpacity
					)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<p class="text-muted-foreground mb-1 text-xs uppercase tracking-widest">How it works</p>
					<p class="text-muted-foreground mb-4 text-xs uppercase tracking-widest">Capture process</p>
					<div class="grid gap-3 md:grid-cols-3">
						<div class="rounded-md border border-border bg-background p-3 text-sm">Persist thought</div>
						<div class="rounded-md border border-border bg-background p-3 text-sm">Extract entities</div>
						<div class="rounded-md border border-border bg-background p-3 text-sm">Link in graph</div>
					</div>
				</div>
			</div>

			<div
				class="pointer-events-none absolute inset-0 grid place-items-center px-4"
				style="opacity: {graphOpacity}"
			>
				<div
					class="relative h-[74vh] w-full max-w-5xl rounded-xl border border-border bg-card/95 select-text {isInteractive(
						graphOpacity
					)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
					style="transform: scale({graphScale})"
				>
					<p class="absolute top-3 left-4 text-xs uppercase tracking-widest text-muted-foreground">
						Graph insertion (dummy data)
					</p>
					{#each [0, 1, 2, 3, 4, 5] as node}
						<div
							class="absolute size-3 rounded-full bg-[#0F6E56]"
							style="left: {50 + Math.cos(node * 1.05) * graphSpread}%; top: {52 + Math.sin(node * 0.95) * (graphSpread * 0.7)}%"
						></div>
					{/each}
					<div class="absolute left-[48%] top-[50%] size-4 rounded-full bg-black dark:bg-white"></div>
				</div>
			</div>

			<div
				class="pointer-events-none absolute inset-0 grid place-items-center px-4"
				style="opacity: {retrievalOpacity}"
			>
				<div
					class="select-text w-full max-w-3xl rounded-lg border-2 border-black bg-card p-5 shadow-[6px_6px_0px_0px_#000] dark:border-border dark:shadow-none md:p-7 {isInteractive(
						retrievalOpacity
					)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<p class="text-muted-foreground mb-3 text-xs uppercase tracking-widest">
						Retrieval chat - needle in haystack
					</p>
					<div class="space-y-2 text-sm">
						<p class="rounded-md border border-border bg-background p-3">
							When did we promise to revisit the migration blockers?
						</p>
						<p class="rounded-md border border-[#0F6E56] bg-[#e9f4f0] p-3 text-foreground dark:bg-[#143128]">
							Found it: customer sync on Mar 18, owner assigned, follow-up scheduled for Apr 02.
						</p>
						<p class="text-muted-foreground" style="transform: translateX({hitShift}px)">
							Signal extracted from 128 related memories.
						</p>
					</div>
				</div>
			</div>

			<div
				class="pointer-events-none absolute right-4 bottom-6 left-4 md:right-10 md:bottom-10 md:left-10"
				style="opacity: {timeOpacity}"
			>
				<div
					class="select-text rounded-md border border-border bg-card/90 p-3 backdrop-blur-sm md:p-4 {isInteractive(
						timeOpacity
					)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<p class="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Temporal memory</p>
					<div class="grid grid-cols-3 gap-2 text-xs md:text-sm">
						<div class="rounded border border-border bg-background px-2 py-1.5">Mar 18: captured</div>
						<div class="rounded border border-border bg-background px-2 py-1.5">Apr 02: follow-up</div>
						<div class="rounded border border-border bg-background px-2 py-1.5">Now: retrieved</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.metaball-stage {
		transform-origin: center center;
	}

	.metaball-canvas {
		max-width: none;
		max-height: none;
	}

	.marketing-metaball-fly-in {
		animation: marketing-metaball-fly-in 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes marketing-metaball-fly-in {
		from {
			transform: scale(1.5);
		}
		to {
			transform: scale(1);
		}
	}

	.marketing-pop-in {
		animation: marketing-pop-in 520ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
		transform-origin: center;
	}

	@keyframes marketing-pop-in {
		0% {
			transform: scale(0.9);
		}
		70% {
			transform: scale(1.03);
		}
		100% {
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.marketing-metaball-fly-in {
			animation: none;
			transform: scale(1);
		}

		.marketing-pop-in {
			animation: none;
			opacity: 1;
			transform: none;
		}

	}
</style>
