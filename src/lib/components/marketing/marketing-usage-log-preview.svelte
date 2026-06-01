<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';

	const sampleRows = [
		{ op: 'memory.capture', cost: '$0.0031', markup: '+20%' },
		{ op: 'embedding · pgvector', cost: '$0.0001', markup: '+20%' },
		{ op: 'graph.link · AGE', cost: '$0.0000', markup: '—' },
		{ op: 'memory.retrieve', cost: '$0.0120', markup: '+20%' }
	];
</script>

<div
	use:marketingReveal
	class="bg-secondary rounded-lg border border-border/60 p-4 font-mono text-xs transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0"
>
	<p
		class="text-muted-foreground mb-3 font-sans text-[11px] font-medium uppercase tracking-[0.08em]"
	>
		Usage log · this session
	</p>
	<ul>
		{#each sampleRows as row (row.op)}
			<li
				class="flex items-center justify-between border-t border-border/60 py-2 first:border-t-0 first:pt-0"
			>
				<span class="text-muted-foreground">{row.op}</span>
				<span class="text-foreground tabular-nums">
					{row.cost}
					<span class="text-[11px] text-[#1D9E75]">{row.markup}</span>
				</span>
			</li>
		{/each}
	</ul>
	<div
		class="text-foreground mt-3 flex items-center justify-between border-t border-border pt-3 font-sans text-[13px]"
	>
		<span>Session total</span>
		<span class="font-medium tabular-nums">$0.0182</span>
	</div>
</div>
