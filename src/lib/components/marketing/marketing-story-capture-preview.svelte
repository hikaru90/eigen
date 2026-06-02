<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import Mic from '@lucide/svelte/icons/mic';
	import { DEMO_CAPTURE_TEXT } from './marketing-story-demo-data';

	type Props = {
		text?: string;
		onCapture?: () => void;
	};

	let { text = $bindable(DEMO_CAPTURE_TEXT), onCapture }: Props = $props();

	let voiceHint = $state<string | null>(null);
	let voiceHintTimer: ReturnType<typeof setTimeout> | undefined;

	function showVoiceHint(message: string) {
		voiceHint = message;
		if (voiceHintTimer) clearTimeout(voiceHintTimer);
		voiceHintTimer = setTimeout(() => {
			voiceHint = null;
		}, 3200);
	}

	function handleMicClick() {
		showVoiceHint('Voice capture is available in the app — this preview does not use your microphone.');
	}

	function handleCapture() {
		if (!text.trim()) return;
		onCapture?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			handleCapture();
		}
	}

	onMount(() => () => {
		if (voiceHintTimer) clearTimeout(voiceHintTimer);
	});
</script>

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
					class="rounded-none border-black dark:border-border"
					onclick={handleMicClick}
					aria-label="Voice input preview"
				>
					<Mic class="size-4 shrink-0" strokeWidth={1.75} />
				</Button>
				<Button
					type="button"
					class="h-auto rounded-none border-0 bg-black px-[22px] py-[7.5px] text-base leading-6 font-medium text-white hover:bg-black/90"
					disabled={!text.trim()}
					onclick={handleCapture}
				>
					Capture
				</Button>
			</div>
		</Card.Footer>
	</Card.Root>
	{#if voiceHint}
		<p class="mt-2 text-center text-xs text-muted-foreground" role="status">{voiceHint}</p>
	{/if}
</div>
