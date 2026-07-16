<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import type { ActionData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import { signUpSchema } from '$lib/validation/auth';
	import AuthSocialButtons from '$lib/components/auth-social-buttons.svelte';
	import { signupPlanSubtitle } from '$lib/auth/signup-plan';
	import type { PageData } from './$types';

	const websiteOrigin = (import.meta.env.PUBLIC_WEBSITE_ORIGIN ?? '').replace(/\/$/, '');
	const homeHref = websiteOrigin || resolve('/' as Pathname);

	let { data, form }: { data: PageData; form: ActionData } = $props();

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
	<p class="mb-4">
		<a href={homeHref} class="text-muted-foreground text-xs underline-offset-2 hover:underline">
			← Back to home
		</a>
	</p>
	<header class="text-center">
		<a href={homeHref} class="inline-block">
			<EigenWordmark heightClass="h-8" />
		</a>
		<p class="text-muted-foreground mt-2 text-xs">Create an account</p>
		{#if data.plan}
			<p class="text-muted-foreground mt-1 text-xs">{signupPlanSubtitle(data.plan)}</p>
		{/if}
	</header>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card">
		<Card.Content class="space-y-4 pt-6">
			{#if form?.checkEmail}
				<p class="text-foreground text-xs">
					{form.message ?? 'Check your email for a verification link before signing in.'}
				</p>
				<p class="text-muted-foreground text-center text-xs">
					<a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline">Sign in</a>
				</p>
			{:else}
			{#if data.socialProviders.length > 0}
				<AuthSocialButtons providers={data.socialProviders} />
				<div class="relative py-1">
					<div class="border-t border-black/10" aria-hidden="true"></div>
					<p class="text-muted-foreground absolute inset-x-0 top-1/2 -translate-y-1/2 bg-card px-2 text-center text-[10px] mx-auto w-fit">
						or
					</p>
				</div>
			{/if}
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
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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
						class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
						aria-describedby={fieldErrors.password ? 'password-error' : undefined}
					/>
					<p class="text-muted-foreground text-[10px]">Minimum 8 characters</p>
					{#if fieldErrors.password}
						<p id="password-error" class="text-destructive text-xs">{fieldErrors.password}</p>
					{/if}
				</div>
				<Button type="submit" class="w-full rounded-[4px]">Create account</Button>
				{#if form?.message}
					<p class="text-destructive text-xs">{form.message}</p>
				{/if}
			</form>

			<p class="text-muted-foreground text-center text-xs">
				Already have an account?
				<a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline">Sign in</a>
			</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
