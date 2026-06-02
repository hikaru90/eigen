<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import TemporalEventsListView from '../../../routes/graph/TemporalEventsListView.svelte';
	import { DEMO_CAPTURE_TEXT, DEMO_TEMPORAL_EVENTS } from './marketing-story-demo-data';

	type Props = {
		captureText?: string;
		/** 0–1 progress within the temporal scroll beat. */
		beatProgress?: number;
	};

	let { beatProgress = 0, captureText = DEMO_CAPTURE_TEXT }: Props = $props();

	const temporalItems = $derived(
		DEMO_TEMPORAL_EVENTS.map((item) => ({ ...item, thoughtText: captureText }))
	);

	const contentOpacity = $derived(Math.min(1, Math.max(0, beatProgress / 0.35)));
</script>

<div class="mx-auto w-full max-w-2xl" style="opacity: {contentOpacity}">
	<Card.Root
		class="overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none"
	>
		<Card.Header class="border-b border-border px-4 py-3">
			<Card.Title class="text-sm font-medium">Temporal events</Card.Title>
			<p class="text-xs text-muted-foreground">
				Dates and deadlines extracted from your captures — synced to the graph.
			</p>
		</Card.Header>
		<Card.Content class="p-0">
			<div class="max-h-[min(40vh,360px)] min-h-36 overflow-hidden">
				<TemporalEventsListView items={temporalItems} selectedItemId="te-2" onSelect={() => {}} />
			</div>
		</Card.Content>
	</Card.Root>
</div>
