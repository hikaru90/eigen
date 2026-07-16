import { describe, expect, it, vi } from 'vitest';
import { isUseSendMailConfigured, resolveUseSendMailConfig, sendTransactionalEmail } from './usesend';

describe('resolveUseSendMailConfig', () => {
	it('returns null when any required env is missing', () => {
		expect(resolveUseSendMailConfig({})).toBeNull();
		expect(
			resolveUseSendMailConfig({
				USESEND_API_KEY: 'us_x',
				USESEND_BASE_URL: 'https://usesend.example'
			})
		).toBeNull();
		expect(isUseSendMailConfigured({})).toBe(false);
	});

	it('strips trailing slash from base URL', () => {
		expect(
			resolveUseSendMailConfig({
				USESEND_API_KEY: 'us_x',
				USESEND_BASE_URL: 'https://usesend.coolify.stackstack.de/',
				USESEND_EMAIL_FROM: 'hello@eigenmesh.de'
			})
		).toEqual({
			apiKey: 'us_x',
			baseUrl: 'https://usesend.coolify.stackstack.de',
			from: 'hello@eigenmesh.de'
		});
	});
});

describe('sendTransactionalEmail', () => {
	it('throws when mail is not configured', async () => {
		await expect(
			sendTransactionalEmail(
				{},
				{ to: 'a@b.co', subject: 's', html: '<p>x</p>', text: 'x' }
			)
		).rejects.toThrow(/not configured/);
	});

	it('POSTs to useSend /api/v1/emails with Bearer auth', async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ emailId: 'em_1' }), { status: 200 })
		);

		const result = await sendTransactionalEmail(
			{
				USESEND_API_KEY: 'us_test',
				USESEND_BASE_URL: 'https://usesend.coolify.stackstack.de',
				USESEND_EMAIL_FROM: 'hello@eigenmesh.de'
			},
			{
				to: 'user@example.com',
				subject: 'Reset your Eigen password',
				html: '<p>link</p>',
				text: 'link'
			},
			fetchImpl as unknown as typeof fetch
		);

		expect(result).toEqual({ emailId: 'em_1' });
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://usesend.coolify.stackstack.de/api/v1/emails',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer us_test'
				}
			})
		);
		const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({
			to: 'user@example.com',
			from: 'hello@eigenmesh.de',
			subject: 'Reset your Eigen password',
			html: '<p>link</p>',
			text: 'link'
		});
	});

	it('throws with API error detail on non-OK response', async () => {
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 400 })
		);

		await expect(
			sendTransactionalEmail(
				{
					USESEND_API_KEY: 'us_test',
					USESEND_BASE_URL: 'https://usesend.coolify.stackstack.de',
					USESEND_EMAIL_FROM: 'hello@eigenmesh.de'
				},
				{ to: 'a@b.co', subject: 's', html: 'h', text: 't' },
				fetchImpl as unknown as typeof fetch
			)
		).rejects.toThrow(/domain not verified/);
	});
});
