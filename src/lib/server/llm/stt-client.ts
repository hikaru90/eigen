import { env } from '$env/dynamic/private';
import { llmCreateTranscription } from './llm-client';

/** OpenRouter model id for speech-to-text (`/audio/transcriptions`). */
export const STT_MODEL_OPENROUTER_DEFAULT = 'qwen/qwen3-asr-flash-2026-02-10';

export type SttAudioInput = {
	bytes: Uint8Array;
	format: string;
	language?: string;
};

function sttModelId(): string {
	const override = env.LLM_MODEL_STT?.trim();
	if (!override) return STT_MODEL_OPENROUTER_DEFAULT;
	return override;
}

/**
 * Parses transcript text from a dedicated STT body (`{ text }`) or chat completion (`choices[0].message.content`).
 */
export function parseSttTranscript(body: unknown): string {
	if (!body || typeof body !== 'object') {
		throw new Error('STT response missing body');
	}
	const dedicated = (body as { text?: unknown }).text;
	if (typeof dedicated === 'string' && dedicated.trim()) {
		return dedicated.trim();
	}
	const choices = (body as { choices?: unknown }).choices;
	if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
		const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
		if (typeof content === 'string' && content.trim()) {
			return content.trim();
		}
	}
	throw new Error('STT response missing transcript text');
}

/**
 * Transcribes audio via OpenRouter (`POST /audio/transcriptions`).
 */
export async function transcribeAudio(input: {
	userId: string;
	audio: SttAudioInput;
}): Promise<string> {
	const body = await llmCreateTranscription({
		userId: input.userId,
		model: sttModelId(),
		audio: input.audio
	});
	return parseSttTranscript(body);
}
