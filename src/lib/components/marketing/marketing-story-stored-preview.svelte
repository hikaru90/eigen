<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { DEMO_STORED_THOUGHT } from './marketing-story-demo-data';
</script>

<div class="mx-auto w-full max-w-xl">
	<Card.Root
		class="items-start gap-3 overflow-visible border-2 border-black bg-white p-4 shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none"
	>
		<Card.Header class="w-full flex-row items-start justify-between gap-2 p-0">
			<Card.Title class="flex items-center gap-2 text-sm">
				<CheckIcon class="size-4 shrink-0 text-green-600" aria-hidden="true" />
				Stored thought
			</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-2 p-0 text-sm">
			<p class="whitespace-pre-wrap text-card-foreground">{DEMO_STORED_THOUGHT.normalizedText}</p>
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
				<span
					>Category: <span class="font-medium text-foreground">{DEMO_STORED_THOUGHT.category}</span
					></span
				>
				<span
					>Confidence: <span class="font-medium text-foreground"
						>{Math.round(DEMO_STORED_THOUGHT.categoryConfidence * 100)}%</span
					></span
				>
			</div>
			<p class="font-mono text-xs text-muted-foreground">{DEMO_STORED_THOUGHT.id}</p>
		</Card.Content>
	</Card.Root>
</div>
