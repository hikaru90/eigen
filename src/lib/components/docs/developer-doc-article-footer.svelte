<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import type { DeveloperDocFooterLink } from '$lib/docs/doc-link-resolve';
	import { cn } from '$lib/utils';

	let {
		prev = null,
		next = null
	}: {
		prev?: DeveloperDocFooterLink | null;
		next?: DeveloperDocFooterLink | null;
	} = $props();

	function linkHref(link: DeveloperDocFooterLink): string {
		const path = `/developers/${link.slug}` as Pathname;
		return link.hash ? `${resolve(path)}#${link.hash}` : resolve(path);
	}

	const cardClass =
		'block max-w-[min(100%,18rem)] rounded-[6px] border-2 border-black bg-white px-3 py-2.5 text-left shadow-[2px_2px_0_0_#000] transition-colors hover:bg-[#f0f3f0]';
</script>

{#if prev || next}
	<footer class="doc-article-footer mt-10 border-t border-black/10 pt-6 dark:border-border">
		<div class="flex items-center justify-between gap-4">
			<div class="min-w-0 flex-1">
				{#if prev}
					<a href={linkHref(prev)} class={cn(cardClass)}>
						<span class="text-foreground/60 block text-[10px] font-semibold tracking-wide uppercase">
							Previous
						</span>
						<span class="text-foreground mt-0.5 block text-sm font-semibold leading-snug">
							{prev.label}
						</span>
					</a>
				{/if}
			</div>
			<div class="min-w-0 flex-1 flex justify-end">
				{#if next}
					<a href={linkHref(next)} class={cn(cardClass, 'text-right')}>
						<span class="text-foreground/60 block text-[10px] font-semibold tracking-wide uppercase">
							Next
						</span>
						<span class="text-foreground mt-0.5 block text-sm font-semibold leading-snug">
							{next.label}
						</span>
					</a>
				{/if}
			</div>
		</div>
	</footer>
{/if}
