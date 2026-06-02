<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import Mic from '@lucide/svelte/icons/mic';
	import { DEMO_CAPTURE_TEXT, DEMO_VOICE_TRANSCRIPT } from './marketing-story-demo-data';

	type Props = {
		text?: string;
		/** Overall story scroll progress 0–1 — triggers simulated capture when leaving this beat. */
		storyProgress?: number;
		onCapture?: () => void;
	};

	let { text = $bindable(DEMO_CAPTURE_TEXT), storyProgress = 0, onCapture }: Props = $props();

	let recording = $state(false);
	let transcribing = $state(false);
	let level = $state(0);
	let captureFlashing = $state(false);
	let scrollCaptureTriggered = $state(false);

	let levelFrameId: number | null = null;
	let levelSmooth = 0;
	let transcriptTimer: ReturnType<typeof setInterval> | undefined;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	const pulseSize = $derived(Math.round(10 + level * 90));

	function stopLevelMeter() {
		if (levelFrameId !== null) {
			cancelAnimationFrame(levelFrameId);
			levelFrameId = null;
		}
		level = 0;
		levelSmooth = 0;
	}

	function startLevelMeter() {
		stopLevelMeter();
		const tick = () => {
			const instant = 0.15 + Math.random() * 0.55;
			const smooth = instant > levelSmooth ? 0.22 : 0.08;
			levelSmooth += (instant - levelSmooth) * smooth;
			level = levelSmooth;
			levelFrameId = requestAnimationFrame(tick);
		};
		levelFrameId = requestAnimationFrame(tick);
	}

	function clearTranscriptTimer() {
		if (transcriptTimer) {
			clearInterval(transcriptTimer);
			transcriptTimer = undefined;
		}
	}

	function simulateLiveTranscription() {
		clearTranscriptTimer();
		text = '';
		const words = DEMO_VOICE_TRANSCRIPT.split(' ');
		let index = 0;
		transcriptTimer = setInterval(() => {
			if (index >= words.length) {
				clearTranscriptTimer();
				transcribing = false;
				recording = false;
				stopLevelMeter();
				return;
			}
			text = text ? `${text} ${words[index]}` : words[index]!;
			index += 1;
		}, 180);
	}

	function handleMicClick() {
		if (transcribing) return;
		if (recording) {
			clearTranscriptTimer();
			recording = false;
			stopLevelMeter();
			return;
		}
		recording = true;
		transcribing = true;
		text = '';
		startLevelMeter();
		simulateLiveTranscription();
	}

	function flashCaptureButton(onDone?: () => void) {
		if (flashTimer) clearTimeout(flashTimer);
		captureFlashing = true;
		flashTimer = setTimeout(() => {
			captureFlashing = false;
			onDone?.();
		}, 420);
	}

	function handleCapture() {
		if (!text.trim() || captureFlashing) return;
		flashCaptureButton(() => onCapture?.());
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			handleCapture();
		}
	}

	$effect(() => {
		if (storyProgress >= 0.185 && !scrollCaptureTriggered && text.trim()) {
			scrollCaptureTriggered = true;
			flashCaptureButton();
		}
	});

	onMount(() => () => {
		stopLevelMeter();
		clearTranscriptTimer();
		if (flashTimer) clearTimeout(flashTimer);
	});
</script>

<style>
	@keyframes recording-stop-flash {
		0%,
		100% {
			background-color: var(--foreground);
		}
		50% {
			background-color: var(--destructive);
		}
	}

	.voice-recording-stop {
		animation: recording-stop-flash 2.2s ease-in-out infinite;
	}
</style>

<div class="mx-auto w-full max-w-xl">
	<Card.Root
		class="items-start gap-[6px] overflow-visible border-2 border-black bg-white p-[2px] shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none"
	>
		<Card.Content class="w-full p-0">
			<Label for="marketing-story-thought" class="sr-only">Thought</Label>
			<Textarea
				id="marketing-story-thought"
				bind:value={text}
				placeholder="Enter your thought…"
				onkeydown={handleKeydown}
				class="min-h-[112px] resize-none border-0 bg-transparent p-6 text-base text-foreground shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent"
			/>
		</Card.Content>
		<Card.Footer
			class="flex w-full flex-col gap-2 border-t-2 border-black bg-[#FAFAFA] p-4 dark:border-border dark:bg-muted sm:flex-row sm:items-center sm:justify-between"
		>
			<span class="text-xs leading-4 text-[#737373]">⌘ / Ctrl + Enter to capture</span>
			<div class="flex items-center gap-2 self-end sm:self-auto">
				<Button
					type="button"
					variant="outline"
					size="icon"
					class="relative overflow-hidden rounded-none border-black dark:border-border"
					disabled={transcribing && !recording}
					onclick={handleMicClick}
					aria-label={recording ? 'Stop voice preview' : transcribing ? 'Transcribing preview' : 'Start voice preview'}
					aria-pressed={recording}
					role={recording ? 'meter' : undefined}
					aria-valuenow={recording ? pulseSize : undefined}
					aria-valuemin={recording ? 0 : undefined}
					aria-valuemax={recording ? 100 : undefined}
				>
					{#if recording}
						<div
							class="pointer-events-none absolute right-0 bottom-0 left-0 z-0 bg-primary/30 transition-[height] duration-100 ease-out"
							style="height: {pulseSize}%"
							aria-hidden="true"
						></div>
					{/if}
					<span class="relative z-10 inline-flex items-center justify-center">
						{#if transcribing && !recording}
							<Mic class="size-4 shrink-0 opacity-40" strokeWidth={1.75} />
						{:else if recording}
							<span
								class="voice-recording-stop inline-block size-3 shrink-0 rounded-[2px]"
								aria-hidden="true"
							></span>
						{:else}
							<Mic class="size-4 shrink-0" strokeWidth={1.75} />
						{/if}
					</span>
				</Button>
				<Button
					type="button"
					class="h-auto rounded-none border-0 px-[22px] py-[7.5px] text-base leading-6 font-medium text-white transition-colors duration-200 {captureFlashing
						? 'bg-[#28F97F] text-black hover:bg-[#28F97F]'
						: 'bg-black hover:bg-black/90'}"
					disabled={!text.trim() || captureFlashing}
					onclick={handleCapture}
				>
					Capture
				</Button>
			</div>
		</Card.Footer>
	</Card.Root>
</div>
