<script lang="ts">
	import ChatMarkdown from '$lib/components/chat-markdown.svelte';
	import { parseFinalAnswerText } from '$lib/chat/chat-stream-types';
	import { DEMO_ANSWER_QUESTION_PREVIEW } from './marketing-story-demo-data';

	type Props = {
		/** 0–1 progress during the answer beat's fully-visible hold band. */
		beatProgress?: number;
	};

	let { beatProgress = 0 }: Props = $props();

	const answerText = parseFinalAnswerText('', DEMO_ANSWER_QUESTION_PREVIEW);
	const answerPopT = $derived(Math.min(1, Math.max(0, beatProgress / 0.05)));
	const visibleChars = $derived.by(() => {
		const t = Math.min(1, Math.max(0, (beatProgress - 0.05) / 0.22));
		return Math.floor(answerText.length * t);
	});
	const displayedAnswer = $derived(answerText.slice(0, visibleChars));
</script>

<div
	class="mx-auto w-full max-w-2xl px-1 will-change-transform"
	style="opacity: {answerPopT}; transform: translateY({(1 - answerPopT) * 10}px);"
	role="log"
	aria-label="Chat response"
>
	<div class="flex min-w-0 w-full flex-row items-start py-0.5">
		<div class="min-w-0 max-w-full rounded-md px-1 py-1 text-foreground sm:max-w-[90%]">
			<ChatMarkdown content={displayedAnswer} class="text-foreground" />
		</div>
	</div>
</div>
