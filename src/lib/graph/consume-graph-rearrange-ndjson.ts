import type { GraphRearrangeResult } from '$lib/graph/graph-edit-api';
import type { GraphRearrangePhase } from '$lib/graph/graph-rearrange-phases';

export type GraphRearrangeNdjsonLine =
	| { type: 'progress'; phase: GraphRearrangePhase }
	| { type: 'done'; result: GraphRearrangeResult }
	| { type: 'error'; error: string };

export async function consumeGraphRearrangeNdjsonStream(
	res: Response,
	onProgress: (phase: GraphRearrangePhase) => void
): Promise<GraphRearrangeResult> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error('Graph rearrange response had no body to read.');
	}

	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let newline: number;
			while ((newline = buffer.indexOf('\n')) >= 0) {
				const rawLine = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				const line = rawLine.trim();
				if (!line) continue;
				const obj = JSON.parse(line) as GraphRearrangeNdjsonLine;
				if (obj.type === 'progress') {
					onProgress(obj.phase);
					continue;
				}
				if (obj.type === 'error') {
					throw new Error(obj.error || 'Graph rearrange failed');
				}
				if (obj.type === 'done') {
					return obj.result;
				}
			}
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
	throw new Error('Graph rearrange stream ended before completion.');
}
