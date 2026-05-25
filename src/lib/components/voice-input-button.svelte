<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import Mic from '@lucide/svelte/icons/mic';
	import Square from '@lucide/svelte/icons/square';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { transcribeRecordedAudio } from '$lib/capture/transcribe-audio';

	const LEVEL_BAR_COUNT = 5;

	let {
		disabled = false,
		language = 'en',
		ontranscript,
		onerror,
		class: className = ''
	}: {
		disabled?: boolean;
		language?: string;
		ontranscript: (text: string) => void;
		onerror?: (message: string) => void;
		class?: string;
	} = $props();

	let recording = $state(false);
	let transcribing = $state(false);
	let mediaRecorder = $state<MediaRecorder | null>(null);
	let stream = $state<MediaStream | null>(null);
	/** Normalized mic level 0–1 while recording. */
	let level = $state(0);
	let chunks: Blob[] = [];

	let audioContext: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let levelFrameId: number | null = null;

	const busy = $derived(recording || transcribing);
	const micSupported = $derived(
		browser &&
			typeof navigator !== 'undefined' &&
			!!navigator.mediaDevices?.getUserMedia &&
			typeof MediaRecorder !== 'undefined'
	);

	const levelBars = $derived(
		Array.from({ length: LEVEL_BAR_COUNT }, (_, i) => {
			const centerWeight = 1 - Math.abs(i - (LEVEL_BAR_COUNT - 1) / 2) * 0.22;
			return Math.min(1, Math.max(0.12, level * centerWeight));
		})
	);

	function stopLevelMeter() {
		if (levelFrameId !== null) {
			cancelAnimationFrame(levelFrameId);
			levelFrameId = null;
		}
		level = 0;
		analyser = null;
		if (audioContext) {
			void audioContext.close();
			audioContext = null;
		}
	}

	function startLevelMeter(mediaStream: MediaStream) {
		stopLevelMeter();
		if (typeof AudioContext === 'undefined') return;

		audioContext = new AudioContext();
		const source = audioContext.createMediaStreamSource(mediaStream);
		analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.75;
		source.connect(analyser);

		const samples = new Uint8Array(analyser.fftSize);

		const tick = () => {
			if (!analyser) return;
			analyser.getByteTimeDomainData(samples);
			let sumSq = 0;
			for (const sample of samples) {
				const normalized = (sample - 128) / 128;
				sumSq += normalized * normalized;
			}
			const rms = Math.sqrt(sumSq / samples.length);
			// Scale so normal speech sits in mid range; cap at 1.
			level = Math.min(1, rms * 4.5);
			levelFrameId = requestAnimationFrame(tick);
		};

		void audioContext.resume();
		levelFrameId = requestAnimationFrame(tick);
	}

	function releaseStream() {
		stopLevelMeter();
		if (stream) {
			for (const track of stream.getTracks()) track.stop();
		}
		stream = null;
	}

	async function startRecording() {
		if (!micSupported || busy || disabled) return;
		chunks = [];
		try {
			const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream = mediaStream;
			startLevelMeter(mediaStream);
			const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
				? 'audio/webm;codecs=opus'
				: MediaRecorder.isTypeSupported('audio/webm')
					? 'audio/webm'
					: '';
			const recorder = preferredMime
				? new MediaRecorder(mediaStream, { mimeType: preferredMime })
				: new MediaRecorder(mediaStream);
			recorder.ondataavailable = (ev) => {
				if (ev.data.size > 0) chunks.push(ev.data);
			};
			recorder.onerror = () => {
				onerror?.('Recording failed');
				recording = false;
				releaseStream();
			};
			recorder.start();
			mediaRecorder = recorder;
			recording = true;
		} catch (err) {
			releaseStream();
			const message =
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'Microphone permission denied'
					: err instanceof Error
						? err.message
						: 'Could not access microphone';
			onerror?.(message);
		}
	}

	async function stopAndTranscribe() {
		if (!mediaRecorder || !recording) return;
		const recorder = mediaRecorder;
		recording = false;
		mediaRecorder = null;
		stopLevelMeter();

		const blob = await new Promise<Blob>((resolve, reject) => {
			recorder.onstop = () => {
				releaseStream();
				if (chunks.length === 0) {
					reject(new Error('No audio recorded'));
					return;
				}
				const type = recorder.mimeType || chunks[0]?.type || 'audio/webm';
				resolve(new Blob(chunks, { type }));
			};
			recorder.stop();
		}).catch((err) => {
			releaseStream();
			throw err;
		});

		transcribing = true;
		try {
			const transcript = await transcribeRecordedAudio(blob, { language });
			ontranscript(transcript);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Transcription failed';
			onerror?.(message);
		} finally {
			transcribing = false;
		}
	}

	async function toggleMic() {
		if (!micSupported) {
			onerror?.('Speech input is not supported in this browser');
			return;
		}
		if (transcribing || disabled) return;
		if (recording) {
			await stopAndTranscribe();
		} else {
			await startRecording();
		}
	}

	onDestroy(() => {
		if (mediaRecorder && recording) {
			try {
				mediaRecorder.stop();
			} catch {
				// ignore
			}
		}
		releaseStream();
	});
</script>

<div class="flex items-center gap-2">
	{#if recording}
		<div
			class="flex items-end gap-0.5 h-5 min-w-9"
			role="meter"
			aria-label="Microphone level"
			aria-valuenow={Math.round(level * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			{#each levelBars as barHeight, i (i)}
				<span
					class="w-1 rounded-sm bg-foreground/90 origin-bottom transition-[height] duration-75 ease-out"
					style="height: {4 + barHeight * 14}px"
				></span>
			{/each}
		</div>
	{/if}
	<Button
		type="button"
		variant="outline"
		class="rounded-none px-3 py-[7.5px] h-auto border-black dark:border-border {className}"
		disabled={disabled || !micSupported || transcribing}
		onclick={toggleMic}
		aria-label={recording ? 'Stop recording and transcribe' : transcribing ? 'Transcribing' : 'Start voice input'}
		aria-pressed={recording}
	>
		{#if transcribing}
			<LoaderCircle class="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
		{:else if recording}
			<Square class="size-4 shrink-0" strokeWidth={1.75} />
		{:else}
			<Mic class="size-4 shrink-0" strokeWidth={1.75} />
		{/if}
	</Button>
</div>
