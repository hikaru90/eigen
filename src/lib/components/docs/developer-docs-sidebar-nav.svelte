<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { developerDocSections } from '$lib/docs/developer-nav';

	let {
		activeSlug,
		onNavigate
	}: {
		activeSlug: string;
		/** Called after choosing a link (e.g. close mobile menu). */
		onNavigate?: () => void;
	} = $props();
</script>

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
							class="block cursor-pointer rounded-[4px] px-2 py-1.5 text-sm transition-colors {activeSlug ===
							item.slug
								? 'bg-foreground text-background font-medium'
								: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
							aria-current={activeSlug === item.slug ? 'page' : undefined}
							onclick={() => onNavigate?.()}
						>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</nav>
