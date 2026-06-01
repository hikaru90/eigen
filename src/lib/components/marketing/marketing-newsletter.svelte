<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
	import { Input } from '$lib/components/ui/input';

	let email = $state('');
	let previewAcknowledged = $state(false);

	function handlePreviewClick(event: Event) {
		event.preventDefault();
		previewAcknowledged = true;
	}
</script>

<section class="mb-20 flex justify-center md:mb-32">
	<div
		use:marketingReveal
		class="bg-secondary w-full max-w-2xl rounded-lg p-8 text-center transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-10 opacity-0 md:p-10"
	>
		<h2 class="text-foreground mb-2 text-xl font-medium tracking-tight">Get early access</h2>
		<p class="text-muted-foreground mb-5 text-sm leading-relaxed">
			Be first to self-host or try managed. No lock-in, ever.
		</p>

		{#if previewAcknowledged}
			<p class="text-foreground text-sm font-medium" role="status">
				Preview only — newsletter signup is not wired yet. Thanks for your interest.
			</p>
		{:else}
			<form
				class="mx-auto flex max-w-[380px] flex-col gap-2 sm:flex-row"
				onsubmit={handlePreviewClick}
				data-marketing-form="newsletter"
			>
				<Input
					type="email"
					bind:value={email}
					placeholder="your@email.com"
					class="flex-1"
					aria-label="Email address"
				/>
				<MarketingButton type="button" class="shrink-0 rounded-[6px] whitespace-nowrap" onclick={handlePreviewClick}>
					Join waitlist
				</MarketingButton>
			</form>
			<p class="text-muted-foreground mt-3 text-xs">
				UI preview — no data is sent. Backend subscription will be enabled in a future release.
			</p>
		{/if}
	</div>
</section>
