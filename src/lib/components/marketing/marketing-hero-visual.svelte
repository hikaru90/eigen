<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import * as Card from '$lib/components/ui/card';
	import Network from '@lucide/svelte/icons/network';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Brain from '@lucide/svelte/icons/brain';
</script>

<div class="relative mx-auto w-full max-w-md" use:marketingReveal>
	<div
		class="pointer-events-none absolute -left-8 top-8 size-48 rounded-full opacity-30 blur-2xl transition-all duration-700 is-visible:opacity-40"
		style="background: radial-gradient(circle, rgb(17 17 17 / 12%) 0%, transparent 70%)"
	></div>

	<Card.Root
		class="relative z-10 border-2 border-black bg-card p-0 shadow-[8px_8px_0px_0px_#000] transition-all duration-700 dark:border-border dark:shadow-none is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0 -rotate-2"
	>
		<Card.Header class="border-b-2 border-black px-4 py-3 dark:border-border">
			<Card.Title class="text-sm">Capture</Card.Title>
			<Card.Description class="text-xs">Raw thought stored</Card.Description>
		</Card.Header>
		<Card.Content class="p-4 text-xs text-muted-foreground">
			Meeting notes → structured memory
		</Card.Content>
	</Card.Root>

	<Card.Root
		class="relative z-20 -mt-6 ml-8 border-2 border-black bg-card p-0 shadow-[6px_6px_0px_0px_#000] transition-all duration-700 delay-150 dark:border-border dark:shadow-none is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 rotate-1"
	>
		<Card.Header class="border-b-2 border-black px-4 py-3 dark:border-border">
			<Card.Title class="flex items-center gap-2 text-sm">
				<Network class="size-3.5" strokeWidth={1.75} />
				Connect
			</Card.Title>
		</Card.Header>
		<Card.Content class="flex gap-2 p-4">
			<span class="rounded border border-border px-2 py-0.5 text-[10px]">project-alpha</span>
			<span class="rounded border border-border px-2 py-0.5 text-[10px]">follow-up</span>
		</Card.Content>
	</Card.Root>

	<Card.Root
		class="animate-marketing-float relative z-30 -mt-5 mr-4 border-2 border-black bg-primary p-0 text-primary-foreground shadow-[6px_6px_0px_0px_#000] dark:border-border dark:shadow-none is-visible:opacity-100 opacity-0 transition-opacity duration-700 delay-300"
	>
		<Card.Content class="flex items-center gap-3 p-4">
			<Brain class="size-4 shrink-0" strokeWidth={1.75} />
			<div>
				<p class="text-xs font-semibold">Retrieve</p>
				<p class="text-[10px] opacity-80">Context returned on ask</p>
			</div>
			<RefreshCw class="ml-auto size-3.5 opacity-70" strokeWidth={1.75} />
		</Card.Content>
	</Card.Root>
</div>
