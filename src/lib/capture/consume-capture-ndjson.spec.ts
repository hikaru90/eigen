import { describe, expect, it } from 'vitest';
import { consumeCaptureNdjsonStream, type ProgressEvent } from './consume-capture-ndjson';

describe('consumeCaptureNdjsonStream', () => {
	it('parses progress lines then returns thought from done', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"type":"progress","phase":"embedding"}\n'));
				controller.enqueue(
					encoder.encode('{"type":"done","thought":{"id":"t1","category":"task"}}\n')
				);
				controller.close();
			}
		});
		const res = new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
		const events: ProgressEvent[] = [];
		const thought = await consumeCaptureNdjsonStream<{ id: string }>(res, (e) => events.push(e));
		expect(events).toEqual([{ parallel: false, phase: 'embedding' }]);
		expect(thought).toEqual({ id: 't1', category: 'task' });
	});

	it('parses progress_parallel lines', async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(
					encoder.encode('{"type":"progress_parallel","phases":["ontology","embedding"]}\n')
				);
				controller.enqueue(
					encoder.encode('{"type":"done","thought":{"id":"t2","category":"idea"}}\n')
				);
				controller.close();
			}
		});
		const res = new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
		const events: ProgressEvent[] = [];
		const thought = await consumeCaptureNdjsonStream<{ id: string }>(res, (e) => events.push(e));
		expect(events).toEqual([{ parallel: true, phases: ['ontology', 'embedding'] }]);
		expect(thought).toEqual({ id: 't2', category: 'idea' });
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
