<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import DeveloperDocsHeader from '$lib/components/docs/developer-docs-header.svelte';
	import { developerDocsHeaderOffsetClass } from '$lib/docs/developer-docs-layout';
	import { developerDocSections } from '$lib/docs/developer-nav';

	let { children }: { children: Snippet } = $props();

	const activeSlug = $derived(page.params.slug ?? '');
</script>

<!--
  Docs header is absolute within this shell; sidebar stays put, only <main> scrolls.
-->
<div class="relative flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col overflow-hidden">
	<DeveloperDocsHeader />

	<div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4">
		<div class="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-12">
			<aside class="shrink-0 pt-6 {developerDocsHeaderOffsetClass} lg:w-56">
				<nav aria-label="Developer documentation">
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

			<main class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
				<div class="{developerDocsHeaderOffsetClass} pb-8">
					{@render children()}
				</div>
			</main>
		</div>
	</div>
</div>
