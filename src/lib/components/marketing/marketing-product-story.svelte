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
	import MarketingStoryCapturePreview from './marketing-story-capture-preview.svelte';
	import MarketingStoryIngestPreview from './marketing-story-ingest-preview.svelte';
	import MarketingStoryStoredPreview from './marketing-story-stored-preview.svelte';
	import MarketingStoryGraphPreview from './marketing-story-graph-preview.svelte';
	import MarketingStoryChatPreview from './marketing-story-chat-preview.svelte';
	import MarketingStoryTemporalPreview from './marketing-story-temporal-preview.svelte';
	import { DEMO_CAPTURE_TEXT } from './marketing-story-demo-data';
	import { scrollSectionToProgress } from './scroll-to-element';

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
		'Audiographic memory',
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
	/** Cap backing-store scale (lower = softer + cheaper; full retina is rarely worth it here). */
	const METABALL_DPR_CAP = 1.25;
	/** Target animation rate; fragment shader cost scales linearly with fps. */
	const METABALL_TARGET_FPS = 30;

	/** Scroll runway below one pinned viewport — extra length for six sequential beats. */
	const STORY_RUNWAY_VH = 520;

	let storySectionEl: HTMLElement | null = null;
	let metaballStageEl: HTMLDivElement | null = null;
	let metaballCanvasEl: HTMLCanvasElement | null = null;
	let progress = $state(0);
	let metaballWidth = $state(1);
	let metaballHeight = $state(1);
	let metaballRenderer: MetaballRenderer | null = null;
	let metaballs: FloatingMetaball[] = [];
	let shaderMetaballLinks: BallLinkSegment[] = [];
	let uspLabelPositions = $state<{ x: number; y: number }[]>([]);
	let metaballRaf = 0;
	let scrollRaf = 0;
	let lastFrameTs = 0;
	let lastAnimFrameTs = 0;
	let reduceMotion = false;
	let captureText = $state(DEMO_CAPTURE_TEXT);
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

	function ease(t: number) {
		const x = clamp(t);
		return x * x * (3 - 2 * x);
	}

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
		if (!browser || !storySectionEl) return;
		const rect = storySectionEl.getBoundingClientRect();
		const travel = rect.height - window.innerHeight;
		if (travel <= 0) {
			progress = 0;
			return;
		}
		progress = clamp(-rect.top / travel);
	}

	function scheduleProgressUpdate() {
		if (scrollRaf !== 0) return;
		scrollRaf = window.requestAnimationFrame(() => {
			scrollRaf = 0;
			updateProgress();
		});
	}

	function scrollToProcessBeat() {
		if (!browser || !storySectionEl) return;
		scrollSectionToProgress(storySectionEl, 0.28);
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
		} catch {
			metaballRenderer = null;
		}
	}

	function syncMetaballCanvasSize(rect: DOMRectReadOnly) {
		if (!browser) return;
		const dpr = Math.min(window.devicePixelRatio || 1, METABALL_DPR_CAP);
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
		metaballRaf = window.requestAnimationFrame(tickMetaballs);

		const visible =
			metaballFrameOpacity > 0.02 && !reduceMotion && document.visibilityState === 'visible';
		if (!visible) {
			lastFrameTs = 0;
			lastAnimFrameTs = 0;
			return;
		}

		const frameInterval = 1000 / METABALL_TARGET_FPS;
		if (lastAnimFrameTs !== 0 && timestamp - lastAnimFrameTs < frameInterval) return;
		lastAnimFrameTs = timestamp;

		const dt = lastFrameTs === 0 ? 0 : Math.min((timestamp - lastFrameTs) / 1000, 0.05);
		lastFrameTs = timestamp;
		if (dt <= 0) return;

		const t = timestamp / 1000;
		for (const ball of metaballs) {
			ball.x = ball.ox + Math.cos(t * 0.28 + ball.phase) * ball.drift;
			ball.y = ball.oy + Math.sin(t * 0.34 + ball.phase) * ball.drift;
		}
		recomputeLinksAndRender();
	}

	onMount(() => {
		if (!browser) return;
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		updateProgress();
		const onScroll = () => scheduleProgressUpdate();
		const onResize = () => {
			scheduleProgressUpdate();
			if (metaballStageEl) syncMetaballCanvasSize(metaballStageEl.getBoundingClientRect());
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onResize, { passive: true });
		metaballRaf = window.requestAnimationFrame(tickMetaballs);
		return () => {
			window.cancelAnimationFrame(metaballRaf);
			if (scrollRaf !== 0) window.cancelAnimationFrame(scrollRaf);
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

	const metaballFrameOpacity = $derived(fadeOutOpacity(0.22, 0.34));
	/** Hero reacts on first scroll (no 10% dead zone). */
	const headlineExitT = $derived(ease(segment(0, 0.14)));
	const headlineOnScreen = $derived(headlineExitT < 1);
	const captureOpacity = $derived(stageOpacity(0.12, 0.16, 0.2, 0.24));
	const processOpacity = $derived(stageOpacity(0.26, 0.3, 0.36, 0.4));
	const storedOpacity = $derived(stageOpacity(0.42, 0.46, 0.5, 0.54));
	const graphBeatIn = $derived(stageOpacity(0.56, 0.58, 0.66, 0.68));
	const graphScatterT = $derived(ease(segment(0.6, 0.66)));
	const graphExitFadeT = $derived(ease(segment(0.66, 0.68)));
	const graphOpacity = $derived(graphBeatIn * (graphScatterT >= 1 ? 1 - graphExitFadeT : 1));
	const graphScale = $derived(0.86 + ease(segment(0.56, 0.62)) * 0.14);
	const graphMounted = $derived(
		progress >= 0.555 && !(progress >= 0.685 && graphScatterT >= 1 && graphExitFadeT >= 1)
	);
	const timeOpacity = $derived(stageOpacity(0.7, 0.74, 0.78, 0.82));
	const retrievalOpacity = $derived(stageOpacity(0.84, 0.88, 0.96, 0.99));
	const processStep = $derived(segment(0.26, 0.4));
	const retrievalBeatProgress = $derived(segment(0.84, 0.98));

	function isInteractive(opacity: number) {
		return opacity >= 0.12;
	}

	function uspLabelCanvasPosition(ball: FloatingMetaball) {
		const cx = metaballWidth / 2;
		const dx = ball.x - cx;
		const len = Math.hypot(dx, ball.y - metaballHeight / 2) || 1;
		const gap = ball.r * 1.35;
		return {
			x: ball.x + (dx / len) * gap,
			y: ball.y
		};
	}
</script>

<section
	bind:this={storySectionEl}
	class="marketing-product-story relative mb-24 md:mb-32"
	style="--story-runway-vh: {STORY_RUNWAY_VH}"
>
	<div class="story-sticky-stage sticky top-0 z-10 h-dvh overflow-hidden contain-paint">
		<div class="story-decoration pointer-events-none absolute inset-0 z-0">
			<div
				bind:this={metaballStageEl}
				class="absolute inset-0 overflow-hidden"
				style="opacity: {metaballFrameOpacity}"
				aria-hidden={metaballFrameOpacity < 0.12}
			>
				<div class="metaball-stage marketing-metaball-fly-in absolute inset-0 size-full">
					<canvas
						bind:this={metaballCanvasEl}
						class="metaball-canvas absolute inset-0 z-10 block h-full w-full touch-none select-none"
					></canvas>
				</div>
				{#if uspLabelPositions.length === heroUsps.length && metaballWidth > 1}
					<div
						class="marketing-metaball-labels pointer-events-none absolute inset-0 z-20 overflow-hidden"
						aria-hidden="true"
					>
						{#each heroUsps as label, i (label)}
							{@const pos = uspLabelPositions[i]}
							<span
								class="marketing-metaball-label absolute max-w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#444444] px-2 py-0.5 text-center text-[10px] leading-tight font-medium tracking-tight text-[#28F97F] shadow-sm sm:max-w-none sm:px-2.5 sm:text-[11px]"
								style="left: {(pos.x / metaballWidth) * 100}%; top: {(pos.y / metaballHeight) * 100}%"
							>
								{label}
							</span>
						{/each}
					</div>
				{/if}
			</div>
			<div
				class="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(29,158,117,0.12),transparent_55%)]"
				style="opacity: {metaballFrameOpacity}"
				aria-hidden="true"
			></div>
		</div>

		<div
			class="story-headline pointer-events-none absolute inset-0 z-5 flex items-center justify-center px-4"
			aria-hidden={!headlineOnScreen && metaballFrameOpacity < 0.12}
		>
			<div
				class="relative z-10 {headlineOnScreen
					? 'pointer-events-auto'
					: 'pointer-events-none'}"
			>
				<h1
					class="marketing-headline-exit select-text text-center text-5xl leading-[0.92] font-semibold tracking-tight text-foreground sm:text-7xl md:text-8xl"
					style="--exit-t: {headlineExitT}"
				>
					<span class="marketing-headline-line">Your&nbsp;memories.</span>
					<span class="marketing-headline-line">Not&nbsp;theirs.</span>
				</h1>
			</div>
		</div>

		<div class="story-beats pointer-events-none absolute inset-0 z-10 mx-auto h-dvh w-full max-w-6xl px-4">
			<div
				class="absolute inset-0 z-10 grid place-items-center px-4"
				style="opacity: {captureOpacity}"
			>
				<div
					class="select-text w-full {isInteractive(captureOpacity)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<MarketingStoryCapturePreview bind:text={captureText} onCapture={scrollToProcessBeat} />
				</div>
			</div>

			<div
				class="absolute inset-0 z-20 grid place-items-center px-4"
				style="opacity: {processOpacity}"
			>
				<div
					class="select-text w-full {isInteractive(processOpacity)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<MarketingStoryIngestPreview progress={processStep} captureText={captureText} />
				</div>
			</div>

			<div
				class="absolute inset-0 z-30 grid place-items-center px-4"
				style="opacity: {storedOpacity}"
			>
				<div
					class="select-text w-full {isInteractive(storedOpacity)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<MarketingStoryStoredPreview />
				</div>
			</div>

			<div
				class="absolute inset-0 z-40 grid place-items-center px-4"
				style="opacity: {graphOpacity}; display: {graphMounted ? 'grid' : 'none'}"
				aria-hidden={!graphMounted || graphOpacity < 0.12}
			>
				{#if graphMounted}
					<div
						class="pointer-events-none relative w-full select-text"
						style="transform: scale({graphScale})"
					>
						<MarketingStoryGraphPreview exitProgress={graphScatterT} />
					</div>
				{/if}
			</div>

			<div
				class="absolute inset-0 z-50 grid place-items-center px-4"
				style="opacity: {timeOpacity}"
			>
				<div class="pointer-events-none w-full select-text">
					<MarketingStoryTemporalPreview />
				</div>
			</div>

			<div
				class="absolute inset-0 z-[60] grid place-items-center px-4"
				style="opacity: {retrievalOpacity}"
			>
				<div
					class="select-text w-full {isInteractive(retrievalOpacity)
						? 'pointer-events-auto'
						: 'pointer-events-none'}"
				>
					<MarketingStoryChatPreview beatProgress={retrievalBeatProgress} />
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.marketing-product-story {
		min-height: calc(100dvh + var(--story-runway-vh, 450) * 1vh);
	}

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

	.story-headline {
		isolation: isolate;
	}

	.marketing-headline-exit {
		--exit-t: 0;
		width: max-content;
		max-width: min(100%, 22em);
		margin-inline: auto;
		transform: translateY(calc(var(--exit-t) * -95vh));
		transform-origin: center center;
		will-change: transform;
	}

	.marketing-headline-line {
		display: block;
		white-space: nowrap;
		text-wrap: nowrap;
	}

	.marketing-metaball-label {
		mix-blend-mode: difference;
	}

	@media (prefers-reduced-motion: reduce) {
		.marketing-product-story {
			min-height: auto;
		}

		.marketing-metaball-fly-in {
			animation: none;
			transform: scale(1);
		}

		.marketing-headline-exit {
			--exit-t: 0;
			transform: none;
		}

		.marketing-metaball-label {
			mix-blend-mode: normal;
		}
	}
</style>
