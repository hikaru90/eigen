<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import XIcon from '@lucide/svelte/icons/x';
	import type { CaptureQueueItem } from '$lib/capture/queue';
	import {
		captureQueueItemPreview,
		captureQueueStatusLabel
	} from '$lib/capture/queue/snapshot';
	import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
	import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';
	import IngestPhaseIndicator from '$lib/components/ingest-phase-indicator.svelte';

	interface TimestampedEvent {
		event: ProgressEvent;
		arrivedAt: number;
	}

	interface Props {
		items: CaptureQueueItem[];
		processingId: string | null;
		events: TimestampedEvent[];
		pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>;
		startMs: number;
		oncancel: (id: string) => void;
	}

	let { items, processingId, events, pipeline, startMs, oncancel }: Props = $props();

	const visibleItems = $derived(
		items.filter((i) => i.status === 'pending' || i.status === 'processing' || i.status === 'failed')
	);

	const cardClass =
		'bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none px-4 py-3';
</script>

{#if visibleItems.length > 0}
	<div class="space-y-3" aria-label="Capture queue">
		{#each visibleItems as item (item.id)}
			<div class={cardClass}>
				<div class="flex items-start gap-2">
					<div class="min-w-0 flex-1">
						<p class="text-sm text-foreground line-clamp-2 leading-snug">
							{captureQueueItemPreview(item.raw)}
						</p>
						<p class="text-xs text-muted-foreground mt-0.5">
							{captureQueueStatusLabel(item.status)}
							{#if item.status === 'failed' && item.lastError}
								<span class="text-destructive"> — {item.lastError}</span>
							{/if}
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="shrink-0 size-8 rounded-none text-destructive hover:text-destructive hover:bg-destructive/10"
						aria-label="Remove from queue"
						onclick={() => oncancel(item.id)}
					>
						<XIcon class="size-4" aria-hidden="true" />
					</Button>
				</div>
				{#if item.id === processingId}
					<div class="mt-3 pt-3 border-t-2 border-black/10 dark:border-border">
						<IngestPhaseIndicator {events} {pipeline} startMs={startMs} />
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
