<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';

	const legalLinks = [
		{ label: 'Privacy', href: '/privacy' },
		{ label: 'Terms', href: '/terms' },
		{ label: 'Imprint', href: '/imprint' }
	] as const;

	const year = new Date().getFullYear();
</script>

<footer class="mt-12 border-t-2 border-black/10 px-2 pt-6 pb-4">
	<nav aria-label="Legal">
		<ul class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
			{#each legalLinks as link (link.href)}
				<li>
					<a
						href={resolve(link.href as Pathname)}
						class="text-foreground/70 hover:text-foreground cursor-pointer underline-offset-2 transition-colors hover:underline"
					>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
	<p class="text-foreground/50 mt-3 text-xs">© {year} Eigen Mesh</p>
</footer>
