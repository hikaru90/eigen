<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import MarketingNav from '$lib/components/marketing/marketing-nav.svelte';
	import MarketingHero from '$lib/components/marketing/marketing-hero.svelte';
	import MarketingTrustBar from '$lib/components/marketing/marketing-trust-bar.svelte';
	import MarketingFlow from '$lib/components/marketing/marketing-flow.svelte';
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

	function updateSectionBackground() {
		if (!browser) return;

		const viewportCenter = window.innerHeight / 2;
		let nextBg = marketingSectionTargets[0].bgClass;
		let nextSection = marketingSectionTargets[0].id;

		for (let i = marketingSectionTargets.length - 1; i >= 0; i--) {
			const target = marketingSectionTargets[i];
			const el = document.getElementById(target.id);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (rect.top <= viewportCenter) {
				nextBg = target.bgClass;
				nextSection = target.id;
				break;
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

		<div class="marketing-container relative z-10 pb-8">
			<MarketingHero />
			<MarketingTrustBar />

			<div class="relative">
				<div id="flowSectionTarget" class="pointer-events-none absolute -top-20"></div>
			</div>
			<MarketingFlow />

			<div class="relative">
				<div id="uspsSectionTarget" class="pointer-events-none absolute -top-20"></div>
			</div>
			<MarketingUsps />

			<div class="relative">
				<div id="transparencySectionTarget" class="pointer-events-none absolute -top-20"></div>
			</div>
			<MarketingTransparency />

			<div class="relative">
				<div id="newsletterSectionTarget" class="pointer-events-none absolute -top-20"></div>
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

	<div id="contactSectionTarget" class="marketing-on-dark relative bg-black text-white">
		<MarketingContact />
	</div>

	<MarketingFooter />
</div>
