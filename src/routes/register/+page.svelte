<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';

	let { form }: { form: ActionData } = $props();
</script>

<div class="mx-auto max-w-md px-5 pt-10">
	<header class="text-center">
		<EigenWordmark heightClass="h-10" />
		<p class="text-muted-foreground mt-2 text-xs">Create account</p>
	</header>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card">
		<Card.Content class="space-y-4 pt-6">
			<form method="post" action="?/signUpEmail" use:enhance class="space-y-4">
				<div class="space-y-1">
					<Label for="name">Name</Label>
					<input
						id="name"
						type="text"
						name="name"
						autocomplete="name"
						required
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="email">Email</Label>
					<input
						id="email"
						type="email"
						name="email"
						autocomplete="email"
						required
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<div class="space-y-1">
					<Label for="password">Password</Label>
					<input
						id="password"
						type="password"
						name="password"
						autocomplete="new-password"
						required
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
					/>
				</div>
				<Button type="submit" class="w-full rounded-[4px]">Create account</Button>
				{#if form?.message}
					<p class="text-destructive text-xs">{form.message}</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>

	<p class="text-muted-foreground mt-6 text-center text-xs">
		Already have an account?
		<a class="text-foreground underline" href={resolve('/login')}>Sign in</a>
	</p>

	<p class="text-muted-foreground mt-4 pb-6 text-center text-[11px]">
		<a class="underline" href={resolve('/')}>Home</a>
	</p>
</div>
