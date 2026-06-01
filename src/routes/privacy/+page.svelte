<script lang="ts">
	import MarketingShell from '$lib/components/marketing/marketing-shell.svelte';
</script>

<svelte:head>
	<title>Privacy — Eigen Mesh</title>
	<meta name="description" content="Privacy policy and data handling for Eigen Mesh." />
</svelte:head>

<MarketingShell
	title="Privacy"
	description="How Eigen Mesh handles your data, embeddings, and tenant isolation."
>
	<section class="space-y-6 text-sm leading-relaxed">
		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">Overview</h2>
			<p class="text-muted-foreground">
				Eigen Mesh stores thoughts, metadata, graph relationships, and embeddings in your PostgreSQL
				database. Data is scoped per user with row-level security policies.
			</p>
		</div>

		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">Embeddings</h2>
			<p class="text-muted-foreground">
				Vector embeddings are computed and stored for retrieval. They are not returned in MCP tool
				results, agent messages, or client API payloads intended for display.
			</p>
		</div>

		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">LLM usage</h2>
			<p class="text-muted-foreground">
				When you use assistant features, text fields required for the task may be sent to configured LLM
				providers. Usage is logged with transparent per-call cost reporting where enabled.
			</p>
		</div>

		<div>
			<h2 class="text-foreground mb-2 text-base font-semibold">Self-hosting</h2>
			<p class="text-muted-foreground">
				When self-hosted, your deployment operator controls infrastructure, backups, and access
				policies. This document describes product behavior; your operator may publish additional terms.
			</p>
		</div>

		<p class="text-muted-foreground text-xs">
			This page is a product summary placeholder. Replace with counsel-reviewed policy before production
			launch.
		</p>
	</section>
</MarketingShell>
