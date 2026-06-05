import { describe, expect, it } from 'vitest';
import { POST } from './+server';

const VALID_PROFILE = 'https://www.linkedin.com/in/eigen';

function postRequest(body: unknown) {
	return new Request('http://localhost/api/settings/linkedin/draft', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

describe('POST /api/settings/linkedin/draft', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			POST({
				locals: { user: null },
				request: postRequest({ profileUrl: VALID_PROFILE, update: 'Shipped v1' })
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 400 for invalid JSON', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: new Request('http://localhost', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: 'not-json'
				})
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 for invalid LinkedIn profile URL', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: postRequest({ profileUrl: 'https://example.com', update: 'Shipped v1' })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns draft for valid profile and update', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: postRequest({ profileUrl: VALID_PROFILE, update: 'Shipped v1' })
		} as never);

		const body = await res.json();
		expect(body.draft).toMatchObject({
			headline: 'Eigen: project update',
			body: expect.stringContaining('Shipped v1'),
			hashtags: expect.arrayContaining(['eigen'])
		});
	});
});
