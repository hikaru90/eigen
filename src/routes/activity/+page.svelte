<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import AiDateRangePicker from '$lib/components/ai-date-range-picker.svelte';
	import { formatDateRange } from '$lib/utils/date-utils';
	import { formatActivityCredits } from '$lib/billing/platform-pricing';
	import ActivitySpendChart from './ActivitySpendChart.svelte';

	let { data }: { data: PageData } = $props();

	function sumTotalUsd(calls: Call[]): string {
		let total = 0;
		for (const c of calls) {
			total += Number(c.totalCostUsd);
		}
		return total.toFixed(6);
	}

	/** Short label from gateway hostname (e.g. `openrouter` from `api.openrouter.ai`). */
	function endpointLabelFromHost(hostname: string): string {
		const h = hostname.trim().toLowerCase().replace(/^www\./, '');
		const parts = h.split('.').filter(Boolean);
		if (parts.length === 0) return h;
		if (parts.length === 1) return parts[0];
		if (parts.length === 2) return parts[0];
		return parts[parts.length - 2] ?? parts[0];
	}

	function groupProviderLabel(calls: Call[]): { label: string; isPaid: boolean } {
		const first = calls[0];
		if (first.provider === 'agent') return { label: 'Agent', isPaid: false };
		const host = first.gatewayHost?.trim();
		if (host) return { label: endpointLabelFromHost(host), isPaid: true };
		return { label: 'Paid gateway', isPaid: true };
	}

	function formatDuration(ms: number | null | undefined): string {
		if (ms == null) return '\u2014';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(2)}s`;
	}

	function totalDurationMs(calls: Call[]): number | null {
		let total = 0;
		let hasAny = false;
		for (const c of calls) {
			if (c.durationMs != null) {
				total += c.durationMs;
				hasAny = true;
			}
		}
		return hasAny ? total : null;
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
		url.searchParams.delete('page');
		return url.pathname + url.search;
	}

	function pageUrl(nextPage: number): string {
		const url = new URL(page.url);
		if (nextPage <= 1) {
			url.searchParams.delete('page');
		} else {
			url.searchParams.set('page', String(nextPage));
		}
		return url.pathname + url.search;
	}

	const isGateway = $derived(currentFilter === 'gateway' || currentFilter === 'all');
	const showOverall = $derived(isGateway && data.overallTotals);
	const gatewayColspan = 5;

	type Call = PageData['calls'][number];

	const grouped = $derived.by(() => {
		const groups: Array<{ groupId: string | null; calls: Call[]; firstOp: string; groupTotalUsd: string }> = [];
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
			groups.push({
				groupId,
				calls: list,
				firstOp: list[0].operation,
				groupTotalUsd: sumTotalUsd(list)
			});
		}

		return groups;
	});

	const rangeLabel = $derived(formatDateRange(data.from, data.to));
	const overallCredits = $derived(formatActivityCredits(data.overallTotals.totalCostUsd));
	const pageTotalCredits = $derived(formatActivityCredits(data.totals.totalCostUsd));
	const availableCreditsLabel = $derived(data.walletAvailableCredits.toLocaleString('en-US'));
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
					{f === 'all' ? 'All' : f === 'gateway' ? 'Paid' : 'Free'}
				</Button>
			</a>
		{/each}
	</div>

	<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card">
		<Card.Content class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium">Available credits:</span>
				<span class="font-mono text-sm font-semibold tabular-nums">{availableCreditsLabel}</span>
			</div>
			{#if showOverall}
				<div class="flex items-center gap-4 sm:justify-end">
					<div class="flex items-center gap-2">
						<span class="text-xs font-medium">Total spend (credits):</span>
						<span class="font-mono text-sm font-semibold tabular-nums">{overallCredits}</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-muted-foreground text-[11px]">{rangeLabel}</span>
						<AiDateRangePicker from={data.from} to={data.to} />
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if showOverall && data.spendSeries}
		<ActivitySpendChart buckets={data.spendSeries.buckets} unit={data.spendSeries.unit} />
	{/if}

	<Card.Root
		class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card"
	>
		<Card.Header>
			<Card.Title class="text-sm">
				{currentFilter === 'gateway' ? 'Paid gateway usage' : currentFilter === 'agent' ? 'Agent tool calls' : 'All activity'}
			</Card.Title>
			<Card.Description class="text-muted-foreground text-xs">
				{#if currentFilter === 'gateway'}
					Billable LLM gateway calls (chat, embeddings, and speech-to-text) in Eigen credits.
				{:else if currentFilter === 'agent'}
					Internal agent tool calls (free, zero-cost operations).
				{:else}
					All activity — paid gateway calls in Eigen credits; free agent tool calls shown with zero cost.
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
							<th class="p-2 font-medium">Credits</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each grouped as group}
						{@const prov = groupProviderLabel(group.calls)}
						{@const groupLabel = group.firstOp.replace(/\.(success|error)\(.*\)$/, '')}
						{@const context = group.calls.find(c => c.context)?.context}
						{@const dur = totalDurationMs(group.calls)}
						<tr class="border-b border-border/60">
							<td class="p-2 whitespace-nowrap">{formatDate(group.calls[0].createdAt)}</td>
							<td class="p-2">
								<span class="inline-flex items-center gap-1">
									{#if prov.isPaid}
										<span class="text-destructive">●</span>
									{:else}
										<span class="text-green-600">●</span>
									{/if}
									{prov.label}
								</span>
							</td>
							<td class="p-2">
								<span class="font-mono text-[11px] truncate max-w-[250px] block">{groupLabel}</span>
								{#if context}
									<span class="text-[10px] text-muted-foreground truncate max-w-[250px] block">{context}</span>
								{/if}
							</td>
							<td class="p-2 font-mono text-[11px] text-muted-nowrap">{formatDuration(dur)}</td>
							{#if isGateway}
								<td class="p-2 font-mono text-[11px] tabular-nums">{formatActivityCredits(group.groupTotalUsd)}</td>
							{/if}
						</tr>
					{:else}
						<tr>
							<td class="text-muted-foreground p-4 text-xs" colspan={isGateway ? gatewayColspan : 4}>
								{currentFilter === 'gateway' ? 'No paid gateway calls logged yet.' : currentFilter === 'agent' ? 'No agent tool calls logged yet.' : 'No activity logged yet.'}
							</td>
						</tr>
					{/each}
				</tbody>
				{#if isGateway}
					<tfoot class="border-t-2 border-border bg-muted/30">
						<tr>
							<td class="p-2 text-right text-xs font-medium" colspan="4">Total (this page)</td>
							<td class="p-2 font-mono text-[11px] tabular-nums">{pageTotalCredits}</td>
						</tr>
					</tfoot>
				{/if}
			</table>
		</Card.Content>
	</Card.Root>

	{#if data.pagination.totalPages > 1}
		<div class="mt-4 flex items-center justify-center gap-3">
			{#if data.pagination.hasPrev}
				<a href={pageUrl(data.pagination.page - 1)}>
					<Button variant="outline" size="xs">Previous</Button>
				</a>
			{/if}
			<span class="text-muted-foreground text-xs">
				Page {data.pagination.page} of {data.pagination.totalPages}
				({data.pagination.totalCount} entries)
			</span>
			{#if data.pagination.hasNext}
				<a href={pageUrl(data.pagination.page + 1)}>
					<Button variant="outline" size="xs">Next</Button>
				</a>
			{/if}
		</div>
	{/if}
</div>
