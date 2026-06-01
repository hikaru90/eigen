<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingHeroVisual from '$lib/components/marketing/marketing-hero-visual.svelte';
	import { scrollToSectionId } from '$lib/components/marketing/scroll-to-element';

	const developersHref = resolve('/developers' as Pathname);
</script>

<section class="grid min-h-[calc(100dvh-6rem)] items-center gap-10 pt-28 pb-16 lg:grid-cols-[1.05fr_0.95fr]">
	<div use:marketingReveal class="is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 transition-all duration-700">
		<div class="mb-6 lg:hidden">
			<EigenWordmark tone="light" heightClass="h-10" />
		</div>
		<p
			class="text-muted-foreground mb-6 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"
		>
			<span class="size-1.5 shrink-0 rounded-full bg-[#1D9E75]" aria-hidden="true"></span>
			Self-hostable · open stack · your data
		</p>
		<h1
			class="text-foreground max-w-2xl text-4xl leading-[1.2] font-medium tracking-tight sm:text-5xl lg:text-[2.25rem]"
		>
			Your memory.
			<span class="block text-[#0F6E56]">Not theirs.</span>
		</h1>
		<p class="text-muted-foreground mt-4 max-w-xl text-base leading-relaxed">
			Eigen Mesh keeps your context alive across tools and sessions — without surrendering it to
			hyperscalers. Self-hostable, portable, and priced per call with full markup transparency.
		</p>
		<div class="mt-8 flex flex-wrap gap-2.5">
			<MarketingButton
				type="button"
				size="lg"
				class="rounded-[6px] px-5"
				onclick={() => scrollToSectionId('newsletterSectionTarget')}
			>
				Get early access
			</MarketingButton>
			<MarketingButton href={developersHref} variant="outline" size="lg" class="rounded-[6px] px-5">
				Read the docs
			</MarketingButton>
		</div>
	</div>

	<MarketingHeroVisual />
</section>
