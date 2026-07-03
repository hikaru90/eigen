<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import AiDateRangePicker from '$lib/components/ai-date-range-picker.svelte';
	import { formatActivityCredits } from '$lib/billing/platform-pricing';
	import ActivitySpendChart from './ActivitySpendChart.svelte';
	import {
		callTimestampBounds,
		chooseActivitySpendBucketUnit,
		computeActivitySpendSpan,
		fillActivitySpendBuckets,
		startOfUtcPeriod,
		utcDateKey,
		type ActivitySpendBucket
	} from '$lib/activity/spend-chart';


	let { data } = $props();

	let fromDate = $state<string | null>(null);
	let toDate = $state<string | null>(null);
	const gatewayProviderSet = $derived(new Set(data.gatewayProviders));

	$effect(() => {
		fromDate = data.from;
		toDate = data.to;
	});
	let allCalls = $state<any[]>([]);
	let isLoading = $state(true);
	let loadError = $state('');
	let expandedGroups = $state<Record<string, boolean>>({});
	let currentPage = $state(1);

	const PAGE_SIZE = 20;

	function toggleGroup(groupId: string) {
		expandedGroups = { ...expandedGroups, [groupId]: !expandedGroups[groupId] };
	}

	function sumTotalUsd(calls: any[]): string {
		let total = 0;
		for (const c of calls) total += Number(c.totalCostUsd);
		return total.toFixed(6);
	}

	function endpointLabelFromHost(hostname: string): string {
		const h = hostname.trim().toLowerCase().replace(/^www\./, '');
		const parts = h.split('.').filter(Boolean);
		if (parts.length <= 2) return parts[0] ?? h;
		return parts[parts.length - 2] ?? parts[0];
	}

	function groupProviderLabel(calls: any[]): { label: string; isPaid: boolean } {
		const first = calls[0];
		if (first.provider === 'agent') return { label: 'Agent', isPaid: false };
		const host = first.gatewayHost?.trim();
		if (host) return { label: endpointLabelFromHost(host), isPaid: true };
		return { label: 'Gateway', isPaid: true };
	}

	function formatDuration(ms: number | null | undefined): string {
		if (ms == null) return '\u2014';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(2)}s`;
	}

	function totalDurationMs(calls: any[]): number | null {
		let total = 0;
		let hasAny = false;
		for (const c of calls) {
			if (c.durationMs != null) { total += c.durationMs; hasAny = true; }
		}
		return hasAny ? total : null;
	}

	const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

	function formatDate(value: unknown): string {
		if (value instanceof Date) return timeFmt.format(value);
		if (typeof value === 'string' || typeof value === 'number') {
			const d = new Date(value);
			if (!Number.isNaN(d.getTime())) return timeFmt.format(d);
		}
		return String(value);
	}

	// --- Derived: filter calls by date range ---
	const filteredCalls = $derived(
		allCalls.filter((c) => {
			const d = new Date(c.createdAt);
			if (fromDate && d < new Date(fromDate)) return false;
			if (toDate && d > new Date(toDate)) return false;
			return true;
		})
	);

	// --- Derived: group filtered calls ---
	const grouped = $derived.by(() => {
		const groups: Array<{ key: string; groupId: string | null; calls: any[]; firstOp: string; groupTotalUsd: string }> = [];
		const groupMap = new Map<string, any[]>();
		const order: string[] = [];

		for (const c of filteredCalls) {
			const key = c.groupId ?? `__ungrouped__${c.id}`;
			let list = groupMap.get(key);
			if (!list) { list = []; groupMap.set(key, list); order.push(key); }
			list.push(c);
		}

		for (const key of order) {
			const list = groupMap.get(key)!;
			list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
			groups.push({
				key,
				groupId: key.startsWith('__ungrouped__') ? null : key,
				calls: list,
				firstOp: list[0].operation,
				groupTotalUsd: sumTotalUsd(list)
			});
		}
		return groups;
	});

	// --- Derived: client-side pagination ---
	const totalPages = $derived(Math.max(1, Math.ceil(grouped.length / PAGE_SIZE)));

	const pagedGroups = $derived.by(() => {
		const safePage = Math.min(currentPage, totalPages);
		const startIdx = (safePage - 1) * PAGE_SIZE;
		return grouped.slice(startIdx, startIdx + PAGE_SIZE);
	});



	// --- Derived: totals ---
	const pageTotals = $derived.by(() => {
		let base = 0;
		let markup = 0;
		let total = 0;
		for (const g of pagedGroups) {
			for (const c of g.calls) {
				base += Number(c.baseCostUsd);
				markup += Number(c.markupUsd);
				total += Number(c.totalCostUsd);
			}
		}
		return { baseCostUsd: base.toFixed(6), markupUsd: markup.toFixed(6), totalCostUsd: total.toFixed(6) };
	});

	const overallTotals = $derived.by(() => {
		let base = 0;
		let markup = 0;
		let total = 0;
		for (const c of filteredCalls) {
			if (gatewayProviderSet.has(c.provider) && Number(c.totalCostUsd) > 0) {
				base += Number(c.baseCostUsd);
				markup += Number(c.markupUsd);
				total += Number(c.totalCostUsd);
			}
		}
		return { baseCostUsd: base.toFixed(6), markupUsd: markup.toFixed(6), totalCostUsd: total.toFixed(6) };
	});

	const showOverall = $derived(Number(overallTotals.totalCostUsd) > 0);

	// --- Derived: spend series (client-side) ---
	const spendSeries = $derived.by(() => {
		const gatewayCalls = filteredCalls.filter(
			(c) => gatewayProviderSet.has(c.provider) && Number(c.totalCostUsd) > 0
		);
		if (gatewayCalls.length === 0) return null;

		const { earliest: earliestCallAt, latest: latestCallAt } = callTimestampBounds(gatewayCalls);
		const allTime = !fromDate && !toDate;

		const span = computeActivitySpendSpan({
			from: fromDate ? new Date(fromDate) : null,
			to: toDate ? new Date(toDate) : null,
			earliestCallAt: allTime || !fromDate ? earliestCallAt : null,
			latestCallAt: allTime || !toDate ? latestCallAt : null
		});
		const unit = chooseActivitySpendBucketUnit(span.spanDays);

		const byPeriod = new Map<string, { totalCostUsd: number; callCount: number }>();
		for (const c of gatewayCalls) {
			const d = new Date(c.createdAt);
			const periodDate = startOfUtcPeriod(d, unit);
			const key = utcDateKey(periodDate);
			const existing = byPeriod.get(key) ?? { totalCostUsd: 0, callCount: 0 };
			existing.totalCostUsd += Number(c.totalCostUsd);
			existing.callCount += 1;
			byPeriod.set(key, existing);
		}

		const distinctGroupIds = new Set(filteredCalls.map((c) => c.groupId ?? `__ungrouped__${c.id}`));
		const totalGroups = distinctGroupIds.size;
		const totalCalls = gatewayCalls.length;

		const normalized: ActivitySpendBucket[] = [];
		for (const [key, val] of byPeriod) {
			normalized.push({
				periodStart: key,
				totalCostUsd: val.totalCostUsd.toFixed(6),
				callCount: val.callCount,
				groupCount: totalCalls > 0 ? Math.round((val.callCount / totalCalls) * totalGroups) : 0
			});
		}

		const buckets = fillActivitySpendBuckets(normalized, span.from, span.to, unit);
		return { unit, buckets, totalGroups };
	});

	// --- Derived: display labels ---
	const pageTotalCredits = $derived(formatActivityCredits(pageTotals.totalCostUsd));
	const availableCreditsLabel = $derived(data.walletAvailableCredits.toLocaleString('en-US'));

	// --- Fetch all data once on mount ---
	onMount(async () => {
		try {
			const res = await fetch('/api/activity', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from: null, to: null, returnAll: true })
			});
			if (res.ok) {
				const json = await res.json();
				allCalls = json.calls ?? [];
			} else {
				loadError = await res.text();
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	});
</script>

<div class="mx-auto max-w-4xl px-5 pb-8 pt-10">
	<header class="text-center">
		<p class="text-muted-foreground mt-2 text-xs">Activity</p>
	</header>

	<div class="mt-4 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<span class="text-xs font-medium">Available credits:</span>
			<span class="font-mono text-sm font-semibold tabular-nums">{availableCreditsLabel}</span>
		</div>
		<AiDateRangePicker from={fromDate ?? undefined} to={toDate ?? undefined} onChange={(f, t) => { fromDate = f; toDate = t; currentPage = 1; }} />
	</div>

	{#if isLoading}
		<p class="text-muted-foreground py-8 text-center text-xs">Loading activity…</p>
	{:else if loadError}
		<p class="py-8 text-center text-xs text-red-500">{loadError}</p>
	{:else}
		{#if showOverall && spendSeries}
			<ActivitySpendChart
				buckets={spendSeries.buckets}
				unit={spendSeries.unit}
				totalGroups={spendSeries.totalGroups}
			/>
		{/if}

		<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card">
			<Card.Header>
				<Card.Title class="text-sm">Activity log</Card.Title>
				<Card.Description class="text-muted-foreground text-xs">
					All LLM gateway calls and agent tool operations.
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
							<th class="p-2 font-medium">Credits</th>
						</tr>
					</thead>
					<tbody>
						{#each pagedGroups as group}
							{@const prov = groupProviderLabel(group.calls)}
							{@const groupLabel = group.firstOp.replace(/\.(success|error)\(.*\)$/, '')}
							{@const context = group.calls.find((c: any) => c.context)?.context}
							{@const dur = totalDurationMs(group.calls)}
							{@const isExpanded = !!expandedGroups[group.key]}
							{@const hasMultipleCalls = group.calls.length > 1}

							<tr
								class="border-b border-border/60 {hasMultipleCalls ? 'cursor-pointer hover:bg-muted/50' : ''}"
								onclick={() => hasMultipleCalls && toggleGroup(group.key)}
							>
								<td class="p-2 whitespace-nowrap">
									{#if hasMultipleCalls}
										<span class="inline-block w-4 text-muted-foreground text-[10px]">{isExpanded ? '▼' : '▶'}</span>
									{/if}
									{formatDate(group.calls[0].createdAt)}
								</td>
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
									{#if hasMultipleCalls}
										<span class="text-[10px] text-muted-foreground">({group.calls.length} calls)</span>
									{/if}
								</td>
								<td class="p-2 font-mono text-[11px] text-muted-nowrap">{formatDuration(dur)}</td>
								<td class="p-2 font-mono text-[11px] tabular-nums">{formatActivityCredits(group.groupTotalUsd)}</td>
							</tr>

							{#if isExpanded && hasMultipleCalls}
								{#each group.calls as call}
									{@const callProv = groupProviderLabel([call])}
									<tr class="border-b border-border/30 bg-muted/20">
										<td class="p-2 pl-8 whitespace-nowrap text-muted-foreground">{formatDate(call.createdAt)}</td>
										<td class="p-2 text-muted-foreground">
											<span class="inline-flex items-center gap-1">
												{#if callProv.isPaid}
													<span class="text-destructive">●</span>
												{:else}
													<span class="text-green-600">●</span>
												{/if}
												{callProv.label}
											</span>
										</td>
										<td class="p-2">
											<span class="font-mono text-[10px] truncate max-w-[250px] block text-muted-foreground">{call.operation}</span>
											{#if call.context}
												<span class="text-[9px] text-muted-foreground/70 truncate max-w-[250px] block">{call.context}</span>
											{/if}
										</td>
										<td class="p-2 font-mono text-[11px] text-muted-nowrap">{formatDuration(call.durationMs)}</td>
										<td class="p-2 font-mono text-[11px] tabular-nums">{formatActivityCredits(call.totalCostUsd)}</td>
									</tr>
								{/each}
							{/if}
						{:else}
							<tr>
								<td class="text-muted-foreground p-4 text-xs" colspan="5">No activity logged yet.</td>
							</tr>
						{/each}
					</tbody>
					<tfoot class="border-t-2 border-border bg-muted/30">
						<tr>
							<td class="p-2 text-right text-xs font-medium" colspan="4">Total (this page)</td>
							<td class="p-2 font-mono text-[11px] tabular-nums">{pageTotalCredits}</td>
						</tr>
					</tfoot>
				</table>
			</Card.Content>
		</Card.Root>

		{#if totalPages > 1}
			<div class="mt-4 flex items-center justify-center gap-3">
				{#if currentPage > 1}
					<button onclick={() => { currentPage = currentPage - 1; }}>
						<Button variant="outline" size="xs">Previous</Button>
					</button>
				{/if}
				<span class="text-muted-foreground text-xs">
					Page {currentPage} of {totalPages}
					({grouped.length} groups)
				</span>
				{#if currentPage < totalPages}
					<button onclick={() => { currentPage = currentPage + 1; }}>
						<Button variant="outline" size="xs">Next</Button>
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>
