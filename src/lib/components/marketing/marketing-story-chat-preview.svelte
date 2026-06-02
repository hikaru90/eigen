<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import Mic from '@lucide/svelte/icons/mic';
	import { DEMO_CHAT_QUESTION } from './marketing-story-demo-data';

	type Props = {
		/** 0–1 progress within the chat question scroll beat. */
		beatProgress?: number;
	};

	let { beatProgress = 0 }: Props = $props();

	const sendFlashing = $derived(beatProgress >= 0.22 && beatProgress < 0.38);
</script>

<div class="mx-auto w-full max-w-2xl">
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
				class="h-auto rounded-none border-0 px-[22px] py-[12px] text-base leading-6 font-medium text-white transition-colors duration-200 {sendFlashing
					? 'bg-[#28F97F] text-black'
					: 'bg-black hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90'}"
				tabindex="-1"
				aria-hidden="true"
			>
				<SendHorizontal class="size-4 shrink-0" strokeWidth={1.75} />
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
