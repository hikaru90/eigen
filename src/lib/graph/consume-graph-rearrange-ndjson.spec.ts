import { describe, expect, it } from 'vitest';
import { consumeGraphRearrangeNdjsonStream } from './consume-graph-rearrange-ndjson';

describe('consumeGraphRearrangeNdjsonStream', () => {
	it('streams progress phases and returns the final result', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(
					encoder.encode('{"type":"progress","phase":"prune_weak_edges"}\n')
				);
				controller.enqueue(
					encoder.encode('{"type":"progress","phase":"repair_relations"}\n')
				);
				controller.enqueue(
					encoder.encode(
						'{"type":"done","result":{"pruned":{"removed":1},"repaired":{"edgesAdded":2}}}\n'
					)
				);
				controller.close();
			}
		});
		const res = new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
		const phases: string[] = [];
		const result = await consumeGraphRearrangeNdjsonStream(res, (phase) => {
			phases.push(phase);
		});
		expect(phases).toEqual(['prune_weak_edges', 'repair_relations']);
		expect(result).toEqual({ pruned: { removed: 1 }, repaired: { edgesAdded: 2 } });
	});

	it('throws on error lines', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"type":"error","error":"boom"}\n'));
				controller.close();
			}
		});
		const res = new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
		await expect(
			consumeGraphRearrangeNdjsonStream(res, () => {
				/* noop */
			})
		).rejects.toThrow('boom');
	});
});
