<script lang="ts">
	import Database from '@lucide/svelte/icons/database';
	import Shield from '@lucide/svelte/icons/shield';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Plug from '@lucide/svelte/icons/plug';
	import { marketingReveal } from '$lib/actions/marketing-reveal';

	const usps = [
		{
			icon: Database,
			title: 'Your data, your stack',
			description: 'PostgreSQL + pgvector + Apache AGE. Export or migrate anytime.'
		},
		{
			icon: Shield,
			title: 'Private by design',
			description: 'Tenant-isolated with row-level security. Vectors never leave the DB.'
		},
		{
			icon: Receipt,
			title: 'Transparent cost',
			description: 'Per-call pricing with markup shown. No opaque subscription.'
		},
		{
			icon: Plug,
			title: 'Agent-native',
			description: 'MCP tools your assistant calls directly — no custom integration work.'
		}
	];
</script>

<section class="mb-20 md:mb-32">
	<div class="mb-8 flex flex-col gap-2 md:items-center md:text-center">
		<p class="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.1em]">
			Why Eigen Mesh
		</p>
		<h2 class="text-foreground text-[22px] font-medium tracking-tight">Built against lock-in</h2>
		<p class="text-muted-foreground mx-auto max-w-xl text-[15px] leading-relaxed">
			Most AI memory lives inside a vendor's walled garden. Mesh doesn't.
		</p>
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		{#each usps as usp, index (usp.title)}
			<div
				use:marketingReveal
				class="bg-secondary rounded-lg p-4 transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0"
				style="transition-delay: {(index + 1) * 120}ms"
			>
				<usp.icon class="mb-2.5 size-[18px] text-[#1D9E75]" strokeWidth={1.9} aria-hidden="true" />
				<h3 class="text-foreground mb-1 text-sm font-medium">{usp.title}</h3>
				<p class="text-muted-foreground text-[13px] leading-snug">{usp.description}</p>
			</div>
		{/each}
	</div>
</section>
