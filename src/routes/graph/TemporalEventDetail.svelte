<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { formatWhen, kindLabel } from './temporal-events-utils';

	type Props = {
		item: TemporalEventListItem;
	};

	let { item }: Props = $props();
</script>

<div
	class="border-border bg-muted/20 shrink-0 border-t px-4 py-3"
	role="region"
	aria-label="Selected event details"
>
	<dl class="grid gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-2">
		<div class="sm:col-span-2">
			<dt class="text-muted-foreground text-[10px] uppercase">Summary</dt>
			<dd class="text-foreground text-sm font-sans font-medium">{item.semanticSummary}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">When</dt>
			<dd class="text-foreground">{formatWhen(item)}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">Kind</dt>
			<dd class="text-foreground">{kindLabel(item.kind)}</dd>
		</div>
		{#if item.sourceTextSpan}
			<div>
				<dt class="text-muted-foreground text-[10px] uppercase">Phrase</dt>
				<dd class="text-foreground">"{item.sourceTextSpan}"</dd>
			</div>
		{/if}
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">Precision</dt>
			<dd class="text-foreground">{item.timePrecision}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">Graph</dt>
			<dd class="text-foreground">{item.graphSyncStatus}</dd>
		</div>
		<div class="sm:col-span-2">
			<dt class="text-muted-foreground text-[10px] uppercase">Source thought</dt>
			<dd class="text-foreground font-sans text-xs leading-relaxed">{item.thoughtText}</dd>
		</div>
	</dl>
</div>
