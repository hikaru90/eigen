<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import Network from '@lucide/svelte/icons/network';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Wallet from '@lucide/svelte/icons/wallet';

	const uspItems = [
		{
			icon: RefreshCw,
			title: 'Context switching',
			description: 'Move between projects and conversations without losing your place.'
		},
		{
			icon: LockOpen,
			title: 'No vendor lock-in',
			description: 'Keep control of your stack and data with portable, open infrastructure choices.'
		},
		{
			icon: UserRound,
			title: 'Personal use assistant',
			description: 'A private memory assistant for your own workflow, not a generic team dashboard.'
		},
		{
			icon: Wallet,
			title: 'Consumption-based pricing',
			description: 'No subscription wall. Pay for what you use, with transparent usage visibility.'
		}
	];

	const flow = [
		{
			label: 'Capture',
			description: 'Drop thoughts quickly, without manual formatting overhead.'
		},
		{
			label: 'Connect',
			description: 'Entity and graph context keeps related ideas linked over time.'
		},
		{
			label: 'Retrieve',
			description: 'Get the right context back when you ask your assistant.'
		}
	];
</script>

<div class="mx-auto w-full max-w-6xl px-6 pb-20">
	<section class="grid min-h-[calc(100dvh-9rem)] items-center gap-8 py-14 lg:grid-cols-[1.15fr_0.85fr]">
		<div>
			<div class="mb-7">
				<EigenWordmark heightClass="h-10" />
			</div>
			<p class="text-primary mb-4 text-xs font-semibold uppercase tracking-[0.14em]">
				Persistent memory for your workflow
			</p>
			<h1 class="text-foreground max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
				Eigen Mesh is your personal memory assistant across tools, sessions, and context shifts.
			</h1>
			<p class="text-muted-foreground mt-5 max-w-2xl text-sm leading-relaxed sm:text-base">
				Built to preserve continuity while you move fast. Capture once, stay grounded later, and keep your
				assistant aligned with how you work.
			</p>

			<div class="mt-8 flex flex-wrap gap-3">
				<Button href="/signup" size="lg" class="rounded-[6px] px-7">Create account</Button>
				<Button href="/login" variant="outline" size="lg" class="rounded-[6px] px-7">Log in</Button>
			</div>

			<p class="text-muted-foreground mt-3 text-xs">No subscription lock. Pay only for actual usage.</p>
		</div>

		<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0">
			<Card.Header class="border-b-2 border-black dark:border-border px-5 py-4">
				<Card.Title class="text-sm">Why Eigen Mesh</Card.Title>
				<Card.Description class="text-xs">One memory layer, four core benefits.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 p-4">
				{#each uspItems as item}
					<div class="flex items-start gap-3 rounded-md border border-border/70 bg-muted/35 p-3">
						<div class="mt-0.5 rounded border border-border/80 bg-background p-1.5">
							<item.icon class="size-3.5" strokeWidth={1.9} />
						</div>
						<div>
							<p class="text-foreground text-sm font-medium">{item.title}</p>
							<p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">{item.description}</p>
						</div>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	</section>

	<Separator class="my-4" />

	<section class="py-8">
		<div class="mb-5">
			<p class="text-primary text-[11px] font-semibold uppercase tracking-[0.13em]">How it works</p>
			<h2 class="text-foreground mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Capture → Connect → Retrieve</h2>
		</div>
		<div class="grid gap-4 md:grid-cols-3">
			{#each flow as step}
				<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[6px_6px_0px_0px_#000] dark:shadow-none p-0">
					<Card.Content class="space-y-2 p-5">
						<p class="text-muted-foreground text-[11px] font-medium uppercase tracking-widest">{step.label}</p>
						<p class="text-foreground text-sm leading-relaxed">{step.description}</p>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	</section>

	<section class="pt-8">
		<Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0">
			<Card.Content class="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
				<div class="flex items-start gap-3">
					<Network class="mt-0.5 size-4 text-primary" strokeWidth={2} />
					<div>
						<p class="text-foreground text-base font-medium">Ready to use your memory-first dashboard?</p>
						<p class="text-muted-foreground mt-1 text-xs sm:text-sm">
							Sign up or log in to continue into the existing Eigen Mesh experience.
						</p>
					</div>
				</div>
				<div class="flex shrink-0 gap-2">
					<Button href="/signup" class="rounded-[6px] px-5">Sign up</Button>
					<Button href="/login" variant="outline" class="rounded-[6px] px-5">Log in</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</section>
</div>
