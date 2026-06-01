<script lang="ts">
	import MarketingShell from '$lib/components/marketing/marketing-shell.svelte';
</script>

<svelte:head>
	<title>Imprint — Eigen Mesh</title>
	<meta name="description" content="Legal imprint and contact information for Eigen Mesh." />
</svelte:head>

<MarketingShell title="Imprint" description="Legal information and contact details.">
	<section class="space-y-6 text-sm leading-relaxed">
		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">Operator</h2>
			<p class="text-muted-foreground">
				Eigen Mesh — self-hostable memory infrastructure.<br />
				Replace this section with your legal entity name, registered address, and registration details
				before public launch in jurisdictions that require an imprint.
			</p>
		</div>

		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">Contact</h2>
			<p class="text-muted-foreground">
				For product inquiries, use the contact form on the homepage (preview mode until backend wiring is
				enabled) or your deployment operator's support channel.
			</p>
		</div>

		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">Responsible for content</h2>
			<p class="text-muted-foreground">
				Content on this marketing site describes the Eigen Mesh product. Application data is controlled
				by the account holder or self-host operator.
			</p>
		</div>
	</section>
</MarketingShell>
