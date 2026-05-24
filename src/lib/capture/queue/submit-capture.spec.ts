import { describe, expect, it, vi } from 'vitest';
import { isLikelyOfflineError, parseCaptureErrorResponse, submitCaptureRaw } from './submit-capture';

describe('isLikelyOfflineError', () => {
	it('returns true for TypeError (network)', () => {
		expect(isLikelyOfflineError(new TypeError('Failed to fetch'))).toBe(true);
	});
});

describe('parseCaptureErrorResponse', () => {
	it('reads error field from JSON body', async () => {
		const res = new Response(JSON.stringify({ error: 'rate limited' }), { status: 500 });
		await expect(parseCaptureErrorResponse(res)).resolves.toBe('rate limited');
	});
});

describe('submitCaptureRaw', () => {
	it('returns thought from JSON response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ thought: { id: 't1', normalizedText: 'hi', category: 'thought' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const thought = await submitCaptureRaw('hello', { streamProgress: false });
		expect(thought.id).toBe('t1');
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/capture/submit',
			expect.objectContaining({
				body: JSON.stringify({ raw: 'hello' })
			})
		);

		vi.unstubAllGlobals();
	});
});
