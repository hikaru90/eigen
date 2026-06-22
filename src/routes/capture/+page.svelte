<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import GroundingQuestionCard from '$lib/components/grounding-question-card.svelte';
	import CaptureOnboardingOverlay from '$lib/components/capture-onboarding-overlay.svelte';
	import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte';
	import { enhance } from '$app/forms';
	import CaptureQueueList from '$lib/components/capture-queue-list.svelte';
	import CaptureRecentThoughts from '$lib/components/capture-recent-thoughts.svelte';
	import CaptureAttachFileDialog from '$lib/components/capture-attach-file-dialog.svelte';
	import VoiceInputButton from '$lib/components/voice-input-button.svelte';
	import type { CaptureRecentThoughtSnippet } from '$lib/capture/capture-result-types';
	import {
		deleteCaptureThought,
		fetchCaptureResult,
		retryCaptureEnrich
	} from '$lib/capture/capture-result-api';
	import { upsertRecentThoughtList } from '$lib/capture/upsert-recent-thought-list';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { CAPTURE_FAST_PIPELINE, CAPTURE_PIPELINE } from '$lib/capture/ingest-phases';
	import { consumeCaptureNdjsonStream, type ProgressEvent } from '$lib/capture/consume-capture-ndjson';
	import {
		cancelCaptureQueueItem,
		enqueueCapture,
		getCaptureQueueSnapshot,
		subscribeCaptureQueue,
		type CaptureQueueItem,
		type CaptureSubmitResult
	} from '$lib/capture/queue';
	import {
		applyCaptureQueueActive,
		applyCaptureQueueSnapshot,
		CAPTURE_QUEUE_ACTIVATION_GUARD_MS,
		initialCaptureQueueUiState,
		shouldAcceptCaptureProgress,
		type CaptureQueueUiState
	} from '$lib/capture/queue/ui-state';
	import { pollUntilEnrichmentComplete } from '$lib/capture/poll-enrichment';
	import { pollCaptureRecentSync, fetchRecentCaptureMerge } from '$lib/capture/poll-capture-recent-sync';
	import type { RecentCaptureMergeResult } from '$lib/capture/poll-capture-recent-sync';
	import { shouldRejectDestructiveRecentSync } from '$lib/capture/reject-destructive-recent-sync';
	import { fetchEnrichPendingSnapshot } from '$lib/graph/poll-graph-enrich-refresh';
	import { unlinkTextFileFromThought } from '$lib/text-files/api';
	import { captureInputDraft } from '$lib/stores/page-input-drafts';
	import { get } from 'svelte/store';

	let { data }: { data: PageData } = $props();

	const showOnboarding = $derived(!data.onboardingCompleted);
	const captureBlocked = $derived(!data.captureAllowed);

	type GroundingQuestionPayload = { facetKey: string; question: string } | null;
	let groundingQuestion = $state<GroundingQuestionPayload>(null);
	let groundingQuestionDismissed = $state(false);

	$effect(() => {
		data.groundingQuestionEligible;
		groundingQuestionDismissed = false;
		groundingQuestion = null;
		if (!data.groundingQuestionEligible) return;
		void (async () => {
			try {
				const res = await fetch('/api/grounding/question');
				if (!res.ok) return;
				const payload = (await res.json()) as {
					question?: { facetKey: string; question: string } | null;
				};
				if (payload.question?.question) {
					groundingQuestion = payload.question;
					if (page.url.searchParams.get('grounding') === '1') {
						queueMicrotask(() => {
							document.getElementById('grounding-question')?.scrollIntoView({
								behavior: 'smooth',
								block: 'nearest'
							});
						});
					}
				}
			} catch {
				// optional card — ignore fetch errors
			}
		})();
	});
	let localWalletCredits = $state(data.walletAvailableCredits);

	$effect(() => {
		localWalletCredits = data.walletAvailableCredits;
	});

	const RECENT_THOUGHTS_LIMIT = 8;

	let raw = $state(get(captureInputDraft));
	let editRequest = $state('');

	$effect(() => {
		captureInputDraft.set(raw);
	});
	let recentThoughts = $state<CaptureRecentThoughtSnippet[]>(data.recentThoughts);
	let thoughtDetails = $state<Record<string, CaptureSubmitResult>>(
		Object.fromEntries(data.recentThoughtDetails.map((thought) => [thought.id, thought]))
	);
	let expandedThoughtId = $state<string | null>(null);
	let editingThoughtId = $state<string | null>(null);
	let err = $state<string | null>(null);

	let queueUi = $state<CaptureQueueUiState>(initialCaptureQueueUiState());
	/** Mirrors in-flight capture id for progress matching (updated synchronously in queue handlers). */
	let processingCaptureId = $state<string | null>(null);
	let pendingCount = $derived(queueUi.pendingCount);
	let loading = $derived(processingCaptureId !== null);
	const queueActive = $derived(pendingCount > 0 || processingCaptureId !== null);
	const offline = $derived(typeof navigator !== 'undefined' && !navigator.onLine);

	let queueItems = $state<CaptureQueueItem[]>([]);
	let progressEvents = $state<Array<{ event: ProgressEvent; arrivedAt: number }>>([]);
	let captureStartMs = $state(0);
	/** Ignore stale snapshot processing ids briefly after done/failed (SW/tab race). */
	let suppressProcessingResyncUntil = $state(0);

	let editAbortController = $state<AbortController | null>(null);
	let editLoading = $state(false);
	let deletingThoughtId = $state<string | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteTargetId = $state<string | null>(null);
	let retryingThoughtId = $state<string | null>(null);
	let loadingDetailId = $state<string | null>(null);
	let attachDialogOpen = $state(false);
	let attachTargetThoughtId = $state<string | null>(null);
	const enrichPollCancelByThoughtId = new Map<string, () => void>();
	let backgroundEnrichingIds = $state<string[]>([]);
	const enrichingThoughtIds = $derived(new Set(backgroundEnrichingIds));

	function startBackgroundEnrichPoll(thoughtId: string) {
		enrichPollCancelByThoughtId.get(thoughtId)?.();
		backgroundEnrichingIds = [...new Set([...backgroundEnrichingIds, thoughtId])];
		const cancel = pollUntilEnrichmentComplete({
			thoughtId,
			onUpdate: (thought) => {
				upsertRecentThought(thought);
				if (thought.enrichmentComplete) {
					cancelEnrichPoll(thoughtId);
				}
			},
			onTimeout: () => {
				cancelEnrichPoll(thoughtId);
			}
		});
		enrichPollCancelByThoughtId.set(thoughtId, cancel);
	}

	function upsertRecentThought(thought: CaptureSubmitResult, options?: { pinToTop?: boolean }) {
		thoughtDetails = { ...thoughtDetails, [thought.id]: thought };
		recentThoughts = upsertRecentThoughtList(recentThoughts, thought, {
			pinToTop: options?.pinToTop,
			limit: RECENT_THOUGHTS_LIMIT
		});
	}

	function cancelEnrichPoll(thoughtId: string) {
		enrichPollCancelByThoughtId.get(thoughtId)?.();
		enrichPollCancelByThoughtId.delete(thoughtId);
		backgroundEnrichingIds = backgroundEnrichingIds.filter((id) => id !== thoughtId);
	}

	function applyRecentCaptureSync(merged: RecentCaptureMergeResult) {
		if (shouldRejectDestructiveRecentSync(recentThoughts, thoughtDetails, merged.snippets)) {
			return;
		}
		const expandedId = expandedThoughtId;
		recentThoughts = merged.snippets;
		thoughtDetails = merged.details;
		if (expandedId && !merged.snippets.some((row) => row.id === expandedId)) {
			expandedThoughtId = null;
		}
		for (const thoughtId of merged.newThoughtIds) {
			const thought = merged.details[thoughtId];
			if (thought && !thought.enrichmentComplete) {
				startBackgroundEnrichPoll(thoughtId);
			}
		}
	}

	async function refreshRecentCaptureFromServer() {
		try {
			const merged = await fetchRecentCaptureMerge({
				limit: RECENT_THOUGHTS_LIMIT,
				getState: () => ({ snippets: recentThoughts, details: thoughtDetails })
			});
			applyRecentCaptureSync(merged);
		} catch {
			// Transient errors — poll will retry.
		}
	}

	function removeRecentThought(thoughtId: string) {
		cancelEnrichPoll(thoughtId);
		recentThoughts = recentThoughts.filter((row) => row.id !== thoughtId);
		const { [thoughtId]: _removed, ...rest } = thoughtDetails;
		thoughtDetails = rest;
		if (expandedThoughtId === thoughtId) expandedThoughtId = null;
		if (editingThoughtId === thoughtId) {
			editingThoughtId = null;
			editRequest = '';
		}
	}

	async function ensureThoughtDetail(thoughtId: string) {
		if (thoughtDetails[thoughtId]) return thoughtDetails[thoughtId];
		loadingDetailId = thoughtId;
		try {
			const thought = await fetchCaptureResult(thoughtId);
			thoughtDetails = { ...thoughtDetails, [thoughtId]: thought };
			return thought;
		} finally {
			if (loadingDetailId === thoughtId) loadingDetailId = null;
		}
	}

	async function expandThought(thoughtId: string) {
		err = null;
		expandedThoughtId = thoughtId;
		try {
			await ensureThoughtDetail(thoughtId);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
			if (expandedThoughtId === thoughtId) expandedThoughtId = null;
		}
	}

	function collapseThought(thoughtId: string) {
		if (expandedThoughtId === thoughtId) expandedThoughtId = null;
		if (editingThoughtId === thoughtId) {
			editingThoughtId = null;
			editRequest = '';
		}
	}

	async function toggleThoughtEdit(thoughtId: string) {
		err = null;
		if (editingThoughtId === thoughtId) {
			editingThoughtId = null;
			editRequest = '';
			return;
		}
		try {
			await ensureThoughtDetail(thoughtId);
			expandedThoughtId = thoughtId;
			editingThoughtId = thoughtId;
			editRequest = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		}
	}

	function openDeleteDialog(thoughtId: string) {
		err = null;
		deleteTargetId = thoughtId;
		deleteDialogOpen = true;
	}

	async function confirmDeleteThought() {
		if (!deleteTargetId) return;
		const thoughtId = deleteTargetId;
		err = null;
		deletingThoughtId = thoughtId;
		try {
			await deleteCaptureThought(thoughtId);
			removeRecentThought(thoughtId);
			deleteDialogOpen = false;
			deleteTargetId = null;
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			if (deletingThoughtId === thoughtId) deletingThoughtId = null;
		}
	}

	async function refreshThoughtDetail(thoughtId: string) {
		const thought = await fetchCaptureResult(thoughtId);
		thoughtDetails = { ...thoughtDetails, [thoughtId]: thought };
		return thought;
	}

	function openAttachDialog(thoughtId: string) {
		err = null;
		attachTargetThoughtId = thoughtId;
		attachDialogOpen = true;
	}

	async function unlinkAttachedFile(thoughtId: string, fileId: string) {
		err = null;
		try {
			await unlinkTextFileFromThought(thoughtId, fileId);
			await refreshThoughtDetail(thoughtId);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		}
	}

	async function retryEnrichThought(thoughtId: string) {
		err = null;
		retryingThoughtId = thoughtId;
		try {
			await retryCaptureEnrich(thoughtId);
			startBackgroundEnrichPoll(thoughtId);
			const thought = await fetchCaptureResult(thoughtId);
			upsertRecentThought(thought);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			if (retryingThoughtId === thoughtId) retryingThoughtId = null;
		}
	}

	function appendTranscript(current: string, transcript: string): string {
		const next = transcript.trim();
		if (!next) return current;
		const base = current.trim();
		return base ? `${base} ${next}` : next;
	}

	function applyQueueSnapshot(
		snapshot: {
			items: CaptureQueueItem[];
			pending: number;
			processingId: string | null;
		},
		opts?: { respectProcessingSuppress?: boolean }
	) {
		queueItems = snapshot.items;
		queueUi = applyCaptureQueueSnapshot(queueUi, {
			pending: snapshot.pending,
			processingId: snapshot.processingId
		});
		const mayResyncProcessing =
			!opts?.respectProcessingSuppress || Date.now() >= suppressProcessingResyncUntil;
		if (mayResyncProcessing) {
			if (snapshot.processingId && snapshot.processingId !== processingCaptureId) {
				progressEvents = [];
				captureStartMs = Date.now();
			}
			processingCaptureId = snapshot.processingId;
		}
	}

	async function reconcileQueueState(
		clearProgressWhenIdle = true,
		opts?: { respectProcessingSuppress?: boolean }
	) {
		const snap = await getCaptureQueueSnapshot();
		applyQueueSnapshot(snap, opts);
		if (clearProgressWhenIdle && !snap.processingId) {
			progressEvents = [];
		}
	}

	async function cancelQueuedItem(id: string) {
		err = null;
		if (processingCaptureId === id) {
			progressEvents = [];
		}
		try {
			await cancelCaptureQueueItem(id);
			await reconcileQueueState(false);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		}
	}

	function pushEvent(event: ProgressEvent) {
		progressEvents = [...progressEvents, { event, arrivedAt: Date.now() }];
	}

	onMount(() => {
		void reconcileQueueState(false);
		void fetchEnrichPendingSnapshot().catch(() => {
			// Best-effort: kick tier-2 worker for pending/stale rows after reload.
		});
		for (const thought of Object.values(thoughtDetails)) {
			if (!thought.enrichmentComplete) {
				startBackgroundEnrichPoll(thought.id);
			}
		}

		const cancelRecentSync = pollCaptureRecentSync({
			limit: RECENT_THOUGHTS_LIMIT,
			getState: () => ({ snippets: recentThoughts, details: thoughtDetails }),
			onSync: applyRecentCaptureSync
		});

		const unsub = subscribeCaptureQueue((message) => {
			if (message.type === 'snapshot') {
				applyQueueSnapshot(message);
				return;
			}
			if (message.type === 'active') {
				suppressProcessingResyncUntil = 0;
				if (processingCaptureId !== message.id) {
					progressEvents = [];
					captureStartMs = Date.now();
				}
				processingCaptureId = message.id;
				queueUi = applyCaptureQueueActive(queueUi, message.id);
				err = null;
				return;
			}
			if (
				message.type === 'progress' &&
				shouldAcceptCaptureProgress(
					{
						...queueUi,
						activeCaptureId: processingCaptureId ?? queueUi.activeCaptureId
					},
					message.id
				)
			) {
				if (processingCaptureId !== message.id) {
					processingCaptureId = message.id;
				}
				pushEvent(message.event);
				return;
			}
			if (message.type === 'done') {
				upsertRecentThought(message.thought, { pinToTop: true });
				expandedThoughtId = message.thought.id;
				editingThoughtId = null;
				editRequest = '';
				progressEvents = [];
				processingCaptureId = null;
				suppressProcessingResyncUntil = Date.now() + CAPTURE_QUEUE_ACTIVATION_GUARD_MS;
				queueUi = {
					...queueUi,
					activeCaptureId: null,
					recentlyActivatedId: null
				};
				if (!message.thought.enrichmentComplete) {
					startBackgroundEnrichPoll(message.thought.id);
				}
				void refreshRecentCaptureFromServer();
				void reconcileQueueState(false, { respectProcessingSuppress: true });
				return;
			}
			if (message.type === 'failed') {
				err = message.error;
				progressEvents = [];
				processingCaptureId = null;
				suppressProcessingResyncUntil = Date.now() + CAPTURE_QUEUE_ACTIVATION_GUARD_MS;
				queueUi = {
					...queueUi,
					activeCaptureId: null,
					recentlyActivatedId: null
				};
				void reconcileQueueState(false, { respectProcessingSuppress: true });
				return;
			}
			if (message.type === 'idle') {
				void refreshRecentCaptureFromServer();
				void reconcileQueueState();
			}
		});

		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				e.preventDefault();
				if (raw.trim()) void capture();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			cancelRecentSync();
			unsub();
			window.removeEventListener('keydown', onKey);
			for (const cancel of enrichPollCancelByThoughtId.values()) cancel();
			enrichPollCancelByThoughtId.clear();
		};
	});

	async function capture() {
		if (!raw.trim()) return;
		err = null;
		const text = raw;
		raw = '';
		queueUi = { ...queueUi, pendingCount: queueUi.pendingCount + 1 };
		try {
			await enqueueCapture(text);
			await reconcileQueueState(false);
			void refreshRecentCaptureFromServer();
		} catch (e) {
			raw = text;
			queueUi = {
				...queueUi,
				pendingCount: Math.max(0, queueUi.pendingCount - 1)
			};
			err = e instanceof Error ? e.message : String(e);
		}
	}

	async function submitEditRequest() {
		if (!editingThoughtId) return;
		const thoughtId = editingThoughtId;
		err = null;
		progressEvents = [];
		editLoading = true;
		const ac = new AbortController();
		editAbortController = ac;
		try {
			const res = await fetch('/api/capture/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/x-ndjson, application/json' },
				body: JSON.stringify({ thoughtId, editRequest }),
				signal: ac.signal
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (contentType.includes('application/x-ndjson')) {
				const thought = await consumeCaptureNdjsonStream<CaptureSubmitResult>(
					res, pushEvent, ac.signal
				);
				upsertRecentThought(thought);
				editingThoughtId = null;
				editRequest = '';
				return;
			}
			if (!res.ok) throw new Error(await res.text());
			const j = (await res.json()) as { thought: CaptureSubmitResult };
			upsertRecentThought(j.thought);
			editingThoughtId = null;
			editRequest = '';
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			err = e instanceof Error ? e.message : String(e);
		} finally {
			editLoading = false;
			progressEvents = [];
			editAbortController = null;
		}
	}
</script>

<div class="fixed inset-x-0 top-20 bottom-0 z-0 mx-auto flex max-w-xl flex-col overflow-hidden">
	<div class="shrink-0 space-y-4 px-5">
		{#if groundingQuestion && !groundingQuestionDismissed}
			<GroundingQuestionCard
				facetKey={groundingQuestion.facetKey}
				question={groundingQuestion.question}
				onDismiss={() => {
					groundingQuestionDismissed = true;
					groundingQuestion = null;
				}}
				onSaved={() => {
					groundingQuestionDismissed = true;
					groundingQuestion = null;
				}}
			/>
		{/if}
		{#if captureBlocked}
			<Card.Root class="shrink-0 border-2 border-black dark:border-border">
				<Card.Header>
					<Card.Title class="text-sm">Before your first capture</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-3 text-xs">
					{#if data.captureGateReason === 'insufficient_credits' && data.billingMode === 'platform_credits'}
						<p class="text-muted-foreground leading-relaxed">
							Add Eigen credits to run capture and enrichment (minimum {data.minCaptureCredits.toLocaleString()}
							credits).
						</p>
						<CreditsTopUpPanel
							compact
							availableCredits={localWalletCredits}
							paypalConfigured={data.paypalConfigured}
							paypalClientId={data.paypalClientId}
							paypalSdkUrl={data.paypalSdkUrl}
							onBalanceUpdated={(credits) => {
								localWalletCredits = credits;
							}}
						/>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class="shrink-0 bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0 gap-0 items-start overflow-visible">
			<Card.Content class="p-0 w-full">
				<Label for="thought" class="sr-only">Thought</Label>
				<Textarea
					id="thought"
					bind:value={raw}
					placeholder="Enter your thought…"
					class="min-h-[128px] max-h-[min(45dvh,360px)] overflow-y-auto p-6 text-base md:text-base placeholder:text-muted-foreground border-0 bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 resize-none text-foreground"
				/>
			</Card.Content>
			<Card.Footer class="bg-[#FAFAFA] dark:bg-muted border-t-2 border-black dark:border-border p-4 flex flex-row items-center justify-between w-full">
				<span class="text-[#737373] text-xs leading-4">⌘ / Ctrl + Enter to capture</span>
				<div class="flex items-center gap-2">
					<VoiceInputButton
						language={data.preferredLanguage}
						disabled={loading}
						ontranscript={(text) => {
							raw = appendTranscript(raw, text);
						}}
						onerror={(message) => {
							err = message;
						}}
					/>
					<Button
						type="button"
						class="bg-black text-white rounded-none px-[22px] py-[7.5px] text-base font-medium leading-6 h-auto border-0 hover:bg-black/90"
						disabled={!raw.trim() || captureBlocked || loading}
						onclick={capture}
					>
						Capture
					</Button>
				</div>
			</Card.Footer>
		</Card.Root>
	</div>

	<div class="relative min-h-0 flex-1">
		<div class="absolute inset-0 overflow-y-auto px-5">
			<section class="flex flex-col gap-4 pt-6 pb-28">
				<CaptureRecentThoughts
					thoughts={recentThoughts}
					{thoughtDetails}
					enrichingThoughtIds={enrichingThoughtIds}
					expandedId={expandedThoughtId}
					editingId={editingThoughtId}
					{editRequest}
					{editLoading}
					deletingId={deletingThoughtId}
					retryingId={retryingThoughtId}
					loadingDetailId={loadingDetailId}
					editProgressEvents={progressEvents.map((row) => row.event)}
					pipeline={CAPTURE_PIPELINE}
					onExpand={expandThought}
					onCollapse={collapseThought}
					onEdit={(id) => void toggleThoughtEdit(id)}
					onDelete={openDeleteDialog}
					onAttach={openAttachDialog}
					onUnlinkFile={(thoughtId, fileId) => void unlinkAttachedFile(thoughtId, fileId)}
					onNoteUpdated={(thoughtId) => refreshThoughtDetail(thoughtId)}
					onRetry={(id) => void retryEnrichThought(id)}
					onEditRequestChange={(value) => {
						editRequest = value;
					}}
					onSubmitEdit={submitEditRequest}
					onCancelEdit={() => editAbortController?.abort()}
				/>

				{#if queueActive}
					<div class="space-y-2">
						<CaptureQueueList
							items={queueItems}
							processingId={processingCaptureId}
							events={progressEvents}
							pipeline={CAPTURE_FAST_PIPELINE}
							startMs={captureStartMs}
							oncancel={(id) => void cancelQueuedItem(id)}
						/>
						{#if offline && pendingCount > 0 && !loading}
							<p class="text-xs text-muted-foreground">Offline — queue will resume when connected</p>
						{/if}
					</div>
				{/if}

				{#if err}
					<p class="text-destructive text-sm">{err}</p>
				{/if}
			</section>
		</div>
	</div>
</div>

<CaptureOnboardingOverlay
	open={showOnboarding}
	billingMode={data.billingMode}
	walletAvailableCredits={localWalletCredits}
	minCaptureCredits={data.minCaptureCredits}
	paypalConfigured={data.paypalConfigured}
	paypalClientId={data.paypalClientId}
	paypalSdkUrl={data.paypalSdkUrl}
	creditsGatePassed={data.creditsGatePassed || localWalletCredits >= data.minCaptureCredits}
/>

<AlertDialog.Root
	bind:open={deleteDialogOpen}
	onOpenChange={(open) => {
		if (!open && !deletingThoughtId) deleteTargetId = null;
	}}
>
	<AlertDialog.Content class="max-w-sm rounded-none border-2 border-black dark:border-border">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this thought?</AlertDialog.Title>
			<AlertDialog.Description>
				It will be removed from search and the graph permanently. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="rounded-none" disabled={deletingThoughtId !== null}>
				Cancel
			</AlertDialog.Cancel>
			<Button
				type="button"
				variant="destructive"
				class="rounded-none"
				disabled={deletingThoughtId !== null}
				onclick={() => void confirmDeleteThought()}
			>
				{deletingThoughtId ? 'Deleting…' : 'Delete'}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

{#if attachTargetThoughtId}
	<CaptureAttachFileDialog
		bind:open={attachDialogOpen}
		thoughtId={attachTargetThoughtId}
		onLinked={async () => {
			if (!attachTargetThoughtId) return;
			await refreshThoughtDetail(attachTargetThoughtId);
		}}
	/>
{/if}
