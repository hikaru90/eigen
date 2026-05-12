import { describe, expect, it } from 'vitest';
import { consumeCaptureNdjsonStream } from './consume-capture-ndjson';

describe('consumeCaptureNdjsonStream', () => {
	it('parses progress lines then returns thought from done', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"type":"progress","phase":"embedding"}\n'));
				controller.enqueue(
					encoder.encode('{"type":"done","thought":{"id":"t1","category":"thought"}}\n')
				);
				controller.close();
			}
		});
		const res = new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
		const phases: string[] = [];
		const thought = await consumeCaptureNdjsonStream<{ id: string }>(res, (p) => phases.push(p));
		expect(phases).toEqual(['embedding']);
		expect(thought).toEqual({ id: 't1', category: 'thought' });
	});

	it('throws on error line', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(
					encoder.encode('{"type":"error","error":"nope","details":["nope"]}\n')
				);
				controller.close();
			}
		});
		const res = new Response(body);
		await expect(
			consumeCaptureNdjsonStream(res, () => {
				/* noop */
			})
		).rejects.toThrow('nope');
	});
});
