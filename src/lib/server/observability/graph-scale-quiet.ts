/** When set (graph-scale harness), suppress verbose LLM/capture/retrieval console logs. */
export function isGraphScaleQuiet(): boolean {
	return process.env.GRAPH_SCALE_QUIET === '1';
}
