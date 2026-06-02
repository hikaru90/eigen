<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import TemporalEventsListView from '../../../routes/graph/TemporalEventsListView.svelte';
	import { DEMO_TEMPORAL_EVENTS } from './marketing-story-demo-data';
</script>

<div class="mx-auto w-full max-w-2xl">
	<Card.Root class="overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none">
		<Card.Header class="border-b border-border px-4 py-3">
			<Card.Title class="text-sm font-medium">Temporal events</Card.Title>
			<p class="text-muted-foreground text-xs">
				Dates and deadlines extracted from your captures — synced to the graph.
			</p>
		</Card.Header>
		<Card.Content class="p-0">
			<div class="max-h-[min(52vh,440px)] min-h-48 overflow-hidden">
				<TemporalEventsListView
					items={DEMO_TEMPORAL_EVENTS}
					selectedItemId="te-2"
					onSelect={() => {}}
				/>
			</div>
		</Card.Content>
	</Card.Root>
</div>
