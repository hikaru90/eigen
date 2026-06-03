<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
	import { pricingCtaLabel, signupHref } from '$lib/components/marketing/marketing-cta';
</script>

<section class="mb-20 md:mb-32">
	<div
		use:marketingReveal
		class="border-2 border-black bg-white p-8 shadow-[8px_8px_0px_0px_#000] transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-10 opacity-0 md:p-10"
	>
		<p class="text-muted-foreground mb-2 text-center text-[11px] font-medium uppercase tracking-[0.1em]">
			Pricing
		</p>
		<h2 class="text-foreground mb-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
			Choose your deployment
		</h2>
		<p class="text-muted-foreground mx-auto mb-8 max-w-2xl text-center text-[15px] leading-relaxed">
			Run Eigenmesh as managed-hosted or deploy self-hosted on your own stack. Pay per call — no
			opaque subscription.
		</p>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="border-2 border-black bg-[#FAFAFA] p-5">
				<p class="text-foreground mb-1 text-sm font-semibold">Managed / hosted</p>
				<p class="text-muted-foreground mb-4 text-[13px] leading-relaxed">
					Fastest path to production. We operate infrastructure while you keep full visibility.
				</p>
				<MarketingButton
					href={resolve(signupHref('managed') as Pathname)}
					class="w-full rounded-none"
				>
					{pricingCtaLabel('managed')}
				</MarketingButton>
			</div>
			<div class="border-2 border-black bg-[#FAFAFA] p-5">
				<p class="text-foreground mb-1 text-sm font-semibold">Self-hosted</p>
				<p class="text-muted-foreground mb-4 text-[13px] leading-relaxed">
					Run on your own PostgreSQL, pgvector, and AGE setup with full control of runtime.
				</p>
				<MarketingButton
					variant="outline"
					href={resolve(signupHref('self-hosted') as Pathname)}
					class="w-full rounded-none"
				>
					{pricingCtaLabel('self-hosted')}
				</MarketingButton>
			</div>
		</div>
	</div>
</section>
