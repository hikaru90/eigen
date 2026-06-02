<script lang="ts">
	import ForceGraph from '$lib/components/graph/ForceGraph.svelte';
	import {
		DEMO_GRAPH_EDGES,
		DEMO_GRAPH_LEGEND,
		DEMO_GRAPH_NODES
	} from './marketing-story-demo-data';
</script>

<div class="h-[min(92vh,920px)] w-full max-w-7xl">
	<div class="h-full">
		<ForceGraph
		nodes={DEMO_GRAPH_NODES}
		edges={DEMO_GRAPH_EDGES}
		legendSections={DEMO_GRAPH_LEGEND}
		height="100%"
		interactive={false}
		showStatus={false}
		/>
	</div>
</div>
