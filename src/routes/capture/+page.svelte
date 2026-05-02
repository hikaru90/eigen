<script lang="ts">
	import { onMount } from 'svelte';
	import { BrowserWhisper, type ASRModel, type TranscribeProgress, type TranscriptSegment } from 'browser-whisper';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';

	let { data }: { data: PageData } = $props();

	let raw = $state('');
	let editRequest = $state('');
	let stored = $state<{
		id: string;
		normalizedText: string;
		category: string;
	} | null>(null);
	let err = $state<string | null>(null);
	let loading = $state(false);
	let whisperStatus = $state<string | null>(null);
	let isRecording = $state(false);
	let mediaRecorder: MediaRecorder | null = null;
	let allChunks: BlobPart[] = [];
	let browserWhisper: BrowserWhisper | null = null;
	let modelWarmupPromise: Promise<void> | null = null;
	let whisperModel = $state<ASRModel>('whisper-tiny');
	let qualityLabel = $state('Low');
	let modelSizeMb = $state(64);
	const transcriptUpdateIntervalMs = 300;
	let preferredLanguage = 'en';
	let recordingMimeType = '';

	function createSilentWavFile(durationMs = 300): File {
		const sampleRate = 16_000;
		const channels = 1;
		const bitsPerSample = 16;
		const bytesPerSample = bitsPerSample / 8;
		const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
		const dataSize = sampleCount * channels * bytesPerSample;
		const buffer = new ArrayBuffer(44 + dataSize);
		const view = new DataView(buffer);

		const writeAscii = (offset: number, value: string) => {
			for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
		};

		writeAscii(0, 'RIFF');
		view.setUint32(4, 36 + dataSize, true);
		writeAscii(8, 'WAVE');
		writeAscii(12, 'fmt ');
		view.setUint32(16, 16, true); // PCM chunk size
		view.setUint16(20, 1, true); // PCM format
		view.setUint16(22, channels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * channels * bytesPerSample, true);
		view.setUint16(32, channels * bytesPerSample, true);
		view.setUint16(34, bitsPerSample, true);
		writeAscii(36, 'data');
		view.setUint32(40, dataSize, true);
		// Audio payload is already zeroed by ArrayBuffer allocation (silence).

		return new File([buffer], 'warmup-silence.wav', { type: 'audio/wav' });
	}

	function warmupWhisperModelInBackground() {
		if (!browserWhisper || modelWarmupPromise) return;
		modelWarmupPromise = browserWhisper
			.transcribe(createSilentWavFile(), {
				model: whisperModel,
				language: preferredLanguage
			})
			.collect()
			.then(() => {
				if (!isRecording && !loading) whisperStatus = `Voice model ready (${whisperModel})`;
			})
			.catch(() => {
				// Ignore warmup failures; foreground transcription path will still surface real errors.
			});
	}

	onMount(() => {
		preferredLanguage = (data.preferredLanguage || navigator.language || 'en').slice(0, 2).toLowerCase();
		const quality = data.preferredTranscriptionQuality ?? 'low';
		if (quality === 'high') {
			whisperModel = 'whisper-small';
			qualityLabel = 'High';
			modelSizeMb = 510;
		} else if (quality === 'medium') {
			whisperModel = 'whisper-base';
			qualityLabel = 'Medium';
			modelSizeMb = 136;
		} else {
			whisperModel = 'whisper-tiny';
			qualityLabel = 'Low';
			modelSizeMb = 64;
		}
		recordingMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
			? 'audio/webm;codecs=opus'
			: MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
				? 'audio/ogg;codecs=opus'
				: '';

		browserWhisper = new BrowserWhisper({
			model: whisperModel,
			language: preferredLanguage
		});
		whisperStatus = `Preparing ${qualityLabel.toLowerCase()} quality voice model in background (${whisperModel}, ~${modelSizeMb} MB)...`;
		warmupWhisperModelInBackground();

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
		loading = true;
		try {
			const res = await fetch('/api/capture/submit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ raw })
			});
			if (!res.ok) throw new Error(await res.text());
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			editRequest = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function startRecording() {
		err = null;
		whisperStatus = null;
		raw = '';
		try {
			if (!browserWhisper) {
				throw new Error('Voice transcription model is still initializing. Please try again.');
			}
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			allChunks = [];
			mediaRecorder = recordingMimeType
				? new MediaRecorder(stream, { mimeType: recordingMimeType })
				: new MediaRecorder(stream);
			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					allChunks.push(event.data);
				}
			};
			mediaRecorder.onstop = async () => {
				for (const track of stream.getTracks()) track.stop();
				isRecording = false;
				await transcribeRecordedAudio();
			};
			mediaRecorder.start();
			isRecording = true;
			whisperStatus = 'Recording...';
		} catch (e) {
			err =
				e instanceof Error
					? e.message
					: 'Microphone recording is unavailable. Check browser permissions.';
		}
	}

	function stopRecording() {
		if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
		whisperStatus = 'Stopping recording...';
		mediaRecorder.stop();
	}

	async function transcribeRecordedAudio() {
		if (allChunks.length === 0) {
			whisperStatus = 'No audio captured';
			return;
		}
		if (!browserWhisper) {
			err = 'Voice transcription model is unavailable. Refresh and try again.';
			return;
		}
		loading = true;
		whisperStatus = 'Transcribing in browser...';
		try {
			const fileType = recordingMimeType || mediaRecorder?.mimeType || 'audio/webm';
			const extension = fileType.includes('ogg') ? 'ogg' : 'webm';
			const blob = new Blob(allChunks, { type: fileType });
			const file = new File([blob], `voice-note.${extension}`, { type: fileType });

			const callbackSegments: TranscriptSegment[] = [];
			let lastTranscriptUiUpdate = 0;
			const collectedSegments = await browserWhisper
				.transcribe(file, {
				model: whisperModel,
				language: preferredLanguage,
				onProgress: (event: TranscribeProgress) => {
					if (event.stage === 'loading') {
						whisperStatus = `Loading model... ${Math.round(event.progress * 100)}%`;
						return;
					}
					if (event.stage === 'decoding') {
						whisperStatus = `Decoding audio... ${Math.round(event.progress * 100)}%`;
						return;
					}
					if (event.stage === 'transcribing') {
						whisperStatus = `Transcribing... ${Math.round(event.progress * 100)}%`;
						return;
					}
					whisperStatus = 'Finalizing transcription...';
				},
				onSegment: (segment: TranscriptSegment) => {
					callbackSegments.push(segment);
					const now = Date.now();
					const shouldUpdateUi = now - lastTranscriptUiUpdate >= transcriptUpdateIntervalMs;
					if (!shouldUpdateUi) return;
					lastTranscriptUiUpdate = now;
					raw = callbackSegments.map((item) => item.text.trim()).filter(Boolean).join(' ').trim();
				}
				})
				.collect();
			raw = callbackSegments.map((item) => item.text.trim()).filter(Boolean).join(' ').trim();
			if (!raw.trim()) {
				raw = collectedSegments
					.map((item) => item.text.trim())
					.filter(Boolean)
					.join(' ')
					.trim();
			}
			if (!raw.trim()) {
				throw new Error(
					'Transcription returned empty text. Try a longer recording, speak louder, or reduce background noise.'
				);
			}
			whisperStatus = 'Voice transcription complete';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function submitEditRequest() {
		if (!stored) return;
		err = null;
		loading = true;
		try {
			const res = await fetch('/api/capture/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ thoughtId: stored.id, editRequest })
			});
			if (!res.ok) throw new Error(await res.text());
			const j = (await res.json()) as { thought: NonNullable<typeof stored> };
			stored = j.thought;
			editRequest = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
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
					placeholder="Enter your thought..."
					class="min-h-[120px] border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 md:text-sm"
				/>
			</Card.Content>
			<Card.Footer class="h-[52px] justify-between gap-3 border-t border-border py-0">
				<span class="text-[#aaaaaa] text-xs">⌘ / Ctrl + Enter to capture</span>
				<Button
					type="button"
					class="h-auto rounded-[4px] px-6 py-3 text-sm font-medium"
					disabled={loading || !raw.trim()}
					onclick={capture}
				>
					Capture
				</Button>
			</Card.Footer>
		</Card.Root>

		<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] border border-black/10 bg-card">
			<Card.Content class="space-y-3 px-4 py-4">
				<p class="text-sm font-medium text-foreground">Voice capture</p>
				<p class="text-muted-foreground text-xs">
					Quality: {qualityLabel} (~{modelSizeMb} MB) ·
					<a class="text-foreground underline" href={resolve('/settings')}>Settings</a>
				</p>
				<div class="flex flex-wrap gap-2">
					{#if isRecording}
						<Button type="button" variant="outline" onclick={stopRecording}>Stop recording</Button>
					{:else}
						<Button type="button" variant="outline" disabled={loading} onclick={startRecording}>
							<svg viewBox="0 0 24 24" class="mr-1 size-4" fill="currentColor" aria-hidden="true">
								<path
									d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h2a1 1 0 1 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
								/>
							</svg>
							Start recording
						</Button>
					{/if}
				</div>
				{#if whisperStatus}
					<p class="text-muted-foreground text-xs">{whisperStatus}</p>
				{/if}
			</Card.Content>
		</Card.Root>

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
