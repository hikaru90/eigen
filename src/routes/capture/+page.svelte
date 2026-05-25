<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import CaptureOnboardingOverlay from '$lib/components/capture-onboarding-overlay.svelte';
	import IngestPhaseIndicator from '$lib/components/ingest-phase-indicator.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { CAPTURE_PIPELINE } from '$lib/capture/ingest-phases';
	import { consumeCaptureNdjsonStream, type ProgressEvent } from '$lib/capture/consume-capture-ndjson';
	import {
		cancelActiveCapture,
		enqueueCapture,
		getCaptureQueueSnapshot,
		subscribeCaptureQueue,
		type CaptureSubmitResult
	} from '$lib/capture/queue';
	import VoiceInputButton from '$lib/components/voice-input-button.svelte';

	let { data }: { data: PageData } = $props();

	const showOnboarding = $derived(!data.onboardingCompleted);

	let raw = $state('');
	let editRequest = $state('');
	let stored = $state<CaptureSubmitResult | null>(null);
	let showEdit = $state(false);
	let err = $state<string | null>(null);

	let activeCaptureId = $state<string | null>(null);
	let pendingCount = $state(0);
	let loading = $derived(activeCaptureId !== null);

	let progressEvents = $state<Array<{ event: ProgressEvent; arrivedAt: number }>>([]);
	let captureStartMs = $state(0);

	let editAbortController = $state<AbortController | null>(null);
	let editLoading = $state(false);
	function appendTranscript(current: string, transcript: string): string {
		const next = transcript.trim();
		if (!next) return current;
		const base = current.trim();
		return base ? `${base} ${next}` : next;
	}

	function cancelCapture() {
		cancelActiveCapture();
		activeCaptureId = null;
		progressEvents = [];
	}

	function pushEvent(event: ProgressEvent) {
		progressEvents = [...progressEvents, { event, arrivedAt: Date.now() }];
	}

	onMount(() => {
		void getCaptureQueueSnapshot().then((snap) => {
			pendingCount = snap.pending;
			activeCaptureId = snap.processingId;
		});

		const unsub = subscribeCaptureQueue((message) => {
			if (message.type === 'snapshot') {
				pendingCount = message.pending;
				activeCaptureId = message.processingId;
				return;
			}
			if (message.type === 'active') {
				activeCaptureId = message.id;
				err = null;
				progressEvents = [];
				captureStartMs = Date.now();
				return;
			}
			if (message.type === 'progress' && message.id === activeCaptureId) {
				pushEvent(message.event);
				return;
			}
			if (message.type === 'done') {
				stored = message.thought;
				showEdit = false;
				editRequest = '';
				if (message.id === activeCaptureId) {
					activeCaptureId = null;
					progressEvents = [];
				}
				return;
			}
			if (message.type === 'failed') {
				err = message.error;
				if (message.id === activeCaptureId) {
					activeCaptureId = null;
					progressEvents = [];
				}
				return;
			}
			if (message.type === 'idle') {
				activeCaptureId = null;
				progressEvents = [];
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
			unsub();
			window.removeEventListener('keydown', onKey);
		};
	});

	async function capture() {
		if (!raw.trim()) return;
		err = null;
		const text = raw;
		raw = '';
		try {
			await enqueueCapture(text);
			const snap = await getCaptureQueueSnapshot();
			pendingCount = snap.pending;
		} catch (e) {
			raw = text;
			err = e instanceof Error ? e.message : String(e);
		}
	}

	async function submitEditRequest() {
		if (!stored) return;
		err = null;
		progressEvents = [];
		captureStartMs = Date.now();
		editLoading = true;
		const ac = new AbortController();
		editAbortController = ac;
		try {
			const res = await fetch('/api/capture/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/x-ndjson, application/json' },
				body: JSON.stringify({ thoughtId: stored.id, editRequest }),
				signal: ac.signal
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (contentType.includes('application/x-ndjson')) {
				const thought = await consumeCaptureNdjsonStream<NonNullable<typeof stored>>(
					res, pushEvent, ac.signal
				);
				stored = thought;
				showEdit = false;
				editRequest = '';
				return;
			}
			if (!res.ok) throw new Error(await res.text());
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			showEdit = false;
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

	// Pull interesting fields out of metadata for display
	function getMetaDisplay(s: NonNullable<typeof stored>): Array<{ label: string; value: string }> {
		const rows: Array<{ label: string; value: string }> = [];
		const m = s.metadata as Record<string, unknown> | null | undefined;
		if (!m) return rows;
		if (typeof m.categoryConfidence === 'number') {
			rows.push({ label: 'Confidence', value: `${Math.round(m.categoryConfidence * 100)}%` });
		}
		if (m.nearDuplicate && typeof m.nearDuplicate === 'object') {
			const nd = m.nearDuplicate as { distance?: number; preview?: string };
			if (typeof nd.distance === 'number') {
				rows.push({ label: 'Near-duplicate', value: `distance ${nd.distance.toFixed(3)}${nd.preview ? ` — "${nd.preview}"` : ''}` });
			}
		}
		return rows;
	}
</script>

<div class="mx-auto flex max-w-xl flex-col px-5 pb-8">
	<header class="text-center"></header>

	<section class="flex-1 space-y-6">
		<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-[2px] gap-[6px] items-start overflow-visible">
			<Card.Content class="p-0 w-full">
				<Label for="thought" class="sr-only">Thought</Label>
				<Textarea
					id="thought"
					bind:value={raw}
					placeholder="Enter your thought…"
					class="min-h-[128px] p-6 text-base placeholder:text-muted-foreground border-0 bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 resize-none text-foreground"
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
					{#if loading}
						<Button
							type="button"
							variant="ghost"
							class="rounded-none px-4 py-[7.5px] text-sm font-medium leading-6 h-auto text-muted-foreground hover:text-destructive"
							onclick={cancelCapture}
						>
							Cancel
						</Button>
					{/if}
					<Button
						type="button"
						class="bg-black text-white rounded-none px-[22px] py-[7.5px] text-base font-medium leading-6 h-auto border-0 hover:bg-black/90"
						disabled={!raw.trim()}
						onclick={capture}
					>
						Capture
					</Button>
				</div>
			</Card.Footer>
		</Card.Root>

		{#if pendingCount > 0 && !loading}
			<p class="text-muted-foreground text-xs">
				{pendingCount} capture{pendingCount === 1 ? '' : 's'} queued{typeof navigator !== 'undefined' && !navigator.onLine ? ' (offline)' : ''}.
			</p>
		{/if}

		{#if loading}
			<div class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-4">
				<IngestPhaseIndicator
					events={progressEvents}
					pipeline={CAPTURE_PIPELINE}
					startMs={captureStartMs}
				/>
			</div>
		{/if}

		{#if err}
			<p class="text-destructive text-sm">{err}</p>
		{/if}

		{#if stored}
			{@const metaRows = getMetaDisplay(stored)}
			<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-4 gap-3 items-start overflow-visible">
				<Card.Header class="p-0 w-full flex flex-row items-start justify-between gap-2">
					<Card.Title class="text-sm">Stored thought</Card.Title>
					<Button
						type="button"
						variant="ghost"
						class="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded-none -mt-0.5 shrink-0"
						onclick={() => { showEdit = !showEdit; if (!showEdit) editRequest = ''; }}
					>
						{showEdit ? 'Cancel edit' : 'Edit'}
					</Button>
				</Card.Header>
				<Card.Content class="p-0 space-y-2 text-sm">
					<p class="text-card-foreground whitespace-pre-wrap">{stored.normalizedText}</p>
					<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span>Category: <span class="font-medium text-foreground">{stored.category}</span></span>
						{#each metaRows as row}
							<span>{row.label}: <span class="font-medium text-foreground">{row.value}</span></span>
						{/each}
					</div>
					<p class="text-muted-foreground text-xs font-mono">{stored.id}</p>
				</Card.Content>
			</Card.Root>

			{#if showEdit}
				<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0 gap-0 items-start overflow-visible">
					<Card.Content class="p-4 space-y-2 w-full">
						<Label for="edit" class="text-sm">Describe your changes in plain language</Label>
						<Textarea
							id="edit"
							bind:value={editRequest}
							placeholder="Example: Make this shorter and categorize as task."
							class="min-h-24 text-sm md:text-sm border-2 border-black dark:border-border p-3 bg-background dark:bg-input/30 text-foreground"
						/>
					</Card.Content>
					<Card.Footer class="bg-[#FAFAFA] dark:bg-muted border-t-2 border-black dark:border-border p-4 flex flex-row items-center justify-end gap-2 w-full">
						{#if editLoading}
							<Button
								type="button"
								variant="ghost"
								class="rounded-none px-4 py-2 text-sm font-medium leading-5 h-auto text-muted-foreground hover:text-destructive"
								onclick={() => editAbortController?.abort()}
							>
								Cancel
							</Button>
						{/if}
						<Button
							type="button"
							class="bg-black text-white rounded-none px-4 py-2 text-sm font-medium leading-5 h-auto border-0 hover:bg-black/90"
							disabled={editLoading || !editRequest.trim()}
							onclick={submitEditRequest}
						>
							Submit changes
						</Button>
					</Card.Footer>
				</Card.Root>
			{/if}
		{/if}
	</section>
</div>

<CaptureOnboardingOverlay open={showOnboarding} llmConfigured={data.llmConfigured} />
