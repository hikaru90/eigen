<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte';
	import { capture } from '$lib/analytics/posthog-client';

	let {
		open,
		walletAvailableCredits = 0,
		minCaptureCredits = 50,
		paypalConfigured = false,
		paypalClientId = null as string | null,
		paypalSdkUrl = null as string | null,
		creditsGatePassed = false,
		byokUiEnabled = false
	}: {
		open: boolean;
		walletAvailableCredits?: number;
		minCaptureCredits?: number;
		paypalConfigured?: boolean;
		paypalClientId?: string | null;
		paypalSdkUrl?: string | null;
		creditsGatePassed?: boolean;
		byokUiEnabled?: boolean;
	} = $props();

	let step = $state(0);
	const lastStep = 2;
	let wasOpen = $state(false);

	let localWalletCredits = $state(0);

	$effect(() => {
		if (open && !wasOpen) {
			step = 0;
			localWalletCredits = walletAvailableCredits;
		}
		wasOpen = open;
	});

	const creditsOk = $derived(
		localWalletCredits >= minCaptureCredits || creditsGatePassed
	);

	const completeOnboardingEnhance: SubmitFunction = () =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				capture('onboarding_completed', { credits_available: localWalletCredits });
				await invalidateAll();
			}
		};

	const skipOnboardingEnhance: SubmitFunction = () =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				capture('onboarding_skipped', {});
				await invalidateAll();
			}
		};
</script>

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-5 backdrop-blur-[2px]"
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-title"
		aria-describedby="onboarding-desc"
	>
		<Card.Root
			class="ring-foreground/10 max-h-[90dvh] w-full max-w-md overflow-y-auto border border-black/10 bg-card shadow-lg ring-1 dark:border-white/20"
		>
			<Card.Header class="space-y-2">
				<Card.Title id="onboarding-title" class="text-base">Welcome to Eigen</Card.Title>
				<Card.Description id="onboarding-desc" class="text-muted-foreground text-xs">
					Step {step + 1} of {lastStep + 1}
				</Card.Description>
			</Card.Header>

			<Card.Content class="space-y-3 text-sm text-card-foreground">
				{#if step === 0}
					<p class="text-xs leading-relaxed">
						Eigen is your personal memory — capture raw thoughts, and the system organizes them for
						you. You can add credits now or skip and configure billing later in Settings.
					</p>
				{:else if step === 1}
					<p class="text-xs leading-relaxed">
						{#if byokUiEnabled && !paypalConfigured}
							Configure your own LLM keys under <a href="/settings/llm?tab=byok" class="underline">Settings → LLM → BYOK</a>,
							or add Eigen credits below when PayPal is available.
						{:else if byokUiEnabled}
							Add <strong>Eigen credits</strong> below, or use your own gateway keys under
							<a href="/settings/llm?tab=byok" class="underline">Settings → LLM → BYOK</a>.
						{:else}
							Add <strong>Eigen credits</strong> to pay for capture, chat, voice dictation, and embeddings.
							Each LLM call is logged in Activity.
						{/if}
					</p>
					{#if paypalConfigured}
						<CreditsTopUpPanel
							compact
							surface="onboarding"
							availableCredits={localWalletCredits}
							{paypalConfigured}
							{paypalClientId}
							{paypalSdkUrl}
							onBalanceUpdated={(credits) => {
								localWalletCredits = credits;
							}}
						/>
					{/if}
					{#if creditsOk}
						<p class="text-xs text-green-600 dark:text-green-400">Enough credits to capture.</p>
					{/if}
				{:else}
					<p class="text-xs leading-relaxed">
						{#if creditsOk}
							You are set. Drop thoughts on Capture — type or dictate. No filing or tags required.
						{:else}
							Add credits above before capturing.
						{/if}
					</p>
				{/if}
			</Card.Content>

			<Card.Footer class="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-4 dark:border-white/15">
				<div class="flex min-w-0 flex-1 items-center gap-2">
					{#if step > 0}
						<Button type="button" variant="outline" class="rounded-[4px] text-xs" onclick={() => (step -= 1)}>
							Back
						</Button>
					{/if}
					<form method="post" action="?/skipOnboarding" use:enhance={skipOnboardingEnhance}>
						<Button type="submit" variant="ghost" class="rounded-[4px] text-xs text-muted-foreground">
							Skip for now
						</Button>
					</form>
				</div>

				{#if step < lastStep}
					<Button type="button" class="rounded-[4px] text-xs" onclick={() => (step += 1)}>Next</Button>
				{:else if creditsOk}
					<form method="post" action="?/completeOnboarding" use:enhance={completeOnboardingEnhance}>
						<Button type="submit" class="rounded-[4px] text-xs">Get started</Button>
					</form>
				{:else}
					<Button type="button" variant="outline" class="rounded-[4px] text-xs" onclick={() => (step = 1)}>
						Review setup
					</Button>
				{/if}
			</Card.Footer>
		</Card.Root>
	</div>
{/if}
