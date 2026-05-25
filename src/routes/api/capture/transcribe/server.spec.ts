import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { transcribeAudioMock } = vi.hoisted(() => ({
	transcribeAudioMock: vi.fn()
}));

vi.mock('$lib/server/llm/stt-client', () => ({
	transcribeAudio: transcribeAudioMock
}));

function makeAudioFile(size: number, type = 'audio/webm') {
	return new File([new Uint8Array(size)], 'recording.webm', { type });
}

function multipartRequest(files: { audio?: File; language?: string }) {
	const formData = new FormData();
	if (files.audio) formData.append('audio', files.audio);
	if (files.language) formData.append('language', files.language);
	return {
		headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'multipart/form-data; boundary=x' : null) },
		formData: vi.fn(async () => formData)
	};
}

describe('POST /api/capture/transcribe', () => {
	beforeEach(() => {
		transcribeAudioMock.mockReset();
	});

	it('requires auth', async () => {
		await expect(
			POST({ locals: { user: null }, request: multipartRequest({}) } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('requires multipart form data', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: {
					headers: { get: () => 'application/json' },
					formData: vi.fn()
				}
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('requires audio file', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: multipartRequest({})
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects empty audio', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: multipartRequest({ audio: makeAudioFile(0) })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unsupported mime type', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: multipartRequest({ audio: makeAudioFile(8, 'audio/x-unknown') })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns transcript on success', async () => {
		transcribeAudioMock.mockResolvedValue('hello world');
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: multipartRequest({ audio: makeAudioFile(12), language: 'en' })
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { transcript: string };
		expect(body.transcript).toBe('hello world');
		expect(transcribeAudioMock).toHaveBeenCalledWith({
			userId: 'u1',
			audio: expect.objectContaining({ format: 'webm', language: 'en' })
		});
	});

	it('returns explicit error when transcription fails', async () => {
		transcribeAudioMock.mockRejectedValue(new Error('LLM STT HTTP 502'));
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: multipartRequest({ audio: makeAudioFile(12) })
		} as never);
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain('502');
	});
});
