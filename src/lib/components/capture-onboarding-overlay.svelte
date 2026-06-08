<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte';

	let {
		open,
		billingMode = 'platform_credits' as 'platform_credits' | 'byok',
		walletAvailableCredits = 0,
		minCaptureCredits = 50,
		paypalConfigured = false,
		paypalClientId = null as string | null,
		paypalSdkUrl = null as string | null,
		groundingCompleted = false,
		creditsGatePassed = false
	}: {
		open: boolean;
		billingMode?: 'platform_credits' | 'byok';
		walletAvailableCredits?: number;
		minCaptureCredits?: number;
		paypalConfigured?: boolean;
		paypalClientId?: string | null;
		paypalSdkUrl?: string | null;
		groundingCompleted?: boolean;
		creditsGatePassed?: boolean;
	} = $props();

	let step = $state(0);
	const lastStep = 3;

	let localWalletCredits = $state(0);

	$effect(() => {
		if (open) {
			step = 0;
			localWalletCredits = walletAvailableCredits;
		}
	});

	const creditsOk = $derived(
		billingMode === 'byok' || localWalletCredits >= minCaptureCredits || creditsGatePassed
	);
	const bothGatesPassed = $derived(creditsOk && groundingCompleted);

	const completeOnboardingEnhance: SubmitFunction = () =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
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
						you. Before your first capture, add credits (or use BYOK in Settings) and have a short
						<strong>getting-to-know-you</strong> conversation so classification fits who you are.
					</p>
				{:else if step === 1}
					<p class="text-xs leading-relaxed">
						{#if billingMode === 'byok'}
							You are on <strong>bring-your-own-key</strong> billing — no wallet top-up needed. Manage
							keys under Settings → LLM → BYOK.
						{:else}
							Add <strong>Eigen credits</strong> to pay for capture, chat, and embeddings. Each LLM call
							is logged transparently in Activity.
						{/if}
					</p>
					{#if billingMode === 'platform_credits'}
						<CreditsTopUpPanel
							compact
							availableCredits={localWalletCredits}
							{paypalConfigured}
							{paypalClientId}
							{paypalSdkUrl}
							onBalanceUpdated={(credits) => {
								localWalletCredits = credits;
							}}
						/>
						{#if creditsOk}
							<p class="text-xs text-green-600 dark:text-green-400">Enough credits to capture.</p>
						{/if}
					{/if}
				{:else if step === 2}
					<p class="text-xs leading-relaxed">
						Next, a brief chat helps Eigen understand your work, values, and how you think — so
						thought categories and entities match <em>you</em>, not a generic template.
					</p>
					{#if groundingCompleted}
						<p class="text-xs text-green-600 dark:text-green-400">Grounding conversation complete.</p>
					{:else}
						<Button href="/chat?mode=grounding" class="w-full rounded-[4px] text-xs">
							Start getting-to-know-you chat
						</Button>
						<p class="text-muted-foreground text-[10px] leading-relaxed">
							Uses a few credits from your wallet. Takes about 5–10 minutes.
						</p>
					{/if}
				{:else}
					<p class="text-xs leading-relaxed">
						{#if bothGatesPassed}
							You are set. Drop thoughts on Capture — type or dictate. No filing or tags required.
						{:else}
							Complete the steps above before capturing: {#if !creditsOk}add credits{/if}
							{#if !creditsOk && !groundingCompleted}
								and
							{/if}
							{#if !groundingCompleted}finish the grounding chat{/if}.
						{/if}
					</p>
				{/if}
			</Card.Content>

			<Card.Footer class="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-4 dark:border-white/15">
				{#if step > 0}
					<Button type="button" variant="outline" class="rounded-[4px] text-xs" onclick={() => (step -= 1)}>
						Back
					</Button>
				{:else}
					<div class="w-20 shrink-0" aria-hidden="true"></div>
				{/if}

				{#if step < lastStep}
					<Button type="button" class="rounded-[4px] text-xs" onclick={() => (step += 1)}>Next</Button>
				{:else if bothGatesPassed}
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
