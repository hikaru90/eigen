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
});
