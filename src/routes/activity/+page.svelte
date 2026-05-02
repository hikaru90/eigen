<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto max-w-4xl px-5 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs">Activity</p>
	</header>

	<Card.Root
		class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
	>
		<Card.Header>
			<Card.Title class="text-sm">Per-call costs</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				Base, markup (20%), and total for {data.user.email}.
			</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<table class="w-full text-left text-xs">
				<thead class="bg-muted/50 border-b border-border">
					<tr>
						<th class="p-2 font-medium">When</th>
						<th class="p-2 font-medium">Provider</th>
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
							<td class="p-2">{c.provider}</td>
							<td class="p-2">{c.operation}</td>
							<td class="p-2 font-mono text-[11px]">{c.baseCostUsd}</td>
							<td class="p-2 font-mono text-[11px]">{c.markupUsd}</td>
							<td class="p-2 font-mono text-[11px]">{c.totalCostUsd}</td>
						</tr>
					{:else}
						<tr>
							<td class="text-muted-foreground p-4 text-xs" colspan="6">No calls logged yet.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card.Content>
	</Card.Root>

	<p class="text-muted-foreground mt-8 pb-4 text-center text-[11px]">
		<a class="underline" href={resolve('/capture')}>Capture</a>
		·
		<a class="underline" href={resolve('/')}>Home</a>
	</p>
</div>
