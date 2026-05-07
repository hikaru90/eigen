import { describe, expect, it } from 'vitest';
import { redactForLog } from './redact-for-log';

describe('redactForLog', () => {
	it('redacts known secret keys', () => {
		const out = redactForLog({ api_key: 'secret', name: 'ok' }) as Record<string, unknown>;
		expect(out.api_key).toBe('[REDACTED]');
		expect(out.name).toBe('ok');
	});

	it('redacts nested secrets', () => {
		const out = redactForLog({ outer: { access_token: 'x' } }) as { outer: { access_token: string } };
		expect(out.outer.access_token).toBe('[REDACTED]');
	});

	it('handles nullish and scalar values', () => {
		expect(redactForLog(null)).toBeNull();
		expect(redactForLog(undefined)).toBeUndefined();
		expect(redactForLog('hello')).toBe('hello');
	});

	it('redacts suffix-based keys and arrays', () => {
		const out = redactForLog({
			service_token: 'abc',
			items: [{ client_secret: 'x' }, { keep: 'ok' }]
		}) as { service_token: string; items: Array<Record<string, string>> };
		expect(out.service_token).toBe('[REDACTED]');
		expect(out.items[0].client_secret).toBe('[REDACTED]');
		expect(out.items[1].keep).toBe('ok');
	});
});
