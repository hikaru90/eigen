<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
</script>

<div class="mx-auto max-w-lg px-5 pt-10">
	<header class="text-center">
		<EigenWordmark heightClass="h-11" class="mt-1" />
		<p class="text-muted-foreground mt-2 text-xs">Capture. Structure. Remember.</p>
	</header>

	<Card.Root
		class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
	>
		<Card.Header>
			<Card.Title class="text-sm">Welcome</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Open Brain-style memory MVP: single-step capture, transparent activity, Postgres-backed storage.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-2">
			<Button href={resolve('/capture')} class="w-full justify-center rounded-[4px]">Capture</Button>
			<Button href={resolve('/settings')} variant="outline" class="w-full justify-center">Settings</Button>
			<Button href={resolve('/activity')} variant="outline" class="w-full justify-center">Activity log</Button>
			<Button href={resolve('/demo/better-auth/login')} variant="ghost" class="w-full justify-center text-xs">
				Sign in
			</Button>
		</Card.Content>
	</Card.Root>
</div>
