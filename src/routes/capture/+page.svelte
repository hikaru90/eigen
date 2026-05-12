<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
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

	let dictating = $state(false);
	let dictationStatus = $state<string | null>(null);
	let speechSupported = $state(false);

	let dictationPrefix = '';
	let recognition: SpeechRecognition | null = null;

	function speechLocale(lang: string): string {
		const code = lang.trim().toLowerCase().slice(0, 2);
		const map: Record<string, string> = {
			en: 'en-US',
			de: 'de-DE',
			fr: 'fr-FR',
			es: 'es-ES',
			it: 'it-IT',
			pt: 'pt-PT',
			nl: 'nl-NL',
			pl: 'pl-PL',
			tr: 'tr-TR',
			ru: 'ru-RU',
			ja: 'ja-JP',
			ko: 'ko-KR',
			zh: 'zh-CN'
		};
		if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith(code)) {
			return navigator.language;
		}
		return map[code] ?? 'en-US';
	}

	function getRecognitionCtor(): SpeechRecognitionConstructor | null {
		if (!browser || typeof window === 'undefined') return null;
		return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
	}

	function stopDictation() {
		if (recognition) {
			try {
				recognition.stop();
			} catch {
				try {
					recognition.abort();
				} catch {
					/* noop */
				}
			}
			recognition = null;
		}
		dictating = false;
		dictationStatus = null;
	}

	function toggleDictation() {
		if (dictating) {
			stopDictation();
			return;
		}
		const Ctor = getRecognitionCtor();
		if (!Ctor) {
			err =
				'Speech recognition is not available in this browser. Try Chrome or Edge over HTTPS, or type instead.';
			return;
		}
		if (typeof window !== 'undefined' && !window.isSecureContext) {
			err = 'Speech recognition needs a secure connection (HTTPS).';
			return;
		}
		err = null;
		dictationPrefix = raw.length ? (/\s$/.test(raw) ? raw : `${raw} `) : '';
		dictating = true;
		dictationStatus = 'Listening…';

		const r = new Ctor();
		r.lang = speechLocale(data.preferredLanguage ?? 'en');
		r.continuous = true;
		r.interimResults = true;
		r.maxAlternatives = 1;
		r.onresult = (event: SpeechRecognitionEvent) => {
			let spoken = '';
			for (let i = 0; i < event.results.length; i++) {
				spoken += event.results[i][0].transcript;
			}
			raw = dictationPrefix + spoken;
		};
		r.onerror = (event: SpeechRecognitionErrorEvent) => {
			const code = event.error;
			if (code === 'aborted') {
				err = null;
			} else if (code === 'no-speech') {
				err = null;
				dictationStatus = 'No speech detected; try again.';
			} else if (code === 'not-allowed') {
				err = 'Microphone permission was denied.';
			} else {
				err = `Speech recognition stopped (${code}).`;
			}
			recognition = null;
			dictating = false;
		};
		r.onend = () => {
			recognition = null;
			dictating = false;
			dictationStatus = null;
		};

		recognition = r;
		try {
			r.start();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not start speech recognition.';
			recognition = null;
			dictating = false;
			dictationStatus = null;
		}
	}

	onMount(() => {
		speechSupported = Boolean(getRecognitionCtor());

		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				e.preventDefault();
				if (!loading && !dictating && raw.trim()) void capture();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			if (recognition) {
				try {
					recognition.abort();
				} catch {
					/* noop */
				}
				recognition = null;
			}
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

<div class="mx-auto flex max-w-xl flex-col px-5 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs font-normal">Capture. Structure. Remember.</p>
		<p class="text-muted-foreground mt-2 text-[11px]">{data.user.email}</p>
	</header>

	<section class="mt-8 flex-1 space-y-6">
		<Card.Root
			class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card"
		>
			<Card.Content class="px-4 pb-0 pt-4">
				<Label for="thought" class="sr-only">Thought</Label>
				<Textarea
					id="thought"
					bind:value={raw}
					placeholder="Enter your thought…"
					class="min-h-[120px] border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 md:text-sm"
				/>
			</Card.Content>
			<Card.Footer class="flex flex-col gap-3 border-t border-border py-3 sm:h-auto sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-2">
				<span class="text-[#aaaaaa] text-xs">⌘ / Ctrl + Enter to capture</span>
				<div class="flex flex-wrap items-center justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						class="h-auto rounded-[4px] px-4 py-2 text-xs"
						disabled={loading || !speechSupported}
						title={speechSupported
							? 'Uses the browser Web Speech API (may send audio to the browser vendor).'
							: 'Not available in this browser or without HTTPS.'}
						onclick={toggleDictation}
					>
						{dictating ? 'Stop dictating' : 'Dictate'}
					</Button>
					<Button
						type="button"
						class="h-auto rounded-[4px] px-6 py-3 text-sm font-medium"
						disabled={loading || dictating || !raw.trim()}
						onclick={capture}
					>
						Capture
					</Button>
				</div>
			</Card.Footer>
			{#if dictationStatus}
				<div class="border-t border-border px-4 py-2">
					<p class="text-muted-foreground text-xs">{dictationStatus}</p>
				</div>
			{/if}
		</Card.Root>

		{#if loading}
			<div
				class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card rounded-lg px-4 py-3"
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
			<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
				<Card.Header>
					<Card.Title class="text-sm">Stored thought</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-2 text-sm">
					<p class="text-card-foreground whitespace-pre-wrap">{stored.normalizedText}</p>
					<p class="text-muted-foreground text-xs">Category: {stored.category}</p>
					<p class="text-muted-foreground text-xs">
						Id: <code class="bg-muted rounded px-1 py-0.5">{stored.id}</code>
					</p>
				</Card.Content>
			</Card.Root>

			<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
				<Card.Content class="space-y-2 px-4 py-4">
					<Label for="edit">Want changes? Describe them in plain language</Label>
					<Textarea
						id="edit"
						bind:value={editRequest}
						placeholder="Example: Please make this shorter and categorize as task."
						class="min-h-24 text-sm md:text-sm"
					/>
				</Card.Content>
				<Card.Footer class="justify-end border-t">
					<Button
						type="button"
						variant="outline"
						disabled={loading || !editRequest.trim()}
						onclick={submitEditRequest}
					>
						Submit changes
					</Button>
				</Card.Footer>
			</Card.Root>
		{/if}
	</section>

	<p class="text-muted-foreground mt-10 pb-4 text-center text-[11px]">
		<a class="underline" href={resolve('/')}>Home</a>
	</p>
</div>

<CaptureOnboardingOverlay open={showOnboarding} />
