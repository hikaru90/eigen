import { describe, expect, it } from 'vitest';
import { buildWebhookHeaders, buildWebhookSignature } from './sign';

describe('buildWebhookSignature', () => {
	it('produces deterministic HMAC for fixed inputs', () => {
		const sig = buildWebhookSignature({
			secret: 'test-secret',
			timestamp: 1_700_000_000,
			rawBody: '{"event":"thought.created"}'
		});
		expect(sig).toMatch(/^[0-9a-f]{64}$/);
		expect(
			buildWebhookSignature({
				secret: 'test-secret',
				timestamp: 1_700_000_000,
				rawBody: '{"event":"thought.created"}'
			})
		).toBe(sig);
	});
});

describe('buildWebhookHeaders', () => {
	it('includes Eigen webhook headers', () => {
		const headers = buildWebhookHeaders({
			eventType: 'thought.created',
			deliveryId: 'd1',
			timestamp: 123,
			signature: 'abc'
		});
		expect(headers['X-Eigen-Event']).toBe('thought.created');
		expect(headers['X-Eigen-Delivery-Id']).toBe('d1');
		expect(headers['X-Eigen-Signature']).toBe('sha256=abc');
	});
});
