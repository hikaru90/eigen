<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingFaqEntry from '$lib/components/marketing/marketing-faq-entry.svelte';

	const faqs = [
		{
			question: 'What is Eigen Mesh?',
			answer:
				'A personal memory service: you save thoughts in plain language, we organize them for you, and your assistant can find them when you ask.'
		},
		{
			question: 'Do I need to tag or sort my notes?',
			answer:
				'No. Write naturally when you capture something. Sorting, labels, and connections happen automatically after you save.'
		},
		{
			question: 'How does pricing work?',
			answer:
				'You pay only for what you use. Each action shows the real cost plus our small markup—no surprise subscription bill at the end of the month.'
		},
		{
			question: 'Can I keep my data on my own computer?',
			answer:
				'Yes. You can run Eigen Mesh yourself for full control, or use our hosted version if you prefer not to manage servers.'
		},
		{
			question: 'Is my private information sent to AI models?',
			answer:
				'Your raw notes stay in your database. We never paste hidden copies of your full memory into AI prompts—only the text needed to answer your question.'
		},
		{
			question: 'Can other people see my notes?',
			answer:
				'No. Your memories are kept separate from other users’ accounts, with strict access rules on the server.'
		}
	];
</script>

<section class="mb-20 md:mb-32">
	<h2
		use:marketingReveal
		class="text-foreground mb-8 text-2xl font-semibold tracking-tight transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 sm:text-3xl"
	>
		Common questions
	</h2>

	<div class="flex flex-col gap-2">
		{#each faqs as faq (faq.question)}
			<MarketingFaqEntry {faq} />
		{/each}
	</div>
</section>
