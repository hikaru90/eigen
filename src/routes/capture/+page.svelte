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

	let { data }: { data: PageData } = $props();

	const showOnboarding = $derived(!data.onboardingCompleted);

	let raw = $state('');
	let editRequest = $state('');
	let stored = $state<{ id: string; normalizedText: string; category: string } | null>(null);
	let err = $state<string | null>(null);
	let loading = $state(false);

	// Every progress event received from the stream, in order, with timestamps.
	// This is the single source of truth for the indicator — appended only, never mutated.
	let progressEvents = $state<Array<{ event: ProgressEvent; arrivedAt: number }>>([]);
	let captureStartMs = $state(0);

	let abortController = $state<AbortController | null>(null);

	function cancelCapture() {
		abortController?.abort();
		abortController = null;
		loading = false;
		progressEvents = [];
	}

	function pushEvent(event: ProgressEvent) {
		// Spread into a new array so Svelte sees the reference change and re-renders.
		progressEvents = [...progressEvents, { event, arrivedAt: Date.now() }];
	}

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				e.preventDefault();
				if (!loading && raw.trim()) void capture();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	async function capture() {
		err = null;
		progressEvents = [];
		captureStartMs = Date.now();
		loading = true;
		const ac = new AbortController();
		abortController = ac;
		try {
			const res = await fetch('/api/capture/submit', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/x-ndjson, application/json' },
				body: JSON.stringify({ raw }),
				signal: ac.signal
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (contentType.includes('application/x-ndjson')) {
				const thought = await consumeCaptureNdjsonStream<NonNullable<typeof stored>>(
					res,
					pushEvent,
					ac.signal
				);
				stored = thought;
				editRequest = '';
				return;
			}
			if (!res.ok) {
				let serverMessage = '';
				try {
					const payload = (await res.json()) as { error?: unknown; details?: unknown };
					if (typeof payload.error === 'string' && payload.error.trim()) serverMessage = payload.error;
					else if (Array.isArray(payload.details)) {
						const first = payload.details.find((v) => typeof v === 'string');
						if (typeof first === 'string') serverMessage = first;
					}
				} catch { serverMessage = await res.text(); }
				throw new Error(serverMessage || `Capture failed (${res.status})`);
			}
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			editRequest = '';
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
			progressEvents = [];
			abortController = null;
		}
	}

	async function submitEditRequest() {
		if (!stored) return;
		err = null;
		progressEvents = [];
		captureStartMs = Date.now();
		loading = true;
		const ac = new AbortController();
		abortController = ac;
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
					res,
					pushEvent,
					ac.signal
				);
				stored = thought;
				editRequest = '';
				return;
			}
			if (!res.ok) throw new Error(await res.text());
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			editRequest = '';
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
			progressEvents = [];
			abortController = null;
		}
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
						disabled={loading || !raw.trim()}
						onclick={capture}
					>
						Capture
					</Button>
				</div>
			</Card.Footer>
		</Card.Root>

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
			<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-4 gap-3 items-start overflow-visible">
				<Card.Header class="p-0">
					<Card.Title class="text-sm">Stored thought</Card.Title>
				</Card.Header>
				<Card.Content class="p-0 space-y-2 text-sm">
					<p class="text-card-foreground whitespace-pre-wrap">{stored.normalizedText}</p>
					<p class="text-muted-foreground text-xs">Category: {stored.category}</p>
					<p class="text-muted-foreground text-xs">
						Id: <code class="bg-muted px-1 py-0.5">{stored.id}</code>
					</p>
				</Card.Content>
			</Card.Root>

			<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0 gap-0 items-start overflow-visible">
				<Card.Content class="p-4 space-y-2 w-full">
					<Label for="edit" class="text-sm">Want changes? Describe them in plain language</Label>
					<Textarea
						id="edit"
						bind:value={editRequest}
						placeholder="Example: Please make this shorter and categorize as task."
						class="min-h-24 text-sm md:text-sm border-2 border-black dark:border-border p-3 bg-background dark:bg-input/30 text-foreground"
					/>
				</Card.Content>
				<Card.Footer class="bg-[#FAFAFA] dark:bg-muted border-t-2 border-black dark:border-border p-4 flex flex-row items-center justify-end gap-2 w-full">
					{#if loading}
						<Button
							type="button"
							variant="ghost"
							class="rounded-none px-4 py-2 text-sm font-medium leading-5 h-auto text-muted-foreground hover:text-destructive"
							onclick={cancelCapture}
						>
							Cancel
						</Button>
					{/if}
					<Button
						type="button"
						class="bg-black text-white rounded-none px-4 py-2 text-sm font-medium leading-5 h-auto border-0 hover:bg-black/90"
						disabled={loading || !editRequest.trim()}
						onclick={submitEditRequest}
					>
						Submit changes
					</Button>
				</Card.Footer>
			</Card.Root>
		{/if}
	</section>
</div>

<CaptureOnboardingOverlay open={showOnboarding} llmConfigured={data.llmConfigured} />
