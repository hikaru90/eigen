<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import { signUpSchema } from '$lib/validation/auth';

	let { form }: { form: ActionData } = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let fieldErrors = $state<{ name?: string; email?: string; password?: string }>({});

	function validate() {
		const result = signUpSchema.safeParse({ name, email, password });
		if (result.success) {
			fieldErrors = {};
			return true;
		}
		const flat = result.error.flatten().fieldErrors;
		fieldErrors = {
			name: flat.name?.[0],
			email: flat.email?.[0],
			password: flat.password?.[0]
		};
		return false;
	}
</script>

<div class="mx-auto max-w-md px-5 pt-10">
	<header class="text-center">
		<EigenWordmark heightClass="h-8" />
		<p class="text-muted-foreground mt-2 text-xs">Create account</p>
	</header>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card">
		<Card.Content class="space-y-4 pt-6">
			<form
				method="post"
				action="?/signUpEmail"
				use:enhance
				class="space-y-4"
				onsubmit={(e) => { if (!validate()) e.preventDefault(); }}
			>
				<div class="space-y-1">
					<Label for="name">Name</Label>
					<input
						id="name"
						type="text"
						name="name"
						autocomplete="name"
						bind:value={name}
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
						aria-describedby={fieldErrors.name ? 'name-error' : undefined}
					/>
					{#if fieldErrors.name}
						<p id="name-error" class="text-destructive text-xs">{fieldErrors.name}</p>
					{/if}
				</div>
				<div class="space-y-1">
					<Label for="email">Email</Label>
					<input
						id="email"
						type="email"
						name="email"
						autocomplete="email"
						bind:value={email}
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
						aria-describedby={fieldErrors.email ? 'email-error' : undefined}
					/>
					{#if fieldErrors.email}
						<p id="email-error" class="text-destructive text-xs">{fieldErrors.email}</p>
					{/if}
				</div>
				<div class="space-y-1">
					<Label for="password">Password</Label>
					<input
						id="password"
						type="password"
						name="password"
						autocomplete="new-password"
						bind:value={password}
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs"
						aria-describedby={fieldErrors.password ? 'password-error' : undefined}
					/>
					{#if fieldErrors.password}
						<p id="password-error" class="text-destructive text-xs">{fieldErrors.password}</p>
					{/if}
				</div>
				<Button type="submit" class="w-full rounded-[4px]">Create account</Button>
				{#if form?.message}
					<p class="text-destructive text-xs">{form.message}</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>
</div>
