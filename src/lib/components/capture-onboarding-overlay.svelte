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
		byokUiEnabled = false,
		startingFreeCredits = 100
	}: {
		open: boolean;
		walletAvailableCredits?: number;
		minCaptureCredits?: number;
		paypalConfigured?: boolean;
		paypalClientId?: string | null;
		paypalSdkUrl?: string | null;
		creditsGatePassed?: boolean;
		byokUiEnabled?: boolean;
		startingFreeCredits?: number;
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
						you. New accounts include <strong>{startingFreeCredits.toLocaleString('en-US')} free Eigen credits</strong>
						to try capture. When those run out, add more credits in Settings or below.
					</p>
				{:else if step === 1}
					<p class="text-xs leading-relaxed">
						{#if byokUiEnabled && !paypalConfigured}
							Your account starts with {startingFreeCredits.toLocaleString('en-US')} free credits. Configure your own LLM keys under
							<a href="/settings/llm?tab=byok" class="underline">Settings → LLM → BYOK</a>,
							or add Eigen credits below when PayPal is available.
						{:else if byokUiEnabled}
							You have {startingFreeCredits.toLocaleString('en-US')} free credits to start. Add more <strong>Eigen credits</strong> below when you need them, or use your own gateway keys under
							<a href="/settings/llm?tab=byok" class="underline">Settings → LLM → BYOK</a>.
						{:else}
							You have {startingFreeCredits.toLocaleString('en-US')} free credits to try capture, chat, and embeddings.
							When your balance is low, add <strong>Eigen credits</strong> below (minimum purchase applies).
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
						<p class="text-xs text-green-600 dark:text-green-400">
							Enough credits to capture ({localWalletCredits.toLocaleString('en-US')} available).
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							Add credits above to continue after your free balance runs out.
						</p>
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
