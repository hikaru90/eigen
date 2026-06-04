<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import { fetchWalletBalance } from '$lib/billing/fetch-wallet';
	import { initPayPalCheckout } from '$lib/billing/paypal-checkout';
	import Check from '@lucide/svelte/icons/check';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const initialTab = $derived(
		page.url.searchParams.get('tab') === 'byok' || page.url.searchParams.get('tab') === 'credits'
			? (page.url.searchParams.get('tab') as 'byok' | 'credits')
			: data.initialTab
	);

	let activeTab = $state<'credits' | 'byok'>('credits');
	let billingMode = $state<'platform_credits' | 'byok'>('platform_credits');

	$effect(() => {
		activeTab = initialTab;
	});

	$effect(() => {
		billingMode = data.billingMode;
	});

	$effect(() => {
		if (form?.billingMode) {
			billingMode = form.billingMode;
		}
	});

	let walletAvailableCents = $state(0);

	const displayCurrency = $derived(data.wallet.currency);

	$effect(() => {
		walletAvailableCents = data.wallet.availableCents;
	});
	let topUpAmount = $state('10.00');
	let topUpStatus = $state<string | null>(null);
	let topUpError = $state<string | null>(null);
	let paypalReady = $state(false);
	let paypalButtonEl = $state<HTMLButtonElement | null>(null);

	const providers = [
		{ id: 'openrouter' as const, label: 'OpenRouter' },
		{ id: 'eurouter' as const, label: 'EUrouter' }
	];

	function formatWalletBalance(cents: number, currency: string): string {
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}

	function parseTopUpCents(): number {
		const parsed = Number(topUpAmount.replace(',', '.').trim());
		if (!Number.isFinite(parsed) || parsed <= 0) return 0;
		return Math.round(parsed * 100);
	}

	/** Plain `let` — must not be `$state` or assigning the teardown retriggers `$effect` and cancels PayPal forever. */
	let teardownPayPal: (() => void) | undefined;

	$effect(() => {
		teardownPayPal?.();
		teardownPayPal = undefined;
		paypalReady = false;

		const buttonEl = paypalButtonEl;
		if (
			activeTab !== 'credits' ||
			!data.paypalConfigured ||
			!data.paypalClientId ||
			!data.paypalSdkUrl ||
			!buttonEl
		) {
			return;
		}

		topUpError = null;

		let cancelled = false;
		void initPayPalCheckout({
			clientId: data.paypalClientId,
			sdkUrl: data.paypalSdkUrl,
			currencyCode: data.defaultBillingCurrency,
			getAmountCents: parseTopUpCents,
			onBalanceUpdated: () => {
				void fetchWalletBalance().then((wallet) => {
					if (wallet) walletAvailableCents = wallet.availableCents;
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

<div class="mx-auto max-w-2xl space-y-8 px-4 pb-8 pt-4">

	<section class="space-y-3">
		<div>
			<h2 class="text-sm font-semibold">Billing method</h2>
			<p class="text-muted-foreground mt-1 text-xs">
				Choose whether LLM calls use your Eigen wallet or your own gateway API keys. This applies to
				capture, chat, and embeddings.
			</p>
		</div>

		<form
			method="post"
			action="?/setBillingMode"
			use:enhance={() => {
				return async ({ result, update }) => {
					await update();
					if (result.type === 'success' && result.data?.billingMode === 'byok') {
						activeTab = 'byok';
					} else if (result.type === 'success' && result.data?.billingMode === 'platform_credits') {
						activeTab = 'credits';
					}
				};
			}}
			class="rounded-xl bg-muted px-3.5 py-3"
		>
			<div class="space-y-2">
				<Label for="billing-mode">Method</Label>
				<select
					id="billing-mode"
					name="billingMode"
					class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
					bind:value={billingMode}
				>
					<option value="platform_credits">Eigen platform credits</option>
					<option value="byok" disabled={!data.byokConfigured}>Bring your own key (BYOK)</option>
				</select>
				{#if !data.byokConfigured}
					<p class="text-muted-foreground text-xs">
						To use BYOK, configure OpenRouter or EUrouter on the BYOK tab first.
					</p>
				{:else if billingMode === 'byok'}
					<p class="text-muted-foreground text-xs">
						Active provider: {data.activeProvider === 'eurouter' ? 'EUrouter' : 'OpenRouter'}.
						<a href="/settings/llm?tab=byok" class="text-foreground underline">Change</a>
					</p>
				{:else}
					<p class="text-muted-foreground text-xs">
						Capture, chat, and embeddings bill your Eigen wallet balance.
					</p>
				{/if}
				<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save billing method</Button>
				{#if form?.billingMessage}
					<p class="text-muted-foreground text-xs">{form.billingMessage}</p>
				{/if}
			</div>
		</form>
	</section>

	<section class="space-y-4 mt-8">
		<div>
			<h2 class="text-sm font-semibold">Billing settings</h2>
			<p class="text-muted-foreground mt-1 text-xs">
				Top up your wallet and set currency on Credits, or manage OpenRouter and EUrouter keys on BYOK.
			</p>
		</div>

		<Tabs.Root bind:value={activeTab} class="space-y-4">
			<Tabs.List class="w-full">
			<Tabs.Trigger value="credits" class="flex-1">Credits</Tabs.Trigger>
			<Tabs.Trigger value="byok" class="flex-1">BYOK</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="credits" class="space-y-3">
			<div class="px-1 py-1">
				<p class="text-muted-foreground text-xs">Balance</p>
				<p class="text-3xl font-semibold tracking-tight tabular-nums">
					{formatWalletBalance(walletAvailableCents, displayCurrency)}
				</p>
			</div>

			<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
				<form method="post" action="?/updateBillingCurrency" use:enhance class="space-y-2">
					<div class="space-y-1">
						<Label for="billing-currency">Default billing currency</Label>
						<select
							id="billing-currency"
							name="defaultBillingCurrency"
							class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
							value={data.defaultBillingCurrency}
						>
							<option value="USD">USD</option>
							<option value="EUR">EUR</option>
							<option value="GBP">GBP</option>
							<option value="CHF">CHF</option>
							<option value="CAD">CAD</option>
							<option value="AUD">AUD</option>
						</select>
					</div>
					<Button type="submit" variant="outline" size="sm" class="rounded-[4px]">Save currency</Button>
				</form>

				<div class="mt-3 space-y-2 border-t border-border/60 pt-3">
					<div class="space-y-1">
						<Label for="top-up-amount">Top-up amount ({data.defaultBillingCurrency})</Label>
						<Input
							id="top-up-amount"
							type="text"
							inputmode="decimal"
							class="h-9 rounded-[4px] text-xs"
							bind:value={topUpAmount}
							placeholder="10.00"
						/>
					</div>
					{#if data.paypalConfigured}
						<Button
							type="button"
							variant="default"
							size="sm"
							class="rounded-[4px]"
							bind:ref={paypalButtonEl}
							disabled={!paypalReady}
						>
							{paypalReady
								? 'Pay with PayPal'
								: topUpError
									? 'PayPal unavailable'
									: 'Loading PayPal…'}
						</Button>
					{:else}
						<p class="text-destructive text-xs">
							PayPal is not configured on this server. Set `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET`
							(or `PAYPAL_CLIENT_SECRET`) and `PAYPAL_URL` (or `PAYPAL_API_BASE`).
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
		</Tabs.Content>

		<Tabs.Content value="byok" class="space-y-3">
			<div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
				<p class="text-muted-foreground text-xs">
					Bring your own OpenRouter or EUrouter API keys. LLM calls use your keys and do not deduct Eigen
					credits.
				</p>
				<ul class="mt-3 divide-y divide-border/60">
					{#each providers as item}
						{@const configured = data.providers[item.id].configured}
						{@const isActive = data.activeProvider === item.id && data.billingMode === 'byok'}
						<li>
							<a
								href="/settings/llm/byok/{item.id}"
								class="flex items-center justify-between gap-3 py-3 text-xs hover:bg-black/5 dark:hover:bg-white/5"
							>
								<span class="font-medium text-foreground">{item.label}</span>
								<span class="flex items-center gap-1.5 text-muted-foreground">
									{#if configured}
										<Check class="size-4 text-green-600 dark:text-green-400" strokeWidth={2} aria-hidden="true" />
										{#if isActive}
											<span class="text-foreground">Active</span>
										{/if}
									{:else}
										<span>Not configured &gt;</span>
									{/if}
								</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if form?.llmMessage}
					<p class="text-muted-foreground mt-2 text-xs">{form.llmMessage}</p>
				{/if}
			</div>
		</Tabs.Content>
		</Tabs.Root>
	</section>
</div>
