<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { fetchWalletBalance } from '$lib/billing/fetch-wallet';
	import { initPayPalCheckout } from '$lib/billing/paypal-checkout';

	let {
		availableCredits = 0,
		paypalConfigured = false,
		paypalClientId = null as string | null,
		paypalSdkUrl = null as string | null,
		compact = false,
		onBalanceUpdated
	}: {
		availableCredits?: number;
		paypalConfigured?: boolean;
		paypalClientId?: string | null;
		paypalSdkUrl?: string | null;
		compact?: boolean;
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

	function formatWalletBalance(credits: number): string {
		return credits.toLocaleString('en-US');
	}

	function parseTopUpCredits(): number {
		const raw = topUpAmount.replace(/,/g, '').trim();
		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed <= 0) return 0;
		return Math.round(parsed);
	}

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

<div class="space-y-2 {compact ? 'text-xs' : 'text-sm'}">
	{#if !compact}
		<div>
			<p class="text-muted-foreground text-xs">Balance</p>
			<p class="text-2xl font-semibold tracking-tight tabular-nums">
				{formatWalletBalance(walletAvailableCredits)}
			</p>
			<p class="text-muted-foreground mt-0.5 text-xs">Eigen credits</p>
		</div>
	{:else}
		<p class="text-muted-foreground text-xs">
			Balance: <span class="text-foreground font-medium tabular-nums"
				>{formatWalletBalance(walletAvailableCredits)}</span
			> credits
		</p>
	{/if}

	<div class="rounded-xl bg-muted px-3.5 py-3">
		<div class="space-y-2">
			<div class="space-y-1">
				<Label for="top-up-amount" class="text-xs">Top-up amount (credits)</Label>
				<Input
					id="top-up-amount"
					type="text"
					inputmode="numeric"
					class="h-9 rounded-[4px] text-xs"
					bind:value={topUpAmount}
					placeholder="10000"
				/>
				<p class="text-muted-foreground text-xs">Minimum 1,000 credits ($1 USD via PayPal).</p>
			</div>
			{#if paypalConfigured}
				<Button
					type="button"
					variant="default"
					size="sm"
					class="rounded-[4px]"
					bind:ref={paypalButtonEl}
					disabled={!paypalReady}
				>
					{paypalReady ? 'Pay with PayPal' : topUpError ? 'PayPal unavailable' : 'Loading PayPal…'}
				</Button>
			{:else}
				<p class="text-destructive text-xs">
					PayPal is not configured on this deployment. Use Settings → LLM → BYOK for your own API keys.
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
