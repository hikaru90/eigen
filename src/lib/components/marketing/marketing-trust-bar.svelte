<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import Server from '@lucide/svelte/icons/server';
	import ShieldLock from '@lucide/svelte/icons/shield';
	import Eye from '@lucide/svelte/icons/eye';
	import LockOpen from '@lucide/svelte/icons/lock-open';

	const signals = [
		{ icon: Server, label: 'Self-hostable' },
		{ icon: ShieldLock, label: 'Row-level isolation' },
		{ icon: Eye, label: 'Markup shown on every call' },
		{ icon: LockOpen, label: 'No subscription lock' }
	];
</script>

<section class="mb-12 border-y border-border/60 md:mb-16">
	<div
		use:marketingReveal
		class="flex flex-wrap items-center justify-center gap-6 py-5 transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0"
	>
		{#each signals as signal (signal.label)}
			<span class="text-muted-foreground flex items-center gap-1.5 text-xs">
				<signal.icon class="size-3.5 text-[#1D9E75]" strokeWidth={1.75} aria-hidden="true" />
				{signal.label}
			</span>
		{/each}
	</div>
</section>
