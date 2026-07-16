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
		expect(envelope.event_type).toBe('thought.created');
		expect(envelope.eventId).toBe('t1');
		expect((envelope.data as { normalizedText: string }).normalizedText).toBe('hello');
	});

	it('mirrors event into event_type for Hermes body detection', () => {
		const envelope = buildEnvelope({
			eventType: 'webhook.test',
			eventId: 'd1',
			payload: { message: 'Eigenmesh webhook test' }
		});
		expect(envelope.event).toBe('webhook.test');
		expect(envelope.event_type).toBe('webhook.test');
	});

	it('includes projectEntityIds and projectLabels in payload when provided', () => {
		const envelope = buildEnvelope({
			eventType: 'thought.enriched',
			eventId: 't1',
			payload: {
				thoughtId: 't1',
				normalizedText: 'hello',
				projectEntityIds: ['proj-1', 'proj-2'],
				projectLabels: ['Eigen', 'Hermes']
			}
		});
		const data = envelope.data as {
			projectEntityIds?: string[];
			projectLabels?: string[];
		};
		expect(data.projectEntityIds).toEqual(['proj-1', 'proj-2']);
		expect(data.projectLabels).toEqual(['Eigen', 'Hermes']);
	});

	it('omits project fields when empty', () => {
		const envelope = buildEnvelope({
			eventType: 'thought.created',
			eventId: 't1',
			payload: { thoughtId: 't1' }
		});
		const data = envelope.data as Record<string, unknown>;
		expect(data.projectEntityIds).toBeUndefined();
		expect(data.projectLabels).toBeUndefined();
	});
});
