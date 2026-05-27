<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { authClient } from '$lib/auth-client';
	import type { SocialProviderId } from '$lib/server/auth-social';

	let {
		providers,
		callbackURL = '/capture'
	}: {
		providers: SocialProviderId[];
		callbackURL?: string;
	} = $props();

	let busy = $state<SocialProviderId | null>(null);
	let errorMessage = $state<string | null>(null);

	const labels: Record<SocialProviderId, string> = {
		google: 'Continue with Google',
		github: 'Continue with GitHub'
	};

	async function signInWith(provider: SocialProviderId) {
		busy = provider;
		errorMessage = null;
		try {
			await authClient.signIn.social({ provider, callbackURL });
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Social sign-in failed';
			busy = null;
		}
	}
</script>

{#if providers.length > 0}
	<div class="space-y-2">
		{#each providers as provider (provider)}
			<Button
				type="button"
				variant="outline"
				class="w-full rounded-[4px]"
				disabled={busy !== null}
				onclick={() => signInWith(provider)}
			>
				{busy === provider ? 'Redirecting…' : labels[provider]}
			</Button>
		{/each}
		{#if errorMessage}
			<p class="text-destructive text-xs">{errorMessage}</p>
		{/if}
	</div>
{/if}
