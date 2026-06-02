<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import ChatMarkdown from '$lib/components/chat-markdown.svelte';
	import { parseFinalAnswerText } from '$lib/chat/chat-stream-types';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Mic from '@lucide/svelte/icons/mic';
	import TemporalEventsListView from '../../../routes/graph/TemporalEventsListView.svelte';
	import {
		DEMO_ANSWER_QUESTION_PREVIEW,
		DEMO_CAPTURE_TEXT,
		DEMO_CHAT_QUESTION,
		DEMO_TEMPORAL_EVENTS
	} from './marketing-story-demo-data';

	type Props = {
		/** 0–1 progress within the retrieval scroll beat. */
		beatProgress?: number;
		captureText?: string;
	};

	let { beatProgress = 0, captureText = DEMO_CAPTURE_TEXT }: Props = $props();

	const temporalItems = $derived(
		DEMO_TEMPORAL_EVENTS.map((item) => ({ ...item, thoughtText: captureText }))
	);

	const answerText = parseFinalAnswerText('', DEMO_ANSWER_QUESTION_PREVIEW);
	const showSearching = $derived(beatProgress >= 0.1 && beatProgress < 0.38);
	const showAnswer = $derived(beatProgress >= 0.38);
	const showTemporal = $derived(beatProgress >= 0.62);
	const temporalOpacity = $derived(Math.min(1, Math.max(0, (beatProgress - 0.62) / 0.18)));
	const visibleChars = $derived.by(() => {
		if (!showAnswer) return 0;
		const t = Math.min(1, Math.max(0, (beatProgress - 0.38) / 0.4));
		return Math.floor(answerText.length * t);
	});
	const displayedAnswer = $derived(answerText.slice(0, visibleChars));
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
	<Card.Root
		class="min-w-0 w-full items-start gap-[6px] overflow-visible border-2 border-black bg-white p-[2px] shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none"
	>
		<Card.Content class="w-full min-w-0 p-0">
			<Textarea
				readonly
				value={DEMO_CHAT_QUESTION}
				class="min-h-[72px] w-full min-w-0 resize-none border-0 bg-transparent p-4 text-base text-foreground shadow-none focus-visible:ring-0 md:text-base"
				tabindex="-1"
				aria-label="Question about your memories"
			/>
		</Card.Content>
		<Card.Footer
			class="flex w-full flex-row items-center justify-end gap-2 border-t-2 border-black bg-[#FAFAFA] p-4 dark:border-border dark:bg-muted"
		>
			<Button
				type="button"
				variant="outline"
				size="icon"
				class="rounded-none border-black dark:border-border"
				tabindex="-1"
				aria-hidden="true"
			>
				<Mic class="size-4 shrink-0" strokeWidth={1.75} />
			</Button>
			<Button
				type="button"
				class="h-auto rounded-none border-0 bg-black px-[22px] py-[12px] text-base leading-6 font-medium text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
				tabindex="-1"
				aria-hidden="true"
			>
				<SendHorizontal class="size-4 shrink-0" strokeWidth={1.75} />
			</Button>
		</Card.Footer>
	</Card.Root>

	{#if showSearching}
		<div class="flex items-center gap-2 px-1 text-sm text-muted-foreground" role="status">
			<LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
			<span>Searching your memories…</span>
		</div>
	{/if}

	{#if showAnswer && displayedAnswer}
		<div class="min-h-[3rem] px-1" role="log" aria-label="Chat response">
			<div class="flex min-w-0 w-full flex-row items-start py-0.5">
				<div class="min-w-0 max-w-full rounded-md px-1 py-1 sm:max-w-[90%]">
					<ChatMarkdown content={displayedAnswer} />
				</div>
			</div>
		</div>
	{/if}

	{#if showTemporal}
		<Card.Root
			class="overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_0px_#000] dark:border-border dark:bg-card dark:shadow-none"
			style="opacity: {temporalOpacity}"
		>
			<Card.Header class="border-b border-border px-4 py-3">
				<Card.Title class="text-sm font-medium">Temporal events</Card.Title>
				<p class="text-xs text-muted-foreground">
					Dates and deadlines extracted from your captures — synced to the graph.
				</p>
			</Card.Header>
			<Card.Content class="p-0">
				<div class="max-h-[min(40vh,360px)] min-h-36 overflow-hidden">
					<TemporalEventsListView
						items={temporalItems}
						selectedItemId="te-2"
						onSelect={() => {}}
					/>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
