<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import MarketingFooter from '$lib/components/marketing/marketing-footer.svelte';
	import MarketingNav from '$lib/components/marketing/marketing-nav.svelte';

	let {
		title,
		description,
		children
	}: {
		title: string;
		description?: string;
		children: Snippet;
	} = $props();

	const showNav = false;
</script>

<div class="min-h-screen bg-background">
	{#if showNav}
		<MarketingNav />
	{/if}

	<header class="border-b-2 border-black bg-card dark:border-border">
		<div class="marketing-container py-12 md:py-16">
			<a
				href={resolve('/')}
				class="text-foreground mb-8 inline-flex items-center gap-2 rounded-[6px] border-2 border-black bg-background px-4 py-2 text-xs font-medium shadow-[4px_4px_0px_0px_#000] transition-transform hover:translate-y-px dark:border-border dark:shadow-none"
			>
				<ArrowLeft class="size-3.5" strokeWidth={1.75} />
				Back to home
			</a>
			<h1 class="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
			{#if description}
				<p class="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed">{description}</p>
			{/if}
		</div>
	</header>

	<main class="marketing-container py-10 pb-20">
		<div class="prose prose-sm max-w-none text-foreground">
			{@render children()}
		</div>
	</main>

	<MarketingFooter />
</div>
