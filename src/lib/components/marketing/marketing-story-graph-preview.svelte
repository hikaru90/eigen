<script lang="ts">
	import ForceGraph from '$lib/components/graph/ForceGraph.svelte';
	import {
		DEMO_GRAPH_EDGES,
		DEMO_GRAPH_LEGEND,
		DEMO_GRAPH_NODES
	} from './marketing-story-demo-data';

	let { exitProgress = 0 }: { exitProgress?: number } = $props();
</script>

<div class="h-[min(84vh,820px)] w-full max-w-6xl">
	<ForceGraph
		nodes={DEMO_GRAPH_NODES}
		edges={DEMO_GRAPH_EDGES}
		legendSections={DEMO_GRAPH_LEGEND}
		height="100%"
		interactive={false}
		showStatus={false}
		{exitProgress}
	/>
</div>
