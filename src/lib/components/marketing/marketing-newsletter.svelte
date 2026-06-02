<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
	import MarketingButton from '$lib/components/marketing/marketing-button.svelte';
</script>

<section class="mb-20 flex justify-center md:mb-32">
	<div
		use:marketingReveal
		class="bg-secondary w-full max-w-4xl rounded-lg p-8 transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-10 opacity-0 md:p-10"
	>
		<p class="text-muted-foreground mb-2 text-center text-[11px] font-medium uppercase tracking-[0.1em]">
			Get started
		</p>
		<h2 class="text-foreground mb-2 text-center text-xl font-medium tracking-tight">Choose your deployment</h2>
		<p class="text-muted-foreground mx-auto mb-6 max-w-2xl text-center text-sm leading-relaxed">
			Run Eigenmesh as managed-hosted or deploy self-hosted on your own stack.
		</p>
		<div class="grid gap-3 md:grid-cols-2">
			<div class="rounded-lg border border-border bg-background p-5">
				<p class="text-foreground mb-1 text-sm font-semibold">Managed / hosted</p>
				<p class="text-muted-foreground mb-4 text-xs leading-relaxed">
					Fastest path to production. We operate infrastructure while you keep full visibility.
				</p>
				<MarketingButton type="button" class="w-full rounded-[6px]">Start managed</MarketingButton>
			</div>
			<div class="rounded-lg border border-border bg-background p-5">
				<p class="text-foreground mb-1 text-sm font-semibold">Self-hosted</p>
				<p class="text-muted-foreground mb-4 text-xs leading-relaxed">
					Run on your own PostgreSQL, pgvector, and AGE setup with full control of runtime.
				</p>
				<MarketingButton variant="outline" type="button" class="w-full rounded-[6px]">
					Start self-hosted
				</MarketingButton>
			</div>
		</div>
	</div>
</section>
