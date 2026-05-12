<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';

	let { data }: { data: PageData } = $props();

	const usd = new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 6
	});

	function providerLabel(provider: string): string {
		if (provider === 'eurouter' || provider === 'llm') return 'EuRouter';
		return provider;
	}
</script>

<div class="mx-auto max-w-4xl px-5 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs">Activity</p>
	</header>

	<Card.Root
		class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
	>
		<Card.Header>
			<Card.Title class="text-sm">EuRouter usage</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				LLM gateway calls only (chat and embeddings). Per AC-014 and AC-015: base cost, 20% markup, and total
				for {data.user.email}.
			</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<table class="w-full text-left text-xs">
				<thead class="bg-muted/50 border-b border-border">
					<tr>
						<th class="p-2 font-medium">When</th>
						<th class="p-2 font-medium">Gateway</th>
						<th class="p-2 font-medium">Operation</th>
						<th class="p-2 font-medium">Base USD</th>
						<th class="p-2 font-medium">Markup USD</th>
						<th class="p-2 font-medium">Total USD</th>
					</tr>
				</thead>
				<tbody>
					{#each data.calls as c (c.id)}
						<tr class="border-b border-border/60">
							<td class="p-2 whitespace-nowrap">{c.createdAt?.toISOString?.() ?? String(c.createdAt)}</td>
							<td class="p-2">{providerLabel(c.provider)}</td>
							<td class="p-2">{c.operation}</td>
							<td class="p-2 font-mono text-[11px]">{usd.format(Number(c.baseCostUsd))}</td>
							<td class="p-2 font-mono text-[11px]">{usd.format(Number(c.markupUsd))}</td>
							<td class="p-2 font-mono text-[11px]">{usd.format(Number(c.totalCostUsd))}</td>
						</tr>
					{:else}
						<tr>
							<td class="text-muted-foreground p-4 text-xs" colspan="6">No EuRouter calls logged yet.</td>
						</tr>
					{/each}
				</tbody>
				<tfoot class="border-t-2 border-border bg-muted/30">
					<tr>
						<td class="p-2 text-right text-xs font-medium" colspan="3">Total (this page)</td>
						<td class="p-2 font-mono text-[11px]">{usd.format(Number(data.totals.baseCostUsd))}</td>
						<td class="p-2 font-mono text-[11px]">{usd.format(Number(data.totals.markupUsd))}</td>
						<td class="p-2 font-mono text-[11px]">{usd.format(Number(data.totals.totalCostUsd))}</td>
					</tr>
				</tfoot>
			</table>
		</Card.Content>
	</Card.Root>

	<p class="text-muted-foreground mt-8 pb-4 text-center text-[11px]">
		<a class="underline" href={resolve('/capture')}>Capture</a>
		·
		<a class="underline" href={resolve('/')}>Home</a>
	</p>
</div>
