<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import {
		evidenceHitsFromAnswerQuestionPayload,
		type ToolResultMemoryHit
	} from '$lib/chat/chat-stream-types';
	import { DEMO_ANSWER_QUESTION_PREVIEW } from './marketing-story-demo-data';

	type Props = {
		/** 0–1 progress during the search beat's fully-visible hold band. */
		beatProgress?: number;
	};

	let { beatProgress = 0 }: Props = $props();

	const hits: ToolResultMemoryHit[] = evidenceHitsFromAnswerQuestionPayload(
		DEMO_ANSWER_QUESTION_PREVIEW
	);

	/**
	 * Scroll phases within the hold band — strictly sequential with readable pauses.
	 * Parent fade handles entrance/exit; this timeline only runs at opacity 1.
	 */
	const SEARCHING_END = 0.22;
	const RETRIEVED_HOLD = 0.12;
	const HIT_REVEAL_DURATION = 0.07;
	const HIT_GAP = 0.1;

	const searchComplete = $derived(beatProgress >= SEARCHING_END);

	function hitStart(index: number) {
		return SEARCHING_END + RETRIEVED_HOLD + index * (HIT_REVEAL_DURATION + HIT_GAP);
	}

	function hitPopT(index: number) {
		const start = hitStart(index);
		return Math.min(1, Math.max(0, (beatProgress - start) / HIT_REVEAL_DURATION));
	}

	function popStyle(t: number) {
		const eased = t * t * (3 - 2 * t);
		return `opacity: ${eased}; transform: translateY(${(1 - eased) * 12}px) scale(${0.96 + eased * 0.04});`;
	}

	function hitStyle(index: number) {
		const t = hitPopT(index);
		if (!searchComplete || t <= 0.001) return 'opacity: 0;';
		return popStyle(t);
	}
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-8">
	<div class="flex items-center gap-2.5 text-sm text-muted-foreground" role="status">
		{#if searchComplete}
			<div class="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted">
				<CheckIcon class="size-2.5 text-[#28F97F]" aria-hidden="true" />
			</div>
		{:else}
			<LoaderCircleIcon class="size-4 shrink-0 animate-spin text-[#28F97F]" aria-hidden="true" />
		{/if}
		<span class="font-medium text-foreground">
			{searchComplete ? 'Memories retrieved' : 'Searching your memories…'}
		</span>
	</div>

	{#if hits.length > 0}
		<ul class="m-0 flex list-none flex-col gap-3 p-0" aria-hidden={!searchComplete}>
			{#each hits as hit, index (hit.id ?? hit.text)}
				{@const t = hitPopT(index)}
				{@const revealed = searchComplete && t > 0.001}
				<li
					class="flex flex-col gap-1 rounded-md border-2 border-black bg-[#FAFAFA] px-3 py-2.5 shadow-[4px_4px_0px_0px_#000] will-change-transform dark:border-border dark:bg-muted dark:shadow-none"
					style={hitStyle(index)}
				>
					{#if hit.category}
						<span class="text-xs capitalize tracking-wide text-muted-foreground">
							{hit.category}
							{#if hit.id}
								<span
									class="ml-1.5 rounded bg-muted-foreground/15 px-1 font-mono text-[10px] normal-case"
									title={hit.id}
								>
									{hit.id}
								</span>
							{/if}
						</span>
					{/if}
					<p class="min-w-0 text-sm leading-snug text-foreground">{hit.text}</p>
				</li>
			{/each}
		</ul>
	{/if}
</div>
