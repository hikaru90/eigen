<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import Wallet from '@lucide/svelte/icons/wallet';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import UserRound from '@lucide/svelte/icons/user-round';

	const features = [
		{
			icon: Wallet,
			title: 'No opaque subscription wall',
			description:
				'Pay per call with base cost and markup visible—so infrastructure spend stays understandable.'
		},
		{
			icon: LockOpen,
			title: 'Vectors stay in your database',
			description:
				'Embeddings power retrieval internally; they never leak into tool results or LLM prompts.'
		},
		{
			icon: UserRound,
			title: 'Your memory, your tenant boundary',
			description:
				'Row-level security and explicit user scoping keep personal memory isolated from everyone else.'
		}
	];
</script>

<section class="relative mb-20 overflow-visible md:mb-32">
	<div
		use:marketingReveal
		class="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[min(120vw,900px)] -translate-x-1/2 -translate-y-1/2 scale-75 opacity-0 transition-all duration-700 is-visible:scale-100 is-visible:opacity-20"
		style="background: radial-gradient(circle, rgb(17 17 17 / 8%) 0%, transparent 65%)"
	></div>

	<h2
		use:marketingReveal
		class="text-foreground mb-10 max-w-xl text-2xl font-semibold tracking-tight transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 sm:text-3xl md:mx-auto md:text-center"
	>
		Memory infrastructure you control
	</h2>

	<div class="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-10">
		<p class="text-muted-foreground z-10 max-w-md text-sm leading-relaxed">
			Capture thoughts, enrich them in the background, and expose them through MCP tools your assistant can
			call—on PostgreSQL, pgvector, and Apache AGE you can self-host.
		</p>

		<div class="flex flex-col gap-4">
			{#each features as feature, index (feature.title)}
				<div
					use:marketingReveal
					class="border-2 border-black bg-card p-5 shadow-[5px_5px_0px_0px_#000] transition-all duration-700 dark:border-border dark:shadow-none is-visible:opacity-100 opacity-0 {index %
						2 ===
					0
						? 'md:-translate-x-2'
						: 'md:translate-x-2'}"
					style="transition-delay: {(index + 1) * 100}ms"
				>
					<div class="mb-2 flex items-center gap-2">
						<feature.icon class="size-4" strokeWidth={1.9} />
						<h3 class="text-foreground text-sm font-semibold">{feature.title}</h3>
					</div>
					<p class="text-muted-foreground text-xs leading-relaxed">{feature.description}</p>
				</div>
			{/each}
		</div>
	</div>

</section>
