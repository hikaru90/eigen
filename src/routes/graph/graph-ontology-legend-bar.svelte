<script lang="ts">
	import type { GraphLegendSection } from '$lib/graph/graph-ontology-legend';

	let {
		legendSections,
		legendScrollEl = $bindable(undefined)
	}: {
		legendSections: GraphLegendSection[];
		legendScrollEl?: HTMLDivElement | undefined;
	} = $props();
</script>

<aside
	class="border-border/80 bg-muted/10 w-full min-w-0 max-w-full rounded-md border px-2 py-1.5"
	aria-label="Graph ontology legend"
>
	<div
		bind:this={legendScrollEl}
		class="min-w-0 w-full max-w-full touch-pan-x overflow-x-auto overscroll-x-contain scroll-pl-2 scroll-pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
	>
		<div
			class="text-foreground flex w-max min-w-full flex-nowrap items-center gap-x-2 text-[10px] leading-none"
		>
			{#each legendSections as section, si (section.title)}
				<div class="flex shrink-0 flex-nowrap items-center gap-x-2">
					{#if si > 0}
						<span class="text-muted-foreground/45 shrink-0 select-none" aria-hidden="true">·</span>
					{/if}
					<span
						class="text-muted-foreground shrink-0 font-semibold tracking-tight"
						title={section.title}>{section.title}:</span
					>
					{#each section.items as item (item.key)}
						<span
							class="border-border/60 bg-muted/25 text-foreground inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5"
							title={item.hint}
						>
							{#if item.fill}
								<span
									class="h-2 w-2 shrink-0 rounded-full ring-1 ring-border/60"
									style="background-color: {item.fill}"
									aria-hidden="true"
								></span>
							{:else}
								<span
									class="bg-muted-foreground/45 h-2 w-2 shrink-0 rounded-sm"
									aria-hidden="true"
								></span>
							{/if}
							<span class="font-medium">{item.label}</span>
						</span>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</aside>
