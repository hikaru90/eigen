<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import MarketingNav from '$lib/components/marketing/marketing-nav.svelte';
	import {
		developerDocsHeaderOffsetClass,
		developerDocsMainColumnClass,
		developerDocsMainContentInsetClass,
		developerDocsSidebarMaxHeightClass,
		developerDocsSidebarPositionClass
	} from '$lib/docs/developer-docs-layout';
	import DeveloperDocsCommandSearch from '$lib/components/docs/developer-docs-command-search.svelte';
	import DeveloperDocsFooter from '$lib/components/docs/developer-docs-footer.svelte';
	import DeveloperDocsSidebarNav from '$lib/components/docs/developer-docs-sidebar-nav.svelte';

	let { children }: { children: Snippet } = $props();

	const activeSlug = $derived(page.params.slug ?? '');
	let docsSearchOpen = $state(false);
</script>

<div class="marketing-light-theme min-h-screen bg-[#e8ede5]">
	<MarketingNav context="docs" bind:docsSearchOpen />
	<DeveloperDocsCommandSearch bind:open={docsSearchOpen} />

	<aside
		class="hidden md:fixed md:z-10 md:block md:w-56 md:overflow-y-auto md:overscroll-contain {developerDocsSidebarPositionClass} {developerDocsSidebarMaxHeightClass}"
	>
		<DeveloperDocsSidebarNav {activeSlug} />
	</aside>

	<div class="pb-8 {developerDocsMainColumnClass} {developerDocsHeaderOffsetClass}">
		<main class="min-w-0 {developerDocsMainContentInsetClass}">
			{@render children()}
			<DeveloperDocsFooter />
		</main>
	</div>
</div>
