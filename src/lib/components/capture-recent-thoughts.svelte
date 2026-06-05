<script lang="ts">
	import type { CaptureRecentThoughtSnippet, CaptureSubmitResult } from '$lib/capture/capture-result-types';
	import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';
	import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
	import CaptureQueueStatus from '$lib/components/capture-queue-status.svelte';
	import CaptureStoredSummary from '$lib/components/capture-stored-summary.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	let {
		thoughts,
		thoughtDetails,
		expandedId = null,
		editingId = null,
		editRequest = '',
		editLoading = false,
		deletingId = null,
		loadingDetailId = null,
		editProgressEvents = [],
		pipeline,
		onExpand,
		onCollapse,
		onEdit,
		onDelete,
		onEditRequestChange,
		onSubmitEdit,
		onCancelEdit
	}: {
		thoughts: CaptureRecentThoughtSnippet[];
		thoughtDetails: Record<string, CaptureSubmitResult>;
		expandedId?: string | null;
		editingId?: string | null;
		editRequest?: string;
		editLoading?: boolean;
		deletingId?: string | null;
		loadingDetailId?: string | null;
		editProgressEvents?: ProgressEvent[];
		pipeline: readonly CaptureIngestPhase[];
		onExpand: (thoughtId: string) => void;
		onCollapse: (thoughtId: string) => void;
		onEdit: (thoughtId: string) => void;
		onDelete: (thoughtId: string) => void;
		onEditRequestChange: (value: string) => void;
		onSubmitEdit: () => void;
		onCancelEdit: () => void;
	} = $props();

	function formatWhen(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const diffMs = Date.now() - date.getTime();
		const minutes = Math.floor(diffMs / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function toggleThought(snippetId: string, expanded: boolean) {
		if (expanded) {
			onCollapse(snippetId);
		} else {
			onExpand(snippetId);
		}
	}
</script>

{#if thoughts.length > 0}
	<div class="flex min-h-0 flex-1 flex-col gap-2">
		<h2 class="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent</h2>
		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
			{#each thoughts as snippet (snippet.id)}
				{@const detail = thoughtDetails[snippet.id]}
				{@const expanded = expandedId === snippet.id}
				{@const loadingDetail = loadingDetailId === snippet.id}
				<Card.Root
					class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[4px_4px_0px_0px_#000] dark:shadow-none p-4 gap-3 items-start overflow-visible"
				>
					<Card.Header class="p-0 w-full flex flex-row items-start justify-between gap-2">
						<button
							type="button"
							class="flex min-w-0 flex-1 items-start gap-2 text-left"
							aria-expanded={expanded}
							aria-label={expanded ? 'Collapse thought' : 'Expand thought'}
							onclick={() => toggleThought(snippet.id, expanded)}
						>
							{#if expanded}
								<ChevronDown class="size-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
							{:else}
								<ChevronRight class="size-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
							{/if}
							<div class="min-w-0 flex-1">
								{#if expanded}
									<Card.Title class="text-sm">Stored thought</Card.Title>
								{:else}
									<p class="text-sm text-card-foreground line-clamp-2 whitespace-pre-wrap">
										{snippet.normalizedText}
									</p>
									<div
										class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
									>
										<span class="font-medium text-foreground">{snippet.category}</span>
										{#if snippet.memoryType}
											<span>{snippet.memoryType}</span>
										{/if}
										<span class="ml-auto">{formatWhen(snippet.createdAt)}</span>
									</div>
								{/if}
							</div>
						</button>
						<div class="flex items-center gap-1 shrink-0 -mt-0.5">
							<Button
								type="button"
								variant="ghost"
								class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded-none"
								onclick={(e) => {
									e.stopPropagation();
									onEdit(snippet.id);
								}}
							>
								{editingId === snippet.id ? 'Cancel edit' : 'Edit'}
							</Button>
							<Button
								type="button"
								variant="ghost"
								class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive rounded-none"
								disabled={deletingId === snippet.id}
								onclick={(e) => {
									e.stopPropagation();
									onDelete(snippet.id);
								}}
							>
								{deletingId === snippet.id ? 'Deleting…' : 'Delete'}
							</Button>
						</div>
					</Card.Header>

					{#if expanded}
						{#if loadingDetail || !detail}
							<p class="text-sm text-muted-foreground">Loading thought details…</p>
						{:else}
							<CaptureStoredSummary thought={detail} embedded />
						{/if}

						{#if editingId === snippet.id}
							{#if editLoading}
								<div
									class="bg-[#FAFAFA] dark:bg-muted border-t-2 border-black dark:border-border -mx-4 px-4 py-3 mt-3"
								>
									<CaptureQueueStatus
										processing={true}
										pendingCount={0}
										events={editProgressEvents}
										{pipeline}
									/>
								</div>
							{/if}
							<div class="border-t-2 border-black dark:border-border -mx-4 mt-3">
								<div class="px-4 pt-4 space-y-2">
									<Label for="edit-{snippet.id}" class="text-sm">
										Describe your changes in plain language
									</Label>
									<Textarea
										id="edit-{snippet.id}"
										value={editRequest}
										oninput={(e) => onEditRequestChange(e.currentTarget.value)}
										placeholder="Example: Make this shorter and categorize as task."
										class="min-h-24 text-sm md:text-sm border-2 border-black dark:border-border p-3 bg-background dark:bg-input/30 text-foreground"
									/>
								</div>
								<div
									class="bg-[#FAFAFA] dark:bg-muted border-t-2 border-black dark:border-border p-4 flex flex-row items-center justify-end gap-2"
								>
									{#if editLoading}
										<Button
											type="button"
											variant="ghost"
											class="rounded-none px-4 py-2 text-sm font-medium leading-5 h-auto text-muted-foreground hover:text-destructive"
											onclick={onCancelEdit}
										>
											Cancel
										</Button>
									{/if}
									<Button
										type="button"
										class="bg-black text-white rounded-none px-4 py-2 text-sm font-medium leading-5 h-auto border-0 hover:bg-black/90"
										disabled={editLoading || !editRequest.trim()}
										onclick={onSubmitEdit}
									>
										Submit changes
									</Button>
								</div>
							</div>
						{/if}
					{/if}
				</Card.Root>
			{/each}
		</div>
	</div>
{/if}
