<script lang="ts">
	import IngestPhaseIndicator from '$lib/components/ingest-phase-indicator.svelte';
	import { CAPTURE_PIPELINE } from '$lib/capture/ingest-phases';
	import { DEMO_CAPTURE_TEXT, demoIngestEventsForProgress } from './marketing-story-demo-data';

	type Props = {
		/** Scroll segment 0–1 within the ingest beat. */
		progress?: number;
		captureText?: string;
	};

	let { progress = 0.5, captureText = DEMO_CAPTURE_TEXT }: Props = $props();

	let ingestStartMs = $state(0);
	let ingestStarted = $state(false);

	$effect(() => {
		if (progress > 0 && !ingestStarted) {
			ingestStarted = true;
			ingestStartMs = Date.now();
		}
	});

	const events = $derived(
		ingestStarted ? demoIngestEventsForProgress(progress, ingestStartMs) : []
	);
</script>

<div class="mx-auto w-full max-w-xl">
	<div
		class="border-2 border-black bg-white px-4 py-3 shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none"
	>
		<div class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<p class="line-clamp-2 text-sm leading-snug text-foreground">{captureText}</p>
				<p class="mt-0.5 text-xs text-muted-foreground">Processing</p>
			</div>
		</div>
		<div class="mt-3 border-t-2 border-black/10 pt-3 dark:border-border">
			<IngestPhaseIndicator {events} pipeline={CAPTURE_PIPELINE} startMs={ingestStartMs} />
		</div>
	</div>
</div>
