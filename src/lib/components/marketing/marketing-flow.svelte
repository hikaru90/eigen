<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';

	const steps = [
		{
			num: '01 · Capture',
			title: 'Raw thought in',
			description:
				'No tagging required. Meeting notes, fragments, observations — just submit.',
			accent: 'bg-background'
		},
		{
			num: '02 · Connect',
			title: 'Entities linked',
			description: 'Graph edges preserve relationships as your memory grows over time.',
			accent: 'bg-secondary'
		},
		{
			num: '03 · Retrieve',
			title: 'Right context returned',
			description: 'Semantic + lexical search via MCP — your assistant calls it directly.',
			accent: 'bg-muted'
		}
	];
</script>

<section class="mb-20 md:mb-32">
	<p
		use:marketingReveal
		class="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-[0.1em] transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0 md:text-center"
	>
		How it works
	</p>
	<h2
		use:marketingReveal
		class="text-foreground mb-2 text-[22px] font-medium tracking-tight transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 md:text-center"
	>
		Three steps, zero manual filing
	</h2>
	<p
		use:marketingReveal
		class="text-muted-foreground mx-auto mb-8 max-w-2xl text-center text-[15px] leading-relaxed transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0"
	>
		Drop in a thought. Mesh enriches it in the background and surfaces it when your assistant needs
		it.
	</p>

	<div class="grid gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-3">
		{#each steps as step, index (step.num)}
			<div
				use:marketingReveal
				class="border-2 border-black {step.accent} p-5 shadow-none transition-all duration-700 dark:border-border is-visible:translate-y-0 is-visible:opacity-100 translate-y-10 opacity-0 sm:border-0"
				style="transition-delay: {(index + 1) * 120}ms"
			>
				<p class="text-muted-foreground mb-2 text-[11px] font-medium">{step.num}</p>
				<h3 class="text-foreground mb-1 text-[15px] font-medium">{step.title}</h3>
				<p class="text-muted-foreground text-[13px] leading-snug">{step.description}</p>
			</div>
		{/each}
	</div>
</section>
