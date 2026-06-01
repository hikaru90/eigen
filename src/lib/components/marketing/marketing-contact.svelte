<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import Send from '@lucide/svelte/icons/send';

	let name = $state('');
	let company = $state('');
	let email = $state('');
	let message = $state('');
	let previewAcknowledged = $state(false);

	function handlePreviewClick(event: Event) {
		event.preventDefault();
		previewAcknowledged = true;
	}
</script>

<section class="py-16 md:py-24">
	<div class="marketing-container">
		<div
			use:marketingReveal
			class="mx-auto max-w-2xl border-2 border-white/25 bg-black p-8 text-white shadow-[8px_8px_0px_0px_rgb(255_255_255/0.12)] transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-10 opacity-0 md:p-10"
		>
			<h2 class="mb-2 text-2xl font-semibold tracking-tight">Questions or teams?</h2>
			<p class="mb-6 text-sm text-white/85">
				Ask about early access, running Mesh for your organization, or anything else—we read every
				message.
			</p>

			{#if previewAcknowledged}
				<p class="text-sm font-medium" role="status">
					Preview only — contact form is not wired yet. We will enable submissions in a future release.
				</p>
			{:else}
				<form class="space-y-4" onsubmit={handlePreviewClick} data-marketing-form="contact">
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="contact-name" class="mb-1 block text-xs font-medium text-white/90">Name</label>
							<Input
								id="contact-name"
								bind:value={name}
								placeholder="Your name"
								class="border-white/20 bg-white/10 text-white placeholder:text-white/50"
							/>
						</div>
						<div>
							<label for="contact-company" class="mb-1 block text-xs font-medium text-white/90"
								>Organization (optional)</label
							>
							<Input
								id="contact-company"
								bind:value={company}
								placeholder="Company or team"
								class="border-white/20 bg-white/10 text-white placeholder:text-white/50"
							/>
						</div>
					</div>
					<div>
						<label for="contact-email" class="mb-1 block text-xs font-medium text-white/90">Email</label>
						<Input
							id="contact-email"
							type="email"
							bind:value={email}
							placeholder="you@example.com"
							class="border-white/20 bg-white/10 text-white placeholder:text-white/50"
						/>
					</div>
					<div>
						<label for="contact-message" class="mb-1 block text-xs font-medium text-white/90"
							>Message</label
						>
						<Textarea
							id="contact-message"
							bind:value={message}
							rows={4}
							placeholder="What would you like to know?"
							class="border-white/20 bg-white/10 text-white placeholder:text-white/50"
						/>
					</div>
					<MarketingButton
						type="button"
						variant="secondary"
						surface="dark"
						class="rounded-[6px]"
						onclick={handlePreviewClick}
					>
						<Send class="mr-2 size-3.5" strokeWidth={1.75} />
						Preview send
					</MarketingButton>
					<p class="text-xs text-white/75">UI preview — no data is sent.</p>
				</form>
			{/if}
		</div>
	</div>
</section>
