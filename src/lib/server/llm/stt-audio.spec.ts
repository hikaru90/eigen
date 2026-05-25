import { describe, expect, it } from 'vitest';
import { sttFormatFromMime, STT_MAX_AUDIO_BYTES } from './stt-audio';

describe('stt-audio', () => {
	it('maps common mime types', () => {
		expect(sttFormatFromMime('audio/webm')).toBe('webm');
		expect(sttFormatFromMime('audio/webm;codecs=opus')).toBe('webm');
		expect(sttFormatFromMime('audio/wav')).toBe('wav');
	});

	it('returns null for unknown mime', () => {
		expect(sttFormatFromMime('application/octet-stream')).toBeNull();
	});

	it('defines max upload size', () => {
		expect(STT_MAX_AUDIO_BYTES).toBeGreaterThan(0);
	});
});
