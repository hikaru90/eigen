<script lang="ts">
	import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
	import { CAPTURE_INGEST_PHASE_COPY } from '$lib/capture/ingest-phases';
	import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/check';

	interface TimestampedEvent {
		event: ProgressEvent;
		arrivedAt: number;
	}

	interface Props {
		/** All progress events received so far, in arrival order, with timestamps. */
		events: TimestampedEvent[];
		/** The canonical pipeline shape: sequential phases or parallel groups. */
		pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>;
		/** Timestamp when the overall capture started. */
		startMs: number;
	}

	let { events, pipeline, startMs }: Props = $props();

	// Last event is "active"; everything before it is "completed".
	const activeItem  = $derived(events.at(-1) ?? null);
	const doneItems   = $derived(events.slice(0, -1));
	const totalSteps  = $derived(pipeline.length);

	// Which pipeline slot does the active event belong to?
	const activeStepIndex = $derived.by(() => {
		if (!activeItem) return -1;
		const ev = activeItem.event;
		for (let i = 0; i < pipeline.length; i++) {
			const slot = pipeline[i];
			if (ev.parallel) {
				if (Array.isArray(slot) && ev.phases.some((p) => slot.includes(p))) return i;
			} else {
				if (!Array.isArray(slot) && slot === ev.phase) return i;
				if (Array.isArray(slot) && slot.includes(ev.phase)) return i;
			}
		}
		return -1;
	});

	const progress = $derived(
		activeStepIndex >= 0 ? ((activeStepIndex + 1) / totalSteps) * 100 : 0
	);

	const nextSlot = $derived(
		activeStepIndex >= 0 && activeStepIndex < pipeline.length - 1
			? pipeline[activeStepIndex + 1]
			: null
	);

	function eventLabel(ev: ProgressEvent): string {
		if (ev.parallel) return ev.phases.map((p) => CAPTURE_INGEST_PHASE_COPY[p].title).join(' · ');
		return CAPTURE_INGEST_PHASE_COPY[ev.phase].title;
	}

	function slotLabel(slot: CaptureIngestPhase | CaptureIngestPhase[]): string {
		if (Array.isArray(slot)) return slot.map((p) => CAPTURE_INGEST_PHASE_COPY[p].title).join(' · ');
		return CAPTURE_INGEST_PHASE_COPY[slot].title;
	}

	function durationLabel(item: TimestampedEvent, index: number): string {
		const next = events[index + 1];
		const endMs = next?.arrivedAt ?? item.arrivedAt;
		const ms = endMs - item.arrivedAt;
		if (ms < 50) return '';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	// Live elapsed ticker — only ticks while something is active.
	let nowMs = $state(Date.now());
	$effect(() => {
		if (!activeItem) return;
		const id = setInterval(() => { nowMs = Date.now(); }, 100);
		return () => clearInterval(id);
	});
	const totalElapsed = $derived.by(() => {
		if (!startMs) return '';
		const ms = nowMs - startMs;
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	});
</script>

<div class="space-y-3" role="status" aria-live="polite">

	<!-- Header: step counter + running clock -->
	<div class="flex items-center justify-between text-xs text-muted-foreground">
		{#if activeItem}
			<span>Step {activeStepIndex + 1} of {totalSteps}</span>
			<span class="tabular-nums">{totalElapsed}</span>
		{:else}
			<span>Starting…</span>
			<span></span>
		{/if}
	</div>

	<!-- Progress bar -->
	<div class="h-1.5 bg-muted rounded-full overflow-hidden">
		<div class="h-full bg-primary transition-all duration-500 ease-out" style="width: {progress}%"></div>
	</div>

	<!-- Completed steps -->
	{#if doneItems.length > 0}
		<div class="space-y-1">
			{#each doneItems as item, i (i)}
				{@const dur = durationLabel(item, i)}
				<div class="flex items-center gap-2 text-xs">
					<CheckIcon class="size-3 shrink-0 text-green-600" aria-hidden="true" />
					<span class="font-medium text-green-700 dark:text-green-500 flex-1 truncate">
						{eventLabel(item.event)}
					</span>
					{#if dur}
						<span class="text-muted-foreground/50 tabular-nums shrink-0">{dur}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Active step -->
	{#if activeItem}
		<div class="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
			<LoaderCircleIcon class="size-4 animate-spin text-primary shrink-0 mt-0.5" aria-hidden="true" />
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium text-foreground">{eventLabel(activeItem.event)}</p>
				{#if !activeItem.event.parallel}
					<p class="text-muted-foreground text-xs mt-0.5 leading-relaxed">
						{CAPTURE_INGEST_PHASE_COPY[activeItem.event.phase].description}
					</p>
				{:else}
					<p class="text-muted-foreground text-xs mt-0.5">Running in parallel</p>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Before first event arrives -->
		<div class="flex items-center gap-3 p-3">
			<LoaderCircleIcon class="size-4 animate-spin text-primary shrink-0" aria-hidden="true" />
			<p class="text-sm font-medium text-foreground">Starting capture…</p>
		</div>
	{/if}

	<!-- Up next -->
	{#if nextSlot}
		<p class="text-xs text-muted-foreground/50 pl-1">Up next: {slotLabel(nextSlot)}</p>
	{/if}

</div>
