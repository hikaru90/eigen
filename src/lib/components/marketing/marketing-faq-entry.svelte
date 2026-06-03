<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';

	type Faq = { question: string; answer: string };

	let { faq }: { faq: Faq } = $props();
	let open = $state(false);
</script>

<div class="border-2 border-black bg-white shadow-[4px_4px_0px_0px_#000]">
	<button
		type="button"
		class="flex w-full cursor-pointer items-center justify-between gap-4 p-4 text-left"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<h3 class="text-foreground text-sm font-semibold">{faq.question}</h3>
		<Plus
			class="size-4 shrink-0 text-[#1D9E75] transition-transform duration-300 {open ? 'rotate-45' : ''}"
			strokeWidth={1.75}
		/>
	</button>
	<div class="overflow-hidden transition-all duration-300 {open ? 'max-h-96' : 'max-h-0'}">
		<p class="text-muted-foreground border-t-2 border-black/10 px-4 pt-3 pb-4 text-[13px] leading-relaxed">
			{faq.answer}
		</p>
	</div>
</div>
