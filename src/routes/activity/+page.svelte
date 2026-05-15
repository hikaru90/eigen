<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import AiDateRangePicker from '$lib/components/ai-date-range-picker.svelte';
	import { formatDateRange } from '$lib/utils/date-utils';

	let { data }: { data: PageData } = $props();

	const usd = new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 6
	});

	function providerLabel(provider: string): string {
		switch (provider) {
			case 'eurouter':
			case 'llm':
				return 'EuRouter';
			case 'agent':
				return 'Agent';
			default:
				return provider;
		}
	}

	function formatDuration(ms: number | null | undefined): string {
		if (ms == null) return '\u2014';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(2)}s`;
	}

	const currentFilter = $derived(data.filter ?? 'all');

	const timeFmt = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'medium'
	});

	function formatDate(value: unknown): string {
		if (value instanceof Date) return timeFmt.format(value);
		if (typeof value === 'string' || typeof value === 'number') {
			const d = new Date(value);
			if (!Number.isNaN(d.getTime())) return timeFmt.format(d);
		}
		return String(value);
	}

	function filterUrl(type: string): string {
		const url = new URL(page.url);
		url.searchParams.set('type', type);
		return url.pathname + url.search;
	}

	const isGateway = $derived(currentFilter === 'gateway' || currentFilter === 'all');
	const showOverall = $derived(isGateway && data.overallTotals);

	type Call = PageData['calls'][number];

	const grouped = $derived.by(() => {
		const groups: Array<{ groupId: string | null; calls: Call[]; firstOp: string; groupTotal: number }> = [];
		const groupMap = new Map<string, Call[]>();
		const order: string[] = [];

		for (const c of data.calls) {
			const key = c.groupId ?? `__ungrouped__${c.id}`;
			let list = groupMap.get(key);
			if (!list) {
				list = [];
				groupMap.set(key, list);
				order.push(key);
			}
			list.push(c);
		}

		for (const key of order) {
			const list = groupMap.get(key)!;
			list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
			const groupId = key.startsWith('__ungrouped__') ? null : key;
			const groupTotal = list.reduce((sum, c) => sum + Number(c.totalCostUsd), 0);
			groups.push({ groupId, calls: list, firstOp: list[0].operation, groupTotal });
		}

		return groups;
	});

	const rangeLabel = $derived(formatDateRange(data.from, data.to));
</script>

<div class="mx-auto max-w-4xl px-5 pb-8 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs">Activity</p>
	</header>

	<div class="mt-4 flex items-center justify-center gap-1">
		{#each ['all', 'gateway', 'agent'] as f}
			<a href={filterUrl(f)}>
				<Button
					variant={currentFilter === f ? 'default' : 'outline'}
					size="xs"
					class="capitalize"
				>
					{f === 'all' ? 'All' : f === 'gateway' ? 'EuRouter (paid)' : 'Agent (free)'}
				</Button>
			</a>
		{/each}
	</div>

	{#if showOverall}
		<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card">
			<Card.Content class="flex items-center justify-between px-4 py-3">
				<div class="flex items-center gap-2">
					<span class="text-xs font-medium">Total spend:</span>
					<span class="font-mono text-sm font-semibold">{usd.format(Number(data.overallTotals.totalCostUsd))}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-muted-foreground text-[11px]">{rangeLabel}</span>
					<AiDateRangePicker from={data.from} to={data.to} />
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root
		class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card"
	>
		<Card.Header>
			<Card.Title class="text-sm">
				{currentFilter === 'gateway' ? 'EuRouter usage' : currentFilter === 'agent' ? 'Agent tool calls' : 'All activity'}
			</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				{#if currentFilter === 'gateway'}
					LLM gateway calls (chat and embeddings). Per AC-014 and AC-015: base cost, 20% markup, and total for {data.user.email}.
				{:else if currentFilter === 'agent'}
					Internal agent tool calls (free, zero-cost operations).
				{:else}
					All activity — paid (EuRouter) and free (agent tool calls).
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<table class="w-full text-left text-xs">
				<thead class="bg-muted/50 border-b border-border">
					<tr>
						<th class="p-2 font-medium">When</th>
						<th class="p-2 font-medium">Provider</th>
						<th class="p-2 font-medium">Operation</th>
						<th class="p-2 font-medium">Duration</th>
						{#if isGateway}
							<th class="p-2 font-medium">Base USD</th>
							<th class="p-2 font-medium">Markup USD</th>
							<th class="p-2 font-medium">Total USD</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each grouped as group}
						{#if group.groupId && grouped.length > 1}
							{@const groupLabel = group.firstOp.replace(/\.(success|error)\(.*\)$/, '')}
							{@const groupContext = group.calls.find(c => c.context)?.context}
							<tr class="bg-muted/20 border-b border-border/40">
								<td class="p-2 whitespace-nowrap text-[11px] text-muted-foreground" colspan="{isGateway ? 7 : 4}">
									<span class="flex items-center justify-between">
										<span class="flex items-center gap-2 min-w-0">
											<span class="truncate font-mono shrink-0">{groupLabel}</span>
											{#if groupContext}
												<span class="truncate text-muted-foreground/70 max-w-[300px]">{groupContext}</span>
											{/if}
										</span>
										<span class="ml-2 shrink-0">
											{group.calls.length > 1 ? `${group.calls.length} calls` : ''}
											{#if isGateway}
												· {usd.format(group.groupTotal)}
											{/if}
										</span>
									</span>
								</td>
							</tr>
						{/if}
						{#each group.calls as c, ci (c.id)}
							{@const prov = providerLabel(c.provider)}
							<tr class="border-b border-border/60">
								<td class="p-2 whitespace-nowrap">{ci === 0 ? formatDate(c.createdAt) : ''}</td>
								<td class="p-2">
									<span class="inline-flex items-center gap-1">
										{#if prov === 'EuRouter'}
											<span class="text-destructive">●</span>
										{:else}
											<span class="text-green-600">●</span>
										{/if}
										{prov}
									</span>
								</td>
								<td class="p-2">
									<div class="flex flex-col gap-0.5">
										<div class="font-mono text-[11px]">
											{#if group.groupId && group.calls.length > 1}
												<span class="text-muted-foreground mr-1">&#x2514;</span>
											{/if}
											{c.operation}
										</div>
										{#if c.context}
											<div class="text-[10px] text-muted-foreground truncate max-w-[250px]">{c.context}</div>
										{/if}
									</div>
								</td>
								<td class="p-2 font-mono text-[11px] text-muted-foreground">{formatDuration(c.durationMs)}</td>
								{#if isGateway}
									<td class="p-2 font-mono text-[11px]">{usd.format(Number(c.baseCostUsd))}</td>
									<td class="p-2 font-mono text-[11px]">{usd.format(Number(c.markupUsd))}</td>
									<td class="p-2 font-mono text-[11px]">{usd.format(Number(c.totalCostUsd))}</td>
								{/if}
							</tr>
						{/each}
					{:else}
						<tr>
							<td class="text-muted-foreground p-4 text-xs" colspan="{isGateway ? 7 : 4}">
								{currentFilter === 'gateway' ? 'No EuRouter calls logged yet.' : currentFilter === 'agent' ? 'No agent tool calls logged yet.' : 'No activity logged yet.'}
							</td>
						</tr>
					{/each}
				</tbody>
				{#if isGateway}
					<tfoot class="border-t-2 border-border bg-muted/30">
						<tr>
							<td class="p-2 text-right text-xs font-medium" colspan="4">Total (this page)</td>
							<td class="p-2 font-mono text-[11px]">{usd.format(Number(data.totals.baseCostUsd))}</td>
							<td class="p-2 font-mono text-[11px]">{usd.format(Number(data.totals.markupUsd))}</td>
							<td class="p-2 font-mono text-[11px]">{usd.format(Number(data.totals.totalCostUsd))}</td>
						</tr>
					</tfoot>
				{/if}
			</table>
		</Card.Content>
	</Card.Root>


</div>
