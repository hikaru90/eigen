<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingUsageLogPreview from '$lib/components/marketing/marketing-usage-log-preview.svelte';
</script>

<section class="relative mb-20 md:mb-32">
	<p
		use:marketingReveal
		class="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-[0.1em] transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0 md:text-center"
	>
		Transparency
	</p>
	<h2
		use:marketingReveal
		class="text-foreground mb-2 text-2xl font-semibold tracking-tight transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 sm:text-3xl md:text-center"
	>
		You see every cost, every call
	</h2>
	<p
		use:marketingReveal
		class="text-muted-foreground mx-auto mb-8 max-w-xl text-center text-[15px] leading-relaxed transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0"
	>
		A live usage log — nothing hidden, markup included.
	</p>

	<div class="mx-auto max-w-lg">
		<MarketingUsageLogPreview />
	</div>
</section>
