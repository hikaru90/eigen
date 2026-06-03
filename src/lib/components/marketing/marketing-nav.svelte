<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import {
		MARKETING_APP_PATH,
		MARKETING_LOGGED_IN_CTA,
		MARKETING_PRIMARY_CTA,
		signupHref
	} from '$lib/components/marketing/marketing-cta';
	import {
		marketingScrollY,
		marketingSectionId
	} from '$lib/components/marketing/marketing-scroll';
	import { scrollToSectionId } from '$lib/components/marketing/scroll-to-element';
	import DeveloperDocsSearchTrigger from '$lib/components/docs/developer-docs-search-trigger.svelte';
	import DeveloperDocsSidebarNav from '$lib/components/docs/developer-docs-sidebar-nav.svelte';

	const menuItems = [
		{ label: 'How it works', target: 'topTarget' },
		{ label: 'Why Eigenmesh', target: 'whySectionTarget' },
		{ label: 'Transparency', target: 'transparencySectionTarget' },
		{ label: 'Pricing', target: 'pricingSectionTarget' },
		{ label: 'FAQ', target: 'faqSectionTarget' }
	];

	let {
		context = 'home',
		docsSearchOpen = $bindable(false)
	}: {
		context?: 'home' | 'docs';
		docsSearchOpen?: boolean;
	} = $props();

	const homeHref = resolve('/' as Pathname);
	const developersHref = resolve('/developers' as Pathname);
	const signupCtaHref = resolve(signupHref() as Pathname);
	const appCtaHref = resolve(MARKETING_APP_PATH as Pathname);
	const primaryCtaHref = $derived(page.data.user ? appCtaHref : signupCtaHref);
	const primaryCtaLabel = $derived(page.data.user ? MARKETING_LOGGED_IN_CTA : MARKETING_PRIMARY_CTA);
	const isDocs = $derived(context === 'docs');
	const navOnDark = $derived(!isDocs && $marketingSectionId === 'contactSectionTarget');
	const mobileMenuGlassClass = $derived(
		navOnDark
			? 'border-white/20 bg-white/10 text-white'
			: 'border-white bg-white/50 text-foreground'
	);
	const activeDocSlug = $derived(page.params.slug ?? '');

	function closeMobileMenu() {
		mobileOpen = false;
		menuVisible = true;
	}

	let menuVisible = $state(true);
	let mobileOpen = $state(false);
	let lastScroll = 0;

	function scrollTo(target: string) {
		mobileOpen = false;
		scrollToSectionId(target);
		setTimeout(() => {
			menuVisible = true;
		}, 450);
	}

	onMount(() => {
		if (!browser) return;
		const onScroll = () => {
			const y = window.scrollY;
			marketingScrollY.set(y);
			if (window.innerWidth < 768) {
				menuVisible = y < lastScroll || y < 50;
			}
			lastScroll = y;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});
</script>

<div class="pointer-events-none fixed inset-x-0 top-0 z-100">
	<div
		class="pointer-events-auto mx-auto max-w-[1200px] overflow-hidden transition-all duration-300 ease-in-out {menuVisible
			? 'max-h-24 translate-y-0 px-4 pt-4 opacity-100'
			: 'max-h-0 -translate-y-2 px-4 pt-0 opacity-0 pointer-events-none'}"
	>
		<div
			class="overflow-hidden rounded-full border backdrop-blur-md px-6 py-1 {navOnDark
				? 'border-white/20 bg-white/10 text-white'
				: 'border-white bg-white/50'}"
		>
			<nav
				class="flex items-center justify-between gap-2 px-3 sm:gap-3 {isDocs ? 'py-1' : 'py-2.5'}"
			>
				{#if isDocs}
					<a href={homeHref} class="shrink-0 cursor-pointer outline-none" aria-label="Eigen home">
						<EigenWordmark tone="light" inverted={navOnDark} heightClass="h-5 mt-0.5 sm:h-7 sm:mt-0.5" />
					</a>
					<div class="flex min-w-0 flex-1 items-center justify-end gap-2">
						<DeveloperDocsSearchTrigger
							class="max-w-44 flex-1 sm:max-w-xs"
							onclick={() => {
								docsSearchOpen = true;
							}}
						/>
						<MarketingButton
							href={developersHref}
							variant="default"
							size="sm"
							surface={navOnDark ? 'dark' : 'light'}
							class="hidden shrink-0 rounded-[6px] md:inline-flex"
							aria-current="page"
						>
							Docs
						</MarketingButton>
						<MarketingButton
							href={primaryCtaHref}
							size="sm"
							surface={navOnDark ? 'dark' : 'light'}
							class="hidden shrink-0 rounded-[6px] md:inline-flex"
						>
							{primaryCtaLabel}
						</MarketingButton>
						<button
							type="button"
							class="cursor-pointer shrink-0 p-2 md:hidden {navOnDark ? 'text-white' : 'text-foreground'}"
							aria-label="Open menu"
							onclick={() => {
								menuVisible = false;
								mobileOpen = true;
							}}
						>
							<Menu class="size-5" strokeWidth={1.75} />
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="shrink-0 cursor-pointer outline-none"
						onclick={() => scrollTo('topTarget')}
					>
						<EigenWordmark tone="light" inverted={navOnDark} heightClass="h-5 mt-0.5 sm:h-7 sm:mt-0.5" />
					</button>

					<div class="hidden items-center gap-6 lg:ml-auto lg:flex">
						{#each menuItems as item (item.target)}
							<button
								type="button"
								class="cursor-pointer text-xs font-medium transition-colors hover:underline {navOnDark
									? 'text-white'
									: 'text-foreground'} {$marketingSectionId === item.target
									? 'underline underline-offset-4'
									: ''}"
								onclick={() => scrollTo(item.target)}
							>
								{item.label}
							</button>
						{/each}
					</div>

					<div class="ml-auto flex shrink-0 items-center gap-2">
						<MarketingButton
							href={developersHref}
							variant="outline"
							size="sm"
							surface={navOnDark ? 'dark' : 'light'}
							class="hidden rounded-[6px] lg:inline-flex"
						>
							Docs
						</MarketingButton>
						<MarketingButton
							href={primaryCtaHref}
							size="sm"
							surface={navOnDark ? 'dark' : 'light'}
							class="hidden rounded-[6px] lg:inline-flex"
						>
							{primaryCtaLabel}
						</MarketingButton>
						<button
							type="button"
							class="cursor-pointer p-2 lg:hidden {navOnDark ? 'text-white' : 'text-foreground'}"
							aria-label="Open menu"
							onclick={() => {
								menuVisible = false;
								mobileOpen = true;
							}}
						>
							<Menu class="size-5" strokeWidth={1.75} />
						</button>
					</div>
				{/if}
			</nav>
		</div>
	</div>
</div>

{#if mobileOpen}
	<div
		class="fixed inset-0 z-110 flex flex-col backdrop-blur-md transition-all duration-200 {mobileMenuGlassClass}"
		role="dialog"
		aria-modal="true"
		aria-label="Site menu"
	>
		<!-- Match header pill padding so the close icon sits on the hamburger -->
		<div class="mx-auto w-full max-w-[1200px] shrink-0 px-4 pt-4 pt-safe">
			<div class="flex justify-end px-6 py-1">
				<div class="flex items-center px-3 py-2.5">
					<button
						type="button"
						class="cursor-pointer p-2 {navOnDark ? 'text-white' : 'text-foreground'}"
						aria-label="Close menu"
						onclick={closeMobileMenu}
					>
						<X class="size-5" strokeWidth={1.75} />
					</button>
				</div>
			</div>
		</div>

		<div
			class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 {isDocs
				? 'pt-2'
				: 'justify-center'}"
		>
			{#if isDocs}
				<DeveloperDocsSidebarNav activeSlug={activeDocSlug} onNavigate={closeMobileMenu} />
			{:else}
				{#each menuItems as item, index (item.target)}
					<button
						type="button"
						class="cursor-pointer text-left text-lg font-medium transition-all duration-200 {mobileOpen
							? 'translate-y-0 opacity-100'
							: 'translate-y-6 opacity-0'}"
						style="transition-delay: {index * 80}ms"
						onclick={() => scrollTo(item.target)}
					>
						{item.label}
					</button>
				{/each}
			{/if}
			<div class="mt-6 flex shrink-0 flex-col gap-2">
				<MarketingButton
					href={developersHref}
					variant={isDocs ? 'default' : 'outline'}
					class="w-full rounded-[6px]"
					aria-current={isDocs ? 'page' : undefined}
					>Docs</MarketingButton
				>
				<MarketingButton href={primaryCtaHref} class="w-full rounded-[6px]">
					{primaryCtaLabel}
				</MarketingButton>
			</div>
		</div>
	</div>
{/if}
