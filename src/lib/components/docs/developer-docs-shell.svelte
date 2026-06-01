<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import MarketingFooter from '$lib/components/marketing/marketing-footer.svelte';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import { developerDocSections } from '$lib/docs/developer-nav';

	let { children }: { children: Snippet } = $props();

	const activeSlug = $derived(page.params.slug ?? '');
</script>

<div class="min-h-screen bg-background">
	<header class="border-b-2 border-black bg-card dark:border-border">
		<div class="marketing-container flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between md:py-8">
			<div class="flex flex-col gap-3">
				<a
					href={resolve('/')}
					class="text-foreground inline-flex w-fit items-center gap-2 rounded-[6px] border-2 border-black bg-background px-3 py-1.5 text-xs font-medium shadow-[4px_4px_0px_0px_#000] transition-transform hover:translate-y-px dark:border-border dark:shadow-none"
				>
					<ArrowLeft class="size-3.5" strokeWidth={1.75} />
					Back to home
				</a>
				<EigenWordmark heightClass="h-8" />
				<p class="text-muted-foreground max-w-xl text-sm">Documentation for self-hosting and integration.</p>
			</div>
		</div>
	</header>

	<div class="marketing-container py-8 pb-20">
		<div class="flex flex-col gap-8 lg:flex-row lg:gap-12">
			<aside class="lg:w-56 lg:shrink-0">
				<nav
					class="rounded-md border-2 border-black bg-card p-4 shadow-[4px_4px_0px_0px_#000] dark:border-border dark:shadow-none lg:sticky lg:top-6"
					aria-label="Developer documentation"
				>
					{#each developerDocSections as section (section.title)}
						<div class="mb-4 last:mb-0">
							<p class="text-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
								{section.title}
							</p>
							<ul class="space-y-1">
								{#each section.items as item (item.slug)}
									<li>
										<a
											href={resolve(`/developers/${item.slug}` as Pathname)}
											class="block rounded-[4px] px-2 py-1.5 text-sm transition-colors {activeSlug ===
											item.slug
												? 'bg-foreground text-background font-medium'
												: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
											aria-current={activeSlug === item.slug ? 'page' : undefined}
										>
											{item.label}
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</nav>
			</aside>

			<main class="min-w-0 flex-1">
				{@render children()}
			</main>
		</div>
	</div>

	<MarketingFooter />
</div>
