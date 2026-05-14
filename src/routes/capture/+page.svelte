<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import CaptureOnboardingOverlay from '$lib/components/capture-onboarding-overlay.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { CAPTURE_INGEST_PHASE_COPY, type CaptureIngestPhase } from '$lib/capture/ingest-phases';
	import { consumeCaptureNdjsonStream } from '$lib/capture/consume-capture-ndjson';

	let { data }: { data: PageData } = $props();

	const showOnboarding = $derived(!data.onboardingCompleted);

	let raw = $state('');
	let editRequest = $state('');
	let stored = $state<{
		id: string;
		normalizedText: string;
		category: string;
	} | null>(null);
	let err = $state<string | null>(null);
	let loading = $state(false);
	let ingestPhase = $state<CaptureIngestPhase | null>(null);

	const ingestStatus = $derived(
		ingestPhase
			? CAPTURE_INGEST_PHASE_COPY[ingestPhase]
			: {
					title: 'Preparing ingest',
					description: 'Sending your thought to the ingest pipeline.'
				}
	);

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				e.preventDefault();
				if (!loading && raw.trim()) void capture();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
		};
	});

	async function capture() {
		err = null;
		ingestPhase = null;
		loading = true;
		try {
			const res = await fetch('/api/capture/submit', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/x-ndjson, application/json'
				},
				body: JSON.stringify({ raw })
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (contentType.includes('application/x-ndjson')) {
				const thought = await consumeCaptureNdjsonStream<NonNullable<typeof stored>>(res, (phase) => {
					ingestPhase = phase;
				});
				stored = thought;
				editRequest = '';
				return;
			}
			if (!res.ok) {
				let serverMessage = '';
				try {
					const payload = (await res.json()) as { error?: unknown; details?: unknown };
					if (typeof payload.error === 'string' && payload.error.trim()) {
						serverMessage = payload.error;
					} else if (Array.isArray(payload.details)) {
						const firstDetail = payload.details.find((v) => typeof v === 'string');
						if (typeof firstDetail === 'string') serverMessage = firstDetail;
					}
				} catch {
					serverMessage = await res.text();
				}
				throw new Error(serverMessage || `Capture failed (${res.status})`);
			}
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			editRequest = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
			ingestPhase = null;
		}
	}

	async function submitEditRequest() {
		if (!stored) return;
		err = null;
		ingestPhase = null;
		loading = true;
		try {
			const res = await fetch('/api/capture/edit', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/x-ndjson, application/json'
				},
				body: JSON.stringify({ thoughtId: stored.id, editRequest })
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (contentType.includes('application/x-ndjson')) {
				const thought = await consumeCaptureNdjsonStream<NonNullable<typeof stored>>(res, (phase) => {
					ingestPhase = phase;
				});
				stored = thought;
				editRequest = '';
				return;
			}
			if (!res.ok) throw new Error(await res.text());
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			editRequest = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
			ingestPhase = null;
		}
	}
</script>

<div class="mx-auto flex max-w-xl flex-col px-5 pb-8 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs font-normal">Capture. Structure. Remember.</p>
		<p class="text-muted-foreground mt-2 text-[11px]">{data.user.email}</p>
	</header>

	<section class="mt-8 flex-1 space-y-6">
		<Card.Root class="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] p-[2px] gap-[6px] items-start overflow-visible">
			<Card.Content class="p-0 w-full">
				<Label for="thought" class="sr-only">Thought</Label>
				<Textarea
					id="thought"
					bind:value={raw}
					placeholder="Enter your thought…"
					class="min-h-[128px] p-6 text-base placeholder:text-[#A1A1A1] border-0 bg-transparent shadow-none focus-visible:ring-0 resize-none"
				/>
			</Card.Content>
			<Card.Footer class="bg-[#FAFAFA] border-t-2 border-black p-4 flex flex-row items-center justify-between w-full">
				<span class="text-[#737373] text-xs leading-4">⌘ / Ctrl + Enter to capture</span>
				<Button
					type="button"
					class="bg-black text-white rounded-none px-[22px] py-[7.5px] text-base font-medium leading-6 h-auto border-0 hover:bg-black/90"
					disabled={loading || !raw.trim()}
					onclick={capture}
				>
					Capture
				</Button>
			</Card.Footer>
		</Card.Root>

		{#if loading}
			<div
				class="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] p-4"
				role="status"
				aria-live="polite"
			>
				<div class="flex gap-3">
					<LoaderCircleIcon
						class="text-muted-foreground size-5 shrink-0 animate-spin"
						aria-hidden="true"
					/>
					<div class="min-w-0">
						<p class="text-foreground text-sm font-medium">{ingestStatus.title}</p>
						<p class="text-muted-foreground mt-1 text-xs leading-relaxed">
							{ingestStatus.description}
						</p>
					</div>
				</div>
			</div>
		{/if}

		{#if err}
			<p class="text-destructive text-sm">{err}</p>
		{/if}

		{#if stored}
			<Card.Root class="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] p-4 gap-3 items-start overflow-visible">
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

			<Card.Root class="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] p-0 gap-0 items-start overflow-visible">
				<Card.Content class="p-4 space-y-2 w-full">
					<Label for="edit" class="text-sm">Want changes? Describe them in plain language</Label>
					<Textarea
						id="edit"
						bind:value={editRequest}
						placeholder="Example: Please make this shorter and categorize as task."
						class="min-h-24 text-sm md:text-sm border-2 border-black p-3"
					/>
				</Card.Content>
				<Card.Footer class="bg-[#FAFAFA] border-t-2 border-black p-4 flex flex-row items-center justify-end w-full">
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
