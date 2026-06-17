<script lang="ts">
	import type { CaptureSubmitResult } from '$lib/capture/capture-result-types';
	import {
		categoryConfidencePercent,
		formatNearDuplicate,
		parseCategoryAlternatives
	} from '$lib/capture/capture-result-display';
	import CaptureEntityConnections from '$lib/components/capture-entity-connections.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	let {
		thought,
		title = 'Stored thought',
		showEdit = false,
		embedded = false,
		onToggleEdit,
		onDelete,
		deleteBusy = false
	}: {
		thought: CaptureSubmitResult;
		title?: string;
		showEdit?: boolean;
		/** Render only the detail body (no outer card/header). */
		embedded?: boolean;
		onToggleEdit?: () => void;
		onDelete?: () => void;
		deleteBusy?: boolean;
	} = $props();

	let cuesExpanded = $state(false);

	const confidence = $derived(categoryConfidencePercent(thought.metadata));
	const alternatives = $derived(parseCategoryAlternatives(thought.metadata));
	const nearDuplicate = $derived(formatNearDuplicate(thought.metadata));
</script>

{#snippet summaryBody()}
	<Card.Content class="p-0 space-y-3 text-sm">
		<p class="text-card-foreground whitespace-pre-wrap">{thought.normalizedText}</p>

		<div class="space-y-2">
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
				<span>
					Category:
					<span class="font-medium text-foreground">{thought.category}</span>
					{#if confidence}
						<span class="ml-1">({confidence})</span>
					{/if}
				</span>
				{#if thought.memoryType}
					<span>
						Memory type:
						<span class="font-medium text-foreground">{thought.memoryType}</span>
					</span>
				{/if}
				{#if nearDuplicate}
					<span>
						Near-duplicate:
						<span class="font-medium text-foreground">{nearDuplicate}</span>
					</span>
				{/if}
			</div>

			{#if alternatives.length > 0}
				<div class="flex flex-wrap items-center gap-1.5 text-xs">
					<span class="text-muted-foreground">Also considered:</span>
					{#each alternatives as alt (alt.key)}
						<span class="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground">
							{alt.key}
							<span class="opacity-70">({Math.round(alt.confidence * 100)}%)</span>
						</span>
					{/each}
				</div>
			{/if}
		</div>

		<CaptureEntityConnections
			entities={thought.entities}
			linkedThoughts={thought.linkedThoughts}
		/>

		{#if thought.gtdProjectLabel}
			<p class="text-xs text-muted-foreground">
				{#if thought.gtdIsNextAction}
					Next action for project:
					<span class="font-medium text-foreground">{thought.gtdProjectLabel}</span>
				{:else}
					Linked to project:
					<span class="font-medium text-foreground">{thought.gtdProjectLabel}</span>
				{/if}
			</p>
		{/if}

		{#if thought.temporalEvents.length > 0}
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-foreground">Temporal</p>
				<ul class="space-y-1 text-xs text-muted-foreground">
					{#each thought.temporalEvents as event (event.id)}
						<li>
							<span class="font-medium text-foreground">{event.kind}</span>
							— {event.semanticSummary}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if thought.cues.length > 0}
			<div class="space-y-1">
				<button
					type="button"
					class="text-xs font-medium text-foreground hover:underline"
					onclick={() => {
						cuesExpanded = !cuesExpanded;
					}}
				>
					Search cues ({thought.cues.length})
					<span class="text-muted-foreground font-normal">{cuesExpanded ? '▾' : '▸'}</span>
				</button>
				{#if cuesExpanded}
					<ul class="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
						{#each thought.cues as cue (cue)}
							<li class="rounded-sm border border-border px-1.5 py-0.5">{cue}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if thought.queueStatus === 'pending' || thought.queueStatus === 'processing'}
			<p class="text-xs text-blue-700 dark:text-blue-400">
				Queue: {thought.queueStatus === 'pending' ? 'waiting for indexing' : 'indexing now'}
			</p>
		{:else if thought.queueStatus === 'failed'}
			<p class="text-xs text-destructive">
				Indexing failed{thought.queueError ? `: ${thought.queueError}` : ''}
			</p>
		{:else if !thought.enrichmentComplete}
			<p class="text-xs text-amber-700 dark:text-amber-400">
				Saved — indexing entities and links in the background. Keyword search on the text works now;
				semantic search after indexing completes.
			</p>
		{/if}

		<p class="text-muted-foreground text-xs font-mono">{thought.id}</p>
	</Card.Content>
{/snippet}

{#if embedded}
	{@render summaryBody()}
{:else}
	<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-4 gap-3 items-start overflow-visible">
		<Card.Header class="p-0 w-full flex flex-row items-start justify-between gap-2">
			<Card.Title class="text-sm">{title}</Card.Title>
			{#if onToggleEdit || onDelete}
				<div class="flex items-center gap-1 shrink-0 -mt-0.5">
					{#if onToggleEdit}
						<Button
							type="button"
							variant="ghost"
							class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded-none"
							onclick={onToggleEdit}
						>
							{showEdit ? 'Cancel edit' : 'Edit'}
						</Button>
					{/if}
					{#if onDelete}
						<Button
							type="button"
							variant="ghost"
							class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive rounded-none"
							disabled={deleteBusy}
							onclick={onDelete}
						>
							{deleteBusy ? 'Deleting…' : 'Delete'}
						</Button>
					{/if}
				</div>
			{/if}
		</Card.Header>
		{@render summaryBody()}
	</Card.Root>
{/if}
