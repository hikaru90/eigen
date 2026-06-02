<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import MarketingNav from '$lib/components/marketing/marketing-nav.svelte';
	import MarketingProductStory from '$lib/components/marketing/marketing-product-story.svelte';
	import MarketingTrustBar from '$lib/components/marketing/marketing-trust-bar.svelte';
	import MarketingUsps from '$lib/components/marketing/marketing-usps.svelte';
	import MarketingTransparency from '$lib/components/marketing/marketing-transparency.svelte';
	import MarketingAbout from '$lib/components/marketing/marketing-about.svelte';
	import MarketingNewsletter from '$lib/components/marketing/marketing-newsletter.svelte';
	import MarketingFaq from '$lib/components/marketing/marketing-faq.svelte';
	import MarketingContact from '$lib/components/marketing/marketing-contact.svelte';
	import MarketingFooter from '$lib/components/marketing/marketing-footer.svelte';
	import {
		marketingBackgroundClass,
		marketingSectionId,
		marketingSectionTargets
	} from '$lib/components/marketing/marketing-scroll';
	import { scrollToSectionId } from '$lib/components/marketing/scroll-to-element';

	let scrollOffset = $state(0);

	const scrollCircles = [
		{ size: 560, x: '-14%', y: 120, speed: 0.16, opacity: 0.22 },
		{ size: 680, x: '72%', y: 420, speed: 0.24, opacity: 0.2 },
		{ size: 500, x: '24%', y: 760, speed: 0.14, opacity: 0.16 }
	];

	function updateSectionBackground() {
		if (!browser) return;
		scrollOffset = window.scrollY;

		// Match fixed nav height + scroll-to offset in scroll-to-element.ts
		const scrollPos = window.scrollY + 96;
		let nextBg = marketingSectionTargets[0].bgClass;
		let nextSection = marketingSectionTargets[0].id;

		for (const target of marketingSectionTargets) {
			const el = document.getElementById(target.id);
			if (!el) continue;
			const top = el.getBoundingClientRect().top + window.scrollY;
			if (scrollPos >= top) {
				nextBg = target.bgClass;
				nextSection = target.id;
			}
		}

		marketingBackgroundClass.set(nextBg);
		marketingSectionId.set(nextSection);
	}

	onMount(() => {
		if (!browser) return;

		const hash = window.location.hash.replace('#', '');
		if (hash) {
			requestAnimationFrame(() => scrollToSectionId(hash));
		}

		updateSectionBackground();
		const onScroll = () => updateSectionBackground();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
		};
	});
</script>

<svelte:head>
	<title>Eigen Mesh — Your memory. Not theirs.</title>
	<meta
		name="description"
		content="Eigen Mesh keeps your context alive across tools and sessions — without surrendering it to hyperscalers. Self-hostable, portable, and priced per call with full markup transparency."
	/>
</svelte:head>

<div class="marketing-light-theme flex min-h-screen flex-col">
	<MarketingNav />

	<div class="{$marketingBackgroundClass} relative grow transition-colors duration-500">
		<div id="topTarget" class="pointer-events-none absolute top-0"></div>
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			{#each scrollCircles as circle}
				<div
					class="absolute rounded-full"
					style="
						width: {circle.size}px;
						height: {circle.size}px;
						left: {circle.x};
						top: {circle.y + scrollOffset * circle.speed}px;
						opacity: {circle.opacity};
						background: radial-gradient(circle, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0) 72%);
					"
				></div>
			{/each}
		</div>

		<div class="relative z-10">
			<MarketingProductStory />

			<div class="mx-auto w-full max-w-6xl px-4 pt-10 pb-8 md:pt-14">
				<div class="relative">
					<div id="whySectionTarget" class="pointer-events-none absolute -top-20"></div>
				</div>
				<MarketingTrustBar />
				<MarketingUsps />

				<div class="relative">
					<div id="transparencySectionTarget" class="pointer-events-none absolute -top-20"></div>
				</div>
				<MarketingTransparency />

				<div class="relative">
					<div id="pricingSectionTarget" class="pointer-events-none absolute -top-20"></div>
				</div>
				<MarketingNewsletter />

				<div class="relative">
					<div id="aboutSectionTarget" class="pointer-events-none absolute -top-20"></div>
				</div>
				<MarketingAbout />

				<div class="relative">
					<div id="faqSectionTarget" class="pointer-events-none absolute -top-20"></div>
				</div>
				<MarketingFaq />
			</div>
		</div>
	</div>

	<div id="contactSectionTarget" class="marketing-on-dark relative bg-black text-white">
		<MarketingContact />
	</div>

	<MarketingFooter />
</div>
