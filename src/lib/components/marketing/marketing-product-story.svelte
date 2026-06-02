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
	const METABALL_DPR_CAP = 1;
	/** Internal render scale vs layout size — CSS upscales the canvas. */
	const METABALL_RENDER_SCALE = 0.72;
	/** Tighter shader loops than logo editor (13 balls, ~26 links). */
	const METABALL_SHADER_MAX_BALLS = 16;
	const METABALL_SHADER_MAX_LINKS = 36;
	/** USP label DOM updates — every N rendered frames. */
	const METABALL_LABEL_UPDATE_EVERY = 2;
	/** Hero metaball exit — wider scroll bands so scatter/fade read at normal scroll speed. */
	const METABALL_SCATTER_START = 0.06;
	const METABALL_SCATTER_END = 0.32;
	const METABALL_FADE_START = 0.32;
	const METABALL_FADE_END = 0.4;
	const METABALL_UNMOUNT_AT = 0.41;

	/** Scroll runway below one pinned viewport — extra length for six sequential beats. */
	const STORY_RUNWAY_VH = 520;

	let storySectionEl: HTMLElement | null = null;
	let metaballStageEl = $state<HTMLDivElement | null>(null);
	let metaballCanvasEl = $state<HTMLCanvasElement | null>(null);
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
	let labelUpdateCounter = 0;
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

	function metaballScatterTAt(p: number) {
		return ease(clamp((p - METABALL_SCATTER_START) / (METABALL_SCATTER_END - METABALL_SCATTER_START)));
	}

	function metaballExitFadeTAt(p: number) {
		return ease(clamp((p - METABALL_FADE_START) / (METABALL_FADE_END - METABALL_FADE_START)));
	}

	function metaballVisualOpacityAt(p: number) {
		const scatterT = metaballScatterTAt(p);
		return scatterT >= 1 ? 1 - metaballExitFadeTAt(p) : 1;
	}

	function metaballMountedAt(p: number) {
		if (p <= 0) return true;
		const scatterT = metaballScatterTAt(p);
		const fadeT = metaballExitFadeTAt(p);
		return p < METABALL_UNMOUNT_AT || scatterT < 1 || fadeT < 1;
	}

	function metaballScatterOffset(ball: FloatingMetaball, scatterT: number) {
		if (scatterT <= 0) return { dx: 0, dy: 0 };
		const cx = metaballWidth / 2;
		const cy = metaballHeight / 2;
		const maxPush = Math.max(metaballWidth, metaballHeight) * 0.55;
		let dx = ball.ox - cx;
		let dy = ball.oy - cy;
		let len = Math.hypot(dx, dy);
		if (len < 20) {
			dx = Math.cos(ball.phase);
			dy = Math.sin(ball.phase);
			len = 1;
		}
		const push = scatterT * maxPush;
		return { dx: (dx / len) * push, dy: (dy / len) * push };
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
			metaballRenderer = createMetaballRenderer(metaballCanvasEl, metaballWidth, metaballHeight, {
				maxBalls: METABALL_SHADER_MAX_BALLS,
				maxLinks: METABALL_SHADER_MAX_LINKS,
				precision: 'mediump'
			});
		} catch {
			metaballRenderer = null;
		}
	}

	function syncMetaballCanvasSize(rect: DOMRectReadOnly) {
		if (!browser) return;
		const dpr = Math.min(window.devicePixelRatio || 1, METABALL_DPR_CAP);
		const w = Math.max(1, Math.floor(rect.width * dpr * METABALL_RENDER_SCALE));
		const h = Math.max(1, Math.floor(rect.height * dpr * METABALL_RENDER_SCALE));
		if (w === metaballWidth && h === metaballHeight) {
			ensureMetaballRendererAndFrame();
			return;
		}

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
		if (metaballs.length > 0) recomputeLinksAndRender(true);
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

	function applyMetaballPositionsForProgress(p: number, timeSec: number) {
		const scatterT = metaballScatterTAt(p);
		const driftBlend = 1 - scatterT;
		for (const ball of metaballs) {
			const baseX = ball.ox + Math.cos(timeSec * 0.28 + ball.phase) * ball.drift * driftBlend;
			const baseY = ball.oy + Math.sin(timeSec * 0.34 + ball.phase) * ball.drift * driftBlend;
			const { dx, dy } = metaballScatterOffset(ball, scatterT);
			ball.x = baseX + dx;
			ball.y = baseY + dy;
		}
	}

	function ensureMetaballRendererAndFrame() {
		if (!metaballCanvasEl || metaballWidth < 1 || metaballHeight < 1 || metaballs.length === 0) return;
		if (!metaballRenderer) initMetaballRenderer();
		applyMetaballPositionsForProgress(progress, performance.now() / 1000);
		recomputeLinksAndRender(true);
	}

	function recomputeLinksAndRender(updateLabels = true) {
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
		shaderMetaballLinks = linksForShader(links, METABALL_SHADER_MAX_LINKS);
		if (updateLabels && metaballs.length === heroUsps.length) {
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

	function metaballLoopActive() {
		return (
			metaballMountedAt(progress) &&
			metaballVisualOpacityAt(progress) > 0.02 &&
			!reduceMotion &&
			document.visibilityState === 'visible'
		);
	}

	function startMetaballLoop() {
		if (!browser || metaballRaf !== 0 || !metaballLoopActive()) return;
		lastFrameTs = 0;
		metaballRaf = window.requestAnimationFrame(tickMetaballs);
	}

	function stopMetaballLoop() {
		if (metaballRaf === 0) return;
		window.cancelAnimationFrame(metaballRaf);
		metaballRaf = 0;
		lastFrameTs = 0;
	}

	function tickMetaballs(timestamp: number) {
		if (!metaballLoopActive()) {
			stopMetaballLoop();
			return;
		}

		const dt = lastFrameTs === 0 ? 0 : Math.min((timestamp - lastFrameTs) / 1000, 0.05);
		lastFrameTs = timestamp;
		if (dt <= 0) {
			metaballRaf = window.requestAnimationFrame(tickMetaballs);
			return;
		}

		const t = timestamp / 1000;
		applyMetaballPositionsForProgress(progress, t);
		labelUpdateCounter = (labelUpdateCounter + 1) % METABALL_LABEL_UPDATE_EVERY;
		recomputeLinksAndRender(labelUpdateCounter === 0);
		metaballRaf = window.requestAnimationFrame(tickMetaballs);
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'visible') startMetaballLoop();
		else stopMetaballLoop();
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
		document.addEventListener('visibilitychange', onVisibilityChange);
		startMetaballLoop();
		return () => {
			stopMetaballLoop();
			if (scrollRaf !== 0) window.cancelAnimationFrame(scrollRaf);
			metaballRenderer?.dispose();
			metaballRenderer = null;
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});

	$effect(() => {
		const el = metaballStageEl;
		if (!browser || !el || !metaballMounted) return;

		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) syncMetaballCanvasSize(entry.contentRect);
		});
		ro.observe(el);
		syncMetaballCanvasSize(el.getBoundingClientRect());

		return () => ro.disconnect();
	});

	$effect(() => {
		if (!browser || metaballMounted) return;
		stopMetaballLoop();
		metaballRenderer?.dispose();
		metaballRenderer = null;
	});

	$effect(() => {
		if (!browser || !metaballMounted) return;
		void metaballStageEl;
		void metaballCanvasEl;
		void progress;
		queueMicrotask(() => {
			if (metaballStageEl) {
				syncMetaballCanvasSize(metaballStageEl.getBoundingClientRect());
			} else {
				ensureMetaballRendererAndFrame();
			}
			startMetaballLoop();
		});
	});

	$effect(() => {
		if (!browser || reduceMotion) return;
		void progress;
		void metaballMounted;
		void metaballVisualOpacity;
		if (metaballLoopActive()) startMetaballLoop();
		else stopMetaballLoop();
	});

	const metaballVisualOpacity = $derived(metaballVisualOpacityAt(progress));
	const metaballMounted = $derived(metaballMountedAt(progress));
	/** Hero reacts on first scroll (no 10% dead zone). */
	const headlineExitT = $derived(ease(segment(0, 0.14)));
	const headlineOnScreen = $derived(headlineExitT < 1);
	const captureOpacity = $derived(stageOpacity(0.12, 0.16, 0.2, 0.24));
	const processOpacity = $derived(processOpacityAt(progress));
	const storedOpacity = $derived(stageOpacity(0.42, 0.46, 0.5, 0.54));
	const graphOpacity = $derived(stageOpacity(0.56, 0.58, 0.66, 0.7));
	const retrievalOpacity = $derived(stageOpacity(0.72, 0.76, 0.94, 0.99));
	const processStep = $derived(segment(0.26, 0.4));
	const retrievalBeatProgress = $derived(segment(0.72, 0.98));

	function isInteractive(opacity: number) {
		return opacity >= 0.12;
	}

	function processOpacityAt(p: number) {
		if (p < 0.26 || p >= 0.43) return 0;
		if (p < 0.3) return ease(segment(0.26, 0.3));
		if (segment(0.26, 0.4) < 0.98) return 1;
		return 1 - ease(segment(0.398, 0.43));
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
			{#if metaballMounted}
				<div
					bind:this={metaballStageEl}
					class="absolute inset-0 overflow-hidden"
					style="opacity: {metaballVisualOpacity}"
					aria-hidden={metaballVisualOpacity < 0.12}
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
					style="opacity: {metaballVisualOpacity}"
					aria-hidden="true"
				></div>
			{/if}
		</div>

		<div
			class="story-headline pointer-events-none absolute inset-0 z-5 flex items-center justify-center px-4"
			aria-hidden={!headlineOnScreen && (!metaballMounted || metaballVisualOpacity < 0.12)}
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
					<MarketingStoryCapturePreview
						bind:text={captureText}
						storyProgress={progress}
						onCapture={scrollToProcessBeat}
					/>
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
				style="opacity: {graphOpacity}"
			>
				<div class="pointer-events-none relative w-full select-text">
					<MarketingStoryGraphPreview />
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
					<MarketingStoryChatPreview beatProgress={retrievalBeatProgress} {captureText} />
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
