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

<section class="mb-12 md:mb-16">
	<div
		use:marketingReveal
		class="flex flex-wrap items-center justify-center gap-3 py-2 transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0"
	>
		{#each signals as signal (signal.label)}
			<span
				class="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f0] px-3 py-1 text-[11px] font-medium tracking-tight text-foreground"
			>
				<signal.icon
					class="size-3.5 shrink-0 text-[#1D9E75]"
					strokeWidth={1.75}
					aria-hidden="true"
				/>
				{signal.label}
			</span>
		{/each}
	</div>
</section>
