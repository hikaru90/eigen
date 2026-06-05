import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	parseSttTranscript,
	transcribeAudio,
	STT_MODEL_OPENROUTER_DEFAULT
} from './stt-client';

const { llmCreateTranscriptionMock } = vi.hoisted(() => ({
	llmCreateTranscriptionMock: vi.fn()
}));

vi.mock('./llm-client', () => ({
	llmCreateTranscription: llmCreateTranscriptionMock
}));

vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

describe('parseSttTranscript', () => {
	it('extracts trimmed text from dedicated STT body', () => {
		expect(parseSttTranscript({ text: '  hello  ' })).toBe('hello');
	});

	it('rejects chat completion body so assistant replies are not treated as transcripts', () => {
		expect(() =>
			parseSttTranscript({ choices: [{ message: { content: '  spoken words  ' } }] })
		).toThrow(/chat completion shape/);
	});

	it('throws when text missing', () => {
		expect(() => parseSttTranscript({})).toThrow(/missing transcript/);
	});
});

describe('transcribeAudio', () => {
	beforeEach(() => {
		llmCreateTranscriptionMock.mockReset();
	});

	it('calls gateway with default OpenRouter STT model', async () => {
		llmCreateTranscriptionMock.mockResolvedValue({ text: 'typed speech' });
		const out = await transcribeAudio({
			userId: 'u1',
			audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm', language: 'en' }
		});
		expect(out).toBe('typed speech');
		expect(llmCreateTranscriptionMock).toHaveBeenCalledWith({
			userId: 'u1',
			model: STT_MODEL_OPENROUTER_DEFAULT,
			audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm', language: 'en' }
		});
	});
});
