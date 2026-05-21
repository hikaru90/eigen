import { describe, expect, it } from 'vitest';
import { parsePushSubscriptionBody } from './subscription';

describe('parsePushSubscriptionBody', () => {
	it('accepts valid subscription JSON', () => {
		const input = parsePushSubscriptionBody({
			endpoint: 'https://push.example/send/abc',
			keys: { p256dh: 'key1', auth: 'key2' }
		});
		expect(input).toEqual({
			endpoint: 'https://push.example/send/abc',
			keys: { p256dh: 'key1', auth: 'key2' }
		});
	});

	it('rejects endpoint with interior whitespace', () => {
		expect(() =>
			parsePushSubscriptionBody({
				endpoint: 'https://push.example/a b',
				keys: { p256dh: 'k', auth: 'a' }
			})
		).toThrow(/whitespace/);
	});

	it('rejects missing keys', () => {
		expect(() =>
			parsePushSubscriptionBody({ endpoint: 'https://push.example/x' })
		).toThrow(/keys/);
	});
});
