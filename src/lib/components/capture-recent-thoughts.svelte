<script lang="ts">
	import { tick } from 'svelte';
	import type { CaptureRecentThoughtSnippet, CaptureSubmitResult } from '$lib/capture/capture-result-types';
	import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';
	import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
	import CaptureQueueStatus from '$lib/components/capture-queue-status.svelte';
	import CaptureStoredSummary from '$lib/components/capture-stored-summary.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import {
		recentThoughtPrimaryLabel,
		recentThoughtSecondaryLabel
	} from '$lib/capture/recent-thought-display';
	import {
		captureIndexingListStatus,
		captureIndexingRetryEligible
	} from '$lib/capture/capture-indexing-status';

	let {
		thoughts,
		thoughtDetails,
		enrichingThoughtIds = new Set<string>(),
		expandedId = null,
		editingId = null,
		editRequest = '',
		editLoading = false,
		deletingId = null,
		retryingId = null,
		loadingDetailId = null,
		editProgressEvents = [],
		pipeline,
		onExpand,
		onCollapse,
		onEdit,
		onDelete,
		onRetry,
		onAttach,
		onUnlinkFile,
		onNoteUpdated,
		onEditRequestChange,
		onSubmitEdit,
		onCancelEdit
	}: {
		thoughts: CaptureRecentThoughtSnippet[];
		thoughtDetails: Record<string, CaptureSubmitResult>;
		enrichingThoughtIds?: ReadonlySet<string>;
		expandedId?: string | null;
		editingId?: string | null;
		editRequest?: string;
		editLoading?: boolean;
		deletingId?: string | null;
		retryingId?: string | null;
		loadingDetailId?: string | null;
		editProgressEvents?: ProgressEvent[];
		pipeline: readonly CaptureIngestPhase[];
		onExpand: (thoughtId: string) => void | Promise<void>;
		onCollapse: (thoughtId: string) => void;
		onEdit: (thoughtId: string) => void;
		onDelete: (thoughtId: string) => void;
		onRetry: (thoughtId: string) => void;
		onAttach?: (thoughtId: string) => void;
		onUnlinkFile?: (thoughtId: string, fileId: string) => void;
		onNoteUpdated?: (thoughtId: string) => void | Promise<void>;
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
			return;
		}
		void (async () => {
			await onExpand(snippetId);
			await scrollDetailIntoView(snippetId);
		})();
	}

	const detailElements = new Map<string, HTMLElement>();

	function detailAnchor(node: HTMLElement, thoughtId: string) {
		detailElements.set(thoughtId, node);
		return {
			destroy() {
				detailElements.delete(thoughtId);
			}
		};
	}

	async function scrollDetailIntoView(thoughtId: string) {
		await tick();
		detailElements.get(thoughtId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function enrichListStatus(
		thoughtId: string,
		detail: CaptureSubmitResult | undefined
	): { label: string; spinning: boolean; failed: boolean } | null {
		return captureIndexingListStatus(detail, enrichingThoughtIds.has(thoughtId));
	}

	function showRetryAction(
		thoughtId: string,
		detail: CaptureSubmitResult | undefined,
		enrichStatus: ReturnType<typeof enrichListStatus>
	): boolean {
		return captureIndexingRetryEligible(detail, enrichStatus);
	}

	const tabEntryClass =
		'flex flex-col overflow-visible bg-white/20 p-0.5 backdrop-blur-sm brightness-105 dark:bg-card';
	const tabTriggerClass =
		'rounded-full px-3 py-2 text-black hover:text-black dark:text-foreground dark:hover:text-foreground';
</script>

{#if thoughts.length > 0}
	<div class="flex flex-col gap-2">
		<h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent</h2>
		<div class="flex flex-col gap-2 pr-1">
			{#each thoughts as snippet (snippet.id)}
				{@const detail = thoughtDetails[snippet.id]}
				{@const expanded = expandedId === snippet.id}
				{@const loadingDetail = loadingDetailId === snippet.id}
				{@const enrichStatus = enrichListStatus(snippet.id, detail)}
				{@const secondary = recentThoughtSecondaryLabel(detail, snippet)}
				<div class="{tabEntryClass} min-w-0">
					<div
						class="flex w-full min-w-0 items-start justify-between gap-2 {tabTriggerClass}"
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-start gap-2 text-left"
							aria-expanded={expanded}
							aria-label={expanded ? 'Collapse thought' : 'Expand thought'}
							onclick={() => toggleThought(snippet.id, expanded)}
						>
							{#if expanded}
								<ChevronDown
									class="mt-0.5 size-4 shrink-0 text-black dark:text-foreground"
									aria-hidden="true"
								/>
							{:else}
								<ChevronRight
									class="mt-0.5 size-4 shrink-0 text-black dark:text-foreground"
									aria-hidden="true"
								/>
							{/if}
							<div class="min-w-0 flex-1">
								{#if expanded}
									<p class="text-xs font-medium text-muted-foreground">Stored thought</p>
								{/if}
								<p
									class="whitespace-pre-wrap text-sm {expanded
										? 'mt-0.5 line-clamp-3'
										: 'line-clamp-2'}"
								>
									{snippet.normalizedText}
								</p>
								<div
									class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
								>
									<span class="font-medium text-foreground">
										{recentThoughtPrimaryLabel(detail, snippet)}
									</span>
									{#if secondary}
										<span>{secondary}</span>
									{/if}
									{#if enrichStatus}
										<span
											class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 {enrichStatus.failed
												? 'border-destructive/40 bg-destructive/10 text-destructive'
												: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'}"
										>
											{#if enrichStatus.spinning}
												<LoaderCircleIcon
													class="size-3 shrink-0 animate-spin"
													aria-hidden="true"
												/>
											{/if}
											{enrichStatus.label}
										</span>
										{#if enrichStatus.failed && detail?.queueError}
											<span class="text-destructive">{detail.queueError}</span>
										{/if}
									{/if}
									<span class="ml-auto">{formatWhen(snippet.createdAt)}</span>
								</div>
							</div>
						</button>
						<div class="-mt-0.5 flex shrink-0 items-center gap-1">
							{#if showRetryAction(snippet.id, detail, enrichStatus)}
								<Button
									type="button"
									variant="ghost"
									class="h-auto rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
									disabled={retryingId === snippet.id}
									onclick={(e) => {
										e.stopPropagation();
										onRetry(snippet.id);
									}}
								>
									{retryingId === snippet.id ? 'Retrying…' : 'Retry'}
								</Button>
							{/if}
							<Button
								type="button"
								variant="ghost"
								class="h-auto rounded-full p-1.5 text-black hover:text-black/70 dark:text-foreground dark:hover:text-foreground/70"
								aria-label={editingId === snippet.id ? 'Cancel edit' : 'Edit'}
								onclick={(e) => {
									e.stopPropagation();
									onEdit(snippet.id);
								}}
							>
								{#if editingId === snippet.id}
									<X class="size-4" strokeWidth={2} aria-hidden="true" />
								{:else}
									<PencilLine class="size-4" strokeWidth={2} aria-hidden="true" />
								{/if}
							</Button>
							<Button
								type="button"
								variant="ghost"
								class="h-auto rounded-full p-1.5 text-destructive hover:text-destructive/80"
								aria-label={deletingId === snippet.id ? 'Deleting…' : 'Delete'}
								disabled={deletingId === snippet.id}
								onclick={(e) => {
									e.stopPropagation();
									onDelete(snippet.id);
								}}
							>
								{#if deletingId === snippet.id}
									<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
								{:else}
									<Trash2 class="size-4" strokeWidth={2} aria-hidden="true" />
								{/if}
							</Button>
						</div>
					</div>

					{#if expanded}
						<div
							class="space-y-3 border-t border-white/80 px-3 pb-3 pt-2 dark:border-white/20"
							use:detailAnchor={snippet.id}
						>
							{#if loadingDetail || !detail}
								<p class="text-sm text-muted-foreground">Loading thought details…</p>
							{:else}
								<CaptureStoredSummary
									thought={detail}
									embedded
									onUnlinkFile={
										onUnlinkFile ? (fileId) => onUnlinkFile(snippet.id, fileId) : undefined
									}
									onNoteUpdated={
										onNoteUpdated ? () => onNoteUpdated(snippet.id) : undefined
									}
								/>
								{#if onAttach}
									<Button
										type="button"
										variant="outline"
										class="h-auto rounded-none px-3 py-1.5 text-xs"
										onclick={() => onAttach(snippet.id)}
									>
										Attach note
									</Button>
								{/if}
							{/if}

							{#if editingId === snippet.id}
								{#if editLoading}
									<div
										class="-mx-3 border-t border-white/80 bg-white/10 px-3 py-3 dark:border-white/20 dark:bg-white/5"
									>
										<CaptureQueueStatus
											processing={true}
											pendingCount={0}
											events={editProgressEvents}
											{pipeline}
										/>
									</div>
								{/if}
								<div class="-mx-3 mt-3 border-t border-white/80 dark:border-white/20">
									<div class="space-y-2 px-3 pt-4">
										<Label for="edit-{snippet.id}" class="text-sm">
											Describe your changes in plain language
										</Label>
										<Textarea
											id="edit-{snippet.id}"
											value={editRequest}
											oninput={(e) => onEditRequestChange(e.currentTarget.value)}
											placeholder="Example: Make this shorter and categorize as task."
											class="min-h-24 border border-white/80 bg-white/20 p-3 text-sm text-foreground shadow-none backdrop-blur-sm dark:border-white/20 dark:bg-white/10 md:text-sm"
										/>
									</div>
									<div
										class="flex flex-row items-center justify-end gap-2 border-t border-white/80 bg-white/10 p-3 dark:border-white/20 dark:bg-white/5"
									>
										{#if editLoading}
											<Button
												type="button"
												variant="ghost"
												class="h-auto rounded-full px-4 py-2 text-sm font-medium leading-5 text-muted-foreground hover:text-destructive"
												onclick={onCancelEdit}
											>
												Cancel
											</Button>
										{/if}
										<Button
											type="button"
											class="h-auto rounded-full border-0 bg-black px-4 py-2 text-sm font-medium leading-5 text-white hover:bg-black/90 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
											disabled={editLoading || !editRequest.trim()}
											onclick={onSubmitEdit}
										>
											Submit changes
										</Button>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
