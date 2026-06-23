import { describe, expect, it } from 'vitest';
import { buildEnvelope, sanitizeWebhookPayload } from './payloads';

describe('sanitizeWebhookPayload', () => {
	it('strips embedding fields from nested payload', () => {
		const vector = Array.from({ length: 1536 }, (_, i) => i * 0.001);
		const out = sanitizeWebhookPayload({
			thoughtId: 't1',
			embedding: vector
		});
		expect(out).toEqual({ thoughtId: 't1' });
		expect('embedding' in out).toBe(false);
	});
});

describe('buildEnvelope', () => {
	it('wraps event data without embeddings', () => {
		const envelope = buildEnvelope({
			eventType: 'thought.created',
			eventId: 't1',
			payload: { thoughtId: 't1', normalizedText: 'hello' }
		});
		expect(envelope.event).toBe('thought.created');
		expect(envelope.eventId).toBe('t1');
		expect((envelope.data as { normalizedText: string }).normalizedText).toBe('hello');
	});
});
