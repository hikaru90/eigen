<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import {
		formatActivitySpendBucketLabel,
		type ActivitySpendBucket,
		type ActivitySpendBucketUnit
	} from '$lib/activity/spend-chart';
	import { totalCostUsdToCredits } from '$lib/billing/platform-pricing';

	let {
		buckets,
		unit,
		totalGroups
	}: {
		buckets: ActivitySpendBucket[];
		unit: ActivitySpendBucketUnit;
		totalGroups: number;
	} = $props();

	const hasSpend = $derived(buckets.some((b) => Number(b.totalCostUsd) > 0));

	const totalCredits = $derived(
		buckets.reduce((sum, b) => sum + totalCostUsdToCredits(b.totalCostUsd), 0)
	);
	const totalUsd = $derived(
		buckets.reduce((sum, b) => sum + Number(b.totalCostUsd), 0)
	);

	const averageCreditsPerDay = $derived.by(() => {
		if (buckets.length === 0) return 0;
		const uniqueDays = new Set(buckets.map((b) => b.periodStart)).size || 1;
		return totalCredits / uniqueDays;
	});
	const averageUsdPerDay = $derived.by(() => {
		if (buckets.length === 0) return 0;
		const uniqueDays = new Set(buckets.map((b) => b.periodStart)).size || 1;
		return totalUsd / uniqueDays;
	});

	const totalCalls = $derived(buckets.reduce((sum, b) => sum + b.callCount, 0));
	const averageCreditsPerGroup = $derived.by(() => {
		if (totalGroups === 0) return 0;
		return totalCredits / totalGroups;
	});
	const averageUsdPerGroup = $derived.by(() => {
		if (totalGroups === 0) return 0;
		return totalUsd / totalGroups;
	});

	const chartWidth = 640;
	const chartHeight = 180;
	const padLeft = 44;
	const padRight = 8;
	const padTop = 8;
	const padBottom = 28;
	const plotWidth = chartWidth - padLeft - padRight;
	const plotHeight = chartHeight - padTop - padBottom;

	const credits = $derived(buckets.map((b) => totalCostUsdToCredits(b.totalCostUsd)));
	const maxCredits = $derived(Math.max(...credits, 0.001));

	// Average cost per event for each bucket
	const avgCostPerEvent = $derived(
		buckets.map((b) => {
			if (b.groupCount === 0) return 0;
			return totalCostUsdToCredits(b.totalCostUsd) / b.groupCount;
		})
	);
	const maxAvgCost = $derived(Math.max(...avgCostPerEvent, 0.001));

	const bars = $derived.by(() => {
		const count = Math.max(buckets.length, 1);
		const gap = count > 24 ? 1 : 2;
		const barWidth = Math.max(2, (plotWidth - gap * (count - 1)) / count);
		return buckets.map((bucket, index) => {
			const value = totalCostUsdToCredits(bucket.totalCostUsd);
			const height = value > 0 ? Math.max(2, (value / maxCredits) * plotHeight) : 0;
			const x = padLeft + index * (barWidth + gap);
			const y = padTop + plotHeight - height;
			return {
				bucket,
				value,
				x,
				y,
				width: barWidth,
				height,
				label: formatActivitySpendBucketLabel(bucket.periodStart, unit)
			};
		});
	});

	const yTicks = $derived.by(() => {
		const max = maxCredits;
		const steps = 4;
		const ticks: number[] = [];
		for (let i = 0; i <= steps; i++) {
			ticks.push((max / steps) * i);
		}
		return ticks;
	});

	let hoveredIndex = $state<number | null>(null);

	function formatTick(value: number): string {
		if (value === 0) return '0';
		if (value < 1) return value.toFixed(2);
		if (Number.isInteger(value)) return value.toLocaleString('en-US');
		return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
	}

	function formatCredits(value: number): string { // eslint-disable-line @typescript-eslint/no-unused-vars
		if (value === 0) return '0';
		if (value < 0.01) return value.toFixed(4);
		if (value < 1) return value.toFixed(2);
		return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
	}

	function formatUsd(value: number): string {
		if (value === 0) return '$0.00';
		if (value < 0.01) return `$${value.toFixed(4)}`;
		return `$${value.toFixed(2)}`;
	}

	function labelStep(count: number): number {
		if (count <= 8) return 1;
		if (count <= 16) return 2;
		if (count <= 32) return 4;
		return Math.ceil(count / 8);
	}

	const step = $derived(labelStep(buckets.length));

	// Line chart points for avg cost per event (only non-zero)
	const linePoints = $derived.by(() => {
		const count = Math.max(buckets.length, 1);
		const gap = count > 24 ? 1 : 2;
		const barWidth = Math.max(2, (plotWidth - gap * (count - 1)) / count);
		return buckets
			.map((bucket, index) => {
				const value = avgCostPerEvent[index];
				const x = padLeft + index * (barWidth + gap) + barWidth / 2;
				const y = padTop + plotHeight - (value / maxAvgCost) * plotHeight;
				return { x, y, value, label: bucket.periodStart };
			})
			.filter((p) => p.value > 0);
	});

	// SVG path for the line
	const linePath = $derived.by(() => {
		if (linePoints.length === 0) return '';
		return linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
	});
</script>

<Card.Root class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-4 border border-black/10 bg-card">
	<Card.Header class="pb-2">
		<div class="flex items-center justify-between">
			<div>
				<Card.Title class="text-sm">Spend overview</Card.Title>
				<Card.Description class="text-muted-foreground text-xs">
					Paid gateway spend in the selected range.
				</Card.Description>
			</div>
		</div>
	</Card.Header>
	<Card.Content class="px-2 pb-4">
		{#if !hasSpend}
			<p class="text-muted-foreground px-2 py-8 text-center text-xs">No paid gateway spend in this range.</p>
		{:else}
			<!-- Summary stats -->
			<div class="mb-4 grid grid-cols-2 gap-4 px-2 sm:grid-cols-5">
				<div class="rounded-md border border-border/50 bg-muted/30 p-3">
					<div class="text-muted-foreground text-[10px] uppercase tracking-wide">Total Spend</div>
					<div class="mt-1 font-mono text-sm font-semibold tabular-nums">{formatCredits(totalCredits)}</div>
					<div class="text-muted-foreground font-mono text-[10px]">{formatUsd(totalUsd)}</div>
				</div>
				<div class="rounded-md border border-border/50 bg-muted/30 p-3">
					<div class="text-muted-foreground text-[10px] uppercase tracking-wide">Avg / Day</div>
					<div class="mt-1 font-mono text-sm font-semibold tabular-nums">{formatCredits(averageCreditsPerDay)}</div>
					<div class="text-muted-foreground font-mono text-[10px]">{formatUsd(averageUsdPerDay)}</div>
				</div>
				<div class="rounded-md border border-border/50 bg-muted/30 p-3">
					<div class="text-muted-foreground text-[10px] uppercase tracking-wide">Avg Cost / Call</div>
					<div class="mt-1 font-mono text-sm font-semibold tabular-nums">{formatCredits(averageCreditsPerGroup)}</div>
					<div class="text-muted-foreground font-mono text-[10px]">{formatUsd(averageUsdPerGroup)}</div>
				</div>
				<div class="rounded-md border border-border/50 bg-muted/30 p-3">
					<div class="text-muted-foreground text-[10px] uppercase tracking-wide">Total Calls</div>
					<div class="mt-1 font-mono text-sm font-semibold tabular-nums">
						{totalCalls.toLocaleString()}
					</div>
				</div>
				<div class="rounded-md border border-border/50 bg-muted/30 p-3">
					<div class="text-muted-foreground text-[10px] uppercase tracking-wide">Avg Calls / Day</div>
					<div class="mt-1 font-mono text-sm font-semibold tabular-nums">
						{(() => {
							const uniqueDays = new Set(buckets.map((b) => b.periodStart)).size || 1;
							return (totalCalls / uniqueDays).toFixed(1);
						})()}
					</div>
				</div>
			</div>

			<!-- Legend -->
			<div class="mb-2 flex items-center gap-4 px-2 text-[10px]">
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-2.5 w-2.5 rounded-sm bg-foreground/55"></span>
					<span class="text-muted-foreground">Total spend</span>
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-0.5 w-3 rounded bg-blue-500"></span>
					<span class="text-muted-foreground">Avg cost / call</span>
				</div>
			</div>

			<!-- Chart -->
			<div class="relative">
				<svg
					viewBox={`0 0 ${chartWidth} ${chartHeight}`}
					class="h-44 w-full"
					role="img"
					aria-label="Spend chart"
				>
					{#each yTicks as tick, ti (ti)}
						{@const y = padTop + plotHeight - (tick / maxCredits) * plotHeight}
						<line
							x1={padLeft}
							x2={chartWidth - padRight}
							y1={y}
							y2={y}
							class="stroke-border/70"
							stroke-width="1"
						/>
						<text
							x={padLeft - 6}
							y={y + 3}
							text-anchor="end"
							class="fill-muted-foreground text-[9px]"
						>
							{formatTick(tick)}
						</text>
					{/each}

					{#each bars as bar, index (bar.bucket.periodStart)}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							rx="1"
							class={hoveredIndex === index ? 'fill-foreground/80' : 'fill-foreground/55'}
							onmouseenter={() => (hoveredIndex = index)}
							onmouseleave={() => (hoveredIndex = null)}
							onfocus={() => (hoveredIndex = index)}
							onblur={() => (hoveredIndex = null)}
							tabindex="0"
							role="graphics-symbol"
							aria-label="{bar.label}: {formatCredits(Number(bar.bucket.totalCostUsd))} credits"
						/>
						{#if index % step === 0 || index === bars.length - 1}
							<text
								x={bar.x + bar.width / 2}
								y={chartHeight - 8}
								text-anchor="middle"
								class="fill-muted-foreground text-[8px]"
							>
								{bar.label}
							</text>
						{/if}
					{/each}

					<!-- Line chart: avg cost per event -->
					{#if linePoints.length > 1}
						<path
							d={linePath}
							fill="none"
							class="stroke-blue-500"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					{/if}

					{#each linePoints as point, i (i)}
						<circle
							cx={point.x}
							cy={point.y}
							r="3"
							class="fill-blue-500 stroke-white"
							stroke-width="1.5"
						/>
					{/each}

					<!-- Right Y-axis for avg cost per event -->
					{#each yTicks as tick, ti (ti)}
						{@const avgTick = (tick / maxCredits) * maxAvgCost}
						{@const y = padTop + plotHeight - (tick / maxCredits) * plotHeight}
						<text
							x={chartWidth - padRight + 4}
							y={y + 3}
							text-anchor="start"
							class="fill-blue-500 text-[9px]"
						>
							{formatTick(avgTick)}
						</text>
					{/each}
				</svg>

				{#if hoveredIndex !== null}
					{@const bar = bars[hoveredIndex]}
					{@const linePoint = linePoints[hoveredIndex]}
					<div
						class="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded border border-border bg-card px-2 py-1 text-[11px] shadow-sm"
					>
						<div class="font-medium">{bar.label}</div>
						<div class="font-mono tabular-nums">
							{formatCredits(Number(bar.bucket.totalCostUsd))} credits
						</div>
						<div class="text-muted-foreground font-mono text-[10px]">
							{formatUsd(Number(bar.bucket.totalCostUsd))}
						</div>
						<div class="text-muted-foreground">
							{bar.bucket.callCount} call{bar.bucket.callCount === 1 ? '' : 's'}
						</div>
						<div class="mt-1 border-t border-border pt-1 text-blue-500">
							Avg/call: {formatCredits(linePoint.value)}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
