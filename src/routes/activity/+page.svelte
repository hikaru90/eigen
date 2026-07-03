<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import AiDateRangePicker from '$lib/components/ai-date-range-picker.svelte';
	import { formatDateRange } from '$lib/utils/date-utils';
	import { formatActivityCredits } from '$lib/billing/platform-pricing';
	import ActivitySpendChart from './ActivitySpendChart.svelte';

	let { data } = $props();

	let fromDate = $state<string | null>(data.from);
	let toDate = $state<string | null>(data.to);
	let activityData = $state(data);
	let expandedGroups = $state<Record<string, boolean>>({});

	function toggleGroup(groupId: string) {
		expandedGroups = { ...expandedGroups, [groupId]: !expandedGroups[groupId] };
	}

	function sumTotalUsd(calls: Call[]): string {
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

	function groupProviderLabel(calls: Call[]): { label: string; isPaid: boolean } {
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

	function totalDurationMs(calls: Call[]): number | null {
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

	const showOverall = $derived(!!activityData.overallTotals);

	type Call = typeof activityData.calls[number];

	const grouped = $derived.by(() => {
		const groups: Array<{ key: string; groupId: string | null; calls: Call[]; firstOp: string; groupTotalUsd: string }> = [];
		const groupMap = new Map<string, Call[]>();
		const order: string[] = [];

		for (const c of activityData.calls) {
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

	const rangeLabel = $derived(formatDateRange(fromDate, toDate));
	const overallCredits = $derived(formatActivityCredits(activityData.overallTotals.totalCostUsd));
	const pageTotalCredits = $derived(formatActivityCredits(activityData.totals.totalCostUsd));
	const availableCreditsLabel = $derived(activityData.walletAvailableCredits.toLocaleString('en-US'));

	let fetchController: AbortController | null = null;

	async function fetchData(from: string | null, to: string | null, page = 1) {
		fetchController?.abort();
		fetchController = new AbortController();

		try {
			const res = await fetch('/api/activity', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from, to, page }),
				signal: fetchController.signal
			});
			if (res.ok) {
				const json = await res.json();
				activityData = { ...activityData, ...json };
				expandedGroups = {};
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			throw e;
		}
	}

	$effect(() => {
		const from = fromDate;
		const to = toDate;
		fetchData(from, to, 1);
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
		<div class="flex items-center gap-2">
			<span class="text-muted-foreground text-[11px]">{rangeLabel}</span>
			<AiDateRangePicker from={fromDate} to={toDate} onChange={(f, t) => { fromDate = f; toDate = t; }} />
		</div>
	</div>

	{#if showOverall && activityData.spendSeries}
		<ActivitySpendChart
			buckets={activityData.spendSeries.buckets}
			unit={activityData.spendSeries.unit}
			totalGroups={activityData.spendSeries.totalGroups}
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
					{#each grouped as group}
						{@const prov = groupProviderLabel(group.calls)}
						{@const groupLabel = group.firstOp.replace(/\.(success|error)\(.*\)$/, '')}
						{@const context = group.calls.find((c) => c.context)?.context}
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

	{#if activityData.pagination.totalPages > 1}
		<div class="mt-4 flex items-center justify-center gap-3">
			{#if activityData.pagination.hasPrev}
				<button onclick={() => fetchData(fromDate, toDate, activityData.pagination.page - 1)}>
					<Button variant="outline" size="xs">Previous</Button>
				</button>
			{/if}
			<span class="text-muted-foreground text-xs">
				Page {activityData.pagination.page} of {activityData.pagination.totalPages}
				({activityData.pagination.totalCount} entries)
			</span>
			{#if activityData.pagination.hasNext}
				<button onclick={() => fetchData(fromDate, toDate, activityData.pagination.page + 1)}>
					<Button variant="outline" size="xs">Next</Button>
				</button>
			{/if}
		</div>
	{/if}
</div>
