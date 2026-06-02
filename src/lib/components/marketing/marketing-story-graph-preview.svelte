<script lang="ts">
	import ForceGraph from '$lib/components/graph/ForceGraph.svelte';
	import {
		DEMO_GRAPH_EDGES,
		DEMO_GRAPH_LEGEND,
		DEMO_GRAPH_NODE_REVEAL,
		DEMO_GRAPH_NODES
	} from './marketing-story-demo-data';

	type Props = {
		/** 0–1 progress within the graph scroll beat — drives zoom/pan. */
		beatProgress?: number;
	};

	let { beatProgress = 0 }: Props = $props();
</script>

<div class="h-[min(68vh,560px)] w-full max-w-[min(100%,88rem)] sm:h-[min(78vh,760px)] md:h-[min(88vh,960px)]">
	<div class="h-full">
		<ForceGraph
			nodes={DEMO_GRAPH_NODES}
			edges={DEMO_GRAPH_EDGES}
			legendSections={DEMO_GRAPH_LEGEND}
			height="100%"
			interactive={false}
			showStatus={false}
			presentationProgress={beatProgress}
			presentationReveals={DEMO_GRAPH_NODE_REVEAL}
		/>
	</div>
</div>
