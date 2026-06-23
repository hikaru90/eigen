<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { fetchWalletBalance } from '$lib/billing/fetch-wallet';
	import { initPayPalCheckout } from '$lib/billing/paypal-checkout';
	import {
		CREDITS_PER_USD,
		MIN_TOP_UP_CREDITS,
		computeTopUpCheckoutQuoteUi,
		formatCreditsAsUsd,
		formatUsdAmount,
		platformMarkupPercentLabel,
		purchaseMarkupDisclosureText
	} from '$lib/billing/platform-pricing';
	import PayPalLogo from '$lib/components/paypal-logo.svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { CreditsUiSurface } from '$lib/analytics/billing-events';
	import { trackCreditsUiViewed } from '$lib/analytics/billing-events';

	let {
		availableCredits = 0,
		paypalConfigured = false,
		paypalClientId = null as string | null,
		paypalSdkUrl = null as string | null,
		compact = false,
		surface = 'settings_llm' as CreditsUiSurface,
		onBalanceUpdated
	}: {
		availableCredits?: number;
		paypalConfigured?: boolean;
		paypalClientId?: string | null;
		paypalSdkUrl?: string | null;
		compact?: boolean;
		surface?: CreditsUiSurface;
		onBalanceUpdated?: (credits: number) => void;
	} = $props();

	let walletAvailableCredits = $state(0);
	let topUpAmount = $state('10000');
	let topUpStatus = $state<string | null>(null);
	let topUpError = $state<string | null>(null);
	let paypalReady = $state(false);
	let paypalButtonEl = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		walletAvailableCredits = availableCredits;
	});

	$effect(() => {
		trackCreditsUiViewed({
			surface,
			paypal_configured: paypalConfigured,
			available_credits: availableCredits
		});
	});

	function formatWalletBalance(credits: number): string {
		return credits.toLocaleString('en-US');
	}

	function parseTopUpCredits(): number {
		const raw = topUpAmount.replace(/,/g, '').trim();
		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed <= 0) return 0;
		return Math.round(parsed);
	}

	const topUpCredits = $derived(parseTopUpCredits());
	const checkoutQuote = $derived(computeTopUpCheckoutQuoteUi(topUpCredits));
	const minCheckoutQuote = $derived(computeTopUpCheckoutQuoteUi(MIN_TOP_UP_CREDITS));
	const balanceUsd = $derived(formatCreditsAsUsd(walletAvailableCredits));
	const topUpValid = $derived(topUpCredits >= MIN_TOP_UP_CREDITS);
	const rateLabel = $derived(
		`${CREDITS_PER_USD.toLocaleString('en-US')} credits = ${formatCreditsAsUsd(CREDITS_PER_USD) ?? '$1.00'} USD gateway value`
	);

	let teardownPayPal: (() => void) | undefined;

	$effect(() => {
		teardownPayPal?.();
		teardownPayPal = undefined;
		paypalReady = false;

		const buttonEl = paypalButtonEl;
		if (!paypalConfigured || !paypalClientId || !paypalSdkUrl || !buttonEl) {
			return;
		}

		topUpError = null;
		let cancelled = false;

		void initPayPalCheckout({
			clientId: paypalClientId,
			sdkUrl: paypalSdkUrl,
			getAmountCredits: parseTopUpCredits,
			onBalanceUpdated: () => {
				void fetchWalletBalance().then((wallet) => {
					if (wallet) {
						walletAvailableCredits = wallet.availableCredits;
						onBalanceUpdated?.(wallet.availableCredits);
					}
				});
			},
			onStatus: (msg) => {
				topUpStatus = msg;
				topUpError = null;
			},
			onError: (msg) => {
				topUpError = msg;
			},
			button: buttonEl
		})
			.then((teardown) => {
				if (cancelled) {
					teardown();
					return;
				}
				teardownPayPal = teardown;
				paypalReady = true;
			})
			.catch((e) => {
				topUpError = e instanceof Error ? e.message : String(e);
			});

		return () => {
			cancelled = true;
			teardownPayPal?.();
			teardownPayPal = undefined;
		};
	});
</script>

<div class="space-y-3 {compact ? 'text-xs' : 'text-sm'}">
	{#if !compact}
		<div>
			<p class="text-muted-foreground text-xs">Current balance</p>
			<p class="text-3xl font-semibold tracking-tight tabular-nums">
				{balanceUsd ?? '—'}
				<span class="text-muted-foreground text-base font-normal"> USD</span>
			</p>
			<p class="text-muted-foreground mt-0.5 text-xs tabular-nums">
				{formatWalletBalance(walletAvailableCredits)} Eigen credits
			</p>
		</div>
	{:else}
		<p class="text-muted-foreground text-xs tabular-nums">
			Balance:
			<span class="text-foreground font-medium">{balanceUsd ?? '—'} USD</span>
			<span class="text-muted-foreground">({formatWalletBalance(walletAvailableCredits)} credits)</span>
		</p>
	{/if}

	<div class="rounded-xl border border-border/60 bg-muted px-3.5 py-3">
		<div class="space-y-3">
			<div>
				<p class="text-sm font-medium">Add credits via PayPal</p>
				<p class="text-muted-foreground mt-0.5 text-xs">Pay in USD. Credits are added to your wallet immediately after checkout.</p>
			</div>

			<div class="space-y-1">
				<Label for="top-up-amount" class="text-xs">Credits to add</Label>
				<Input
					id="top-up-amount"
					type="text"
					inputmode="numeric"
					class="h-9 rounded-[4px] text-xs tabular-nums"
					bind:value={topUpAmount}
					placeholder="10000"
				/>
			</div>

			<div class="rounded-lg border border-border/60 bg-background px-3 py-2.5">
				<dl class="space-y-1.5 text-xs">
					<div class="flex items-baseline justify-between gap-3">
						<dt class="text-muted-foreground">Credits added</dt>
						<dd class="font-medium tabular-nums">
							{topUpCredits > 0 ? formatWalletBalance(topUpCredits) : '—'}
						</dd>
					</div>
					{#if checkoutQuote}
						<div class="flex items-baseline justify-between gap-3">
							<dt class="text-muted-foreground">Gateway value</dt>
							<dd class="tabular-nums">{formatUsdAmount(checkoutQuote.baseUsd)}</dd>
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<dt class="text-muted-foreground">Platform fee ({platformMarkupPercentLabel()})</dt>
							<dd class="tabular-nums">{formatUsdAmount(checkoutQuote.markupUsd)}</dd>
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<dt class="text-muted-foreground">Est. PayPal processing</dt>
							<dd class="tabular-nums">{formatUsdAmount(checkoutQuote.estimatedPaypalFeeUsd)}</dd>
						</div>
						<div class="border-border/60 flex items-baseline justify-between gap-3 border-t pt-1.5">
							<dt class="font-medium">Total due at PayPal</dt>
							<dd class="text-lg font-semibold tabular-nums tracking-tight">
								{formatUsdAmount(checkoutQuote.grossUsd)}
								<span class="text-muted-foreground text-sm font-normal"> USD</span>
							</dd>
						</div>
					{:else}
						<div class="flex items-baseline justify-between gap-3">
							<dt class="text-muted-foreground">Total due at PayPal</dt>
							<dd class="text-lg font-semibold tabular-nums tracking-tight">—</dd>
						</div>
					{/if}
				</dl>
			</div>

			<p class="text-muted-foreground text-xs">
				Rate: {rateLabel}. Minimum {MIN_TOP_UP_CREDITS.toLocaleString('en-US')} credits
				{#if minCheckoutQuote}
					(checkout from {formatUsdAmount(minCheckoutQuote.grossUsd)}).
				{:else}
					.
				{/if}
			</p>
			{#if topUpCredits > 0 && !topUpValid}
				<p class="text-destructive text-xs">
					Minimum top-up is {MIN_TOP_UP_CREDITS.toLocaleString('en-US')} credits.
				</p>
			{/if}
			<p class="text-muted-foreground text-xs">{purchaseMarkupDisclosureText()}</p>

			{#if paypalConfigured}
				<Button
					type="button"
					variant="default"
					size="sm"
					class="h-auto min-h-10 gap-2 rounded-[4px] border-0 bg-[#ffc439] px-5 py-2.5 font-semibold text-[#003087] hover:bg-[#f2ba36] dark:bg-[#ffc439] dark:text-[#003087] dark:hover:bg-[#f2ba36]"
					bind:ref={paypalButtonEl}
					disabled={!paypalReady || !topUpValid}
					aria-label={paypalReady ? 'Pay with PayPal' : topUpError ? 'PayPal unavailable' : 'Loading PayPal checkout'}
					aria-busy={!paypalReady && !topUpError}
				>
					{#if paypalReady}
						<span class="text-sm">
							Pay {checkoutQuote ? formatUsdAmount(checkoutQuote.grossUsd) : ''}
						</span>
						<PayPalLogo />
					{:else if topUpError}
						PayPal unavailable
					{:else}
						<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
						<span class="text-sm">Loading PayPal…</span>
					{/if}
				</Button>
			{:else}
				<p class="text-destructive text-xs">
					PayPal is not configured on this deployment. Contact the operator to enable credit top-ups.
				</p>
			{/if}
			{#if topUpStatus}
				<p class="text-muted-foreground text-xs">{topUpStatus}</p>
			{/if}
			{#if topUpError}
				<p class="text-destructive text-xs">{topUpError}</p>
			{/if}
		</div>
	</div>
</div>
