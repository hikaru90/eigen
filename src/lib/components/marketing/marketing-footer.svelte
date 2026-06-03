<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import {
		MARKETING_APP_PATH,
		MARKETING_LOGGED_IN_CTA,
		MARKETING_PRIMARY_CTA,
		signupHref
	} from '$lib/components/marketing/marketing-cta';
	import { scrollToSectionId } from '$lib/components/marketing/scroll-to-element';

	const navLinks = [
		{ label: 'How it works', target: 'topTarget' },
		{ label: 'Why Eigenmesh', target: 'whySectionTarget' },
		{ label: 'Transparency', target: 'transparencySectionTarget' },
		{ label: 'Pricing', target: 'pricingSectionTarget' },
		{ label: 'FAQ', target: 'faqSectionTarget' }
	];

	const legalLinks = [
		{ label: 'Privacy', href: '/privacy' },
		{ label: 'Terms', href: '/terms' },
		{ label: 'Imprint', href: '/imprint' },
		{ label: 'Docs', href: '/developers' }
	];

	const signupCtaHref = resolve(signupHref() as Pathname);
	const appCtaHref = resolve(MARKETING_APP_PATH as Pathname);
	const primaryCtaHref = $derived(page.data.user ? appCtaHref : signupCtaHref);
	const primaryCtaLabel = $derived(page.data.user ? MARKETING_LOGGED_IN_CTA : MARKETING_PRIMARY_CTA);

	function navigateToSection(target: string) {
		if (page.url.pathname === '/') {
			scrollToSectionId(target);
		} else {
			void goto(resolve(`/#${target}` as Pathname));
		}
	}
</script>

<div class="marketing-on-dark border-t-2 border-white/20 bg-black py-12 text-white">
	<div class="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 text-center">
		<p class="text-sm font-medium">{MARKETING_PRIMARY_CTA}</p>
		<div class="flex flex-wrap justify-center gap-3">
			<MarketingButton
				href={primaryCtaHref}
				variant="secondary"
				surface="dark"
				size="lg"
				class="rounded-[6px]"
			>
				{primaryCtaLabel}
			</MarketingButton>
			<MarketingButton
				href={resolve('/developers' as Pathname)}
				variant="outline"
				surface="dark"
				size="lg"
				class="rounded-[6px]"
			>
				Read the docs
			</MarketingButton>
		</div>
	</div>
</div>

<footer class="bg-foreground text-background">
	<div class="mx-auto w-full max-w-6xl px-4 py-16">
		<div class="grid grid-cols-1 gap-12 lg:grid-cols-4 lg:gap-8">
			<div class="lg:col-span-2">
				<div class="mb-6">
					<EigenWordmark tone="light" inverted heightClass="h-9" />
				</div>
				<p class="max-w-md text-sm opacity-80">
					Eigen Mesh keeps your context alive across tools and sessions — without surrendering it to
					hyperscalers. Self-hostable, portable, and priced per call with full markup transparency.
				</p>
			</div>

			<div>
				<h3 class="mb-4 text-sm font-semibold">Navigation</h3>
				<ul class="space-y-2 text-sm opacity-80">
					{#each navLinks as link (link.target)}
						<li>
							<button
								type="button"
								class="text-left transition-opacity hover:opacity-100"
								onclick={() => navigateToSection(link.target)}
							>
								{link.label}
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<div>
				<h3 class="mb-4 text-sm font-semibold">Legal</h3>
				<ul class="space-y-2 text-sm opacity-80">
					{#each legalLinks as link (link.href)}
						<li>
							<a href={resolve(link.href as Pathname)} class="transition-opacity hover:opacity-100"
								>{link.label}</a
							>
						</li>
					{/each}
				</ul>
			</div>
		</div>

		<div class="mt-12 border-t border-background/20 pt-8">
			<p class="text-center text-xs opacity-60">
				© {new Date().getFullYear()} Eigen Mesh. All rights reserved.
			</p>
		</div>
	</div>
</footer>
