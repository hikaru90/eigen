/** Longest segment the voice recorder sends (forced cut, see `$lib/capture/segmented-stt`). */
export const STT_SEGMENT_MAX_SECONDS = 10

/**
 * Maximum bytes for one uploaded segment: 10 s of 48 kHz 16-bit stereo PCM
 * (the largest format a recorder emits, WAV) rounded up to 2 MiB. Opus/WebM
 * segments are far smaller.
 */
export const STT_SEGMENT_MAX_AUDIO_BYTES = 2 * 1024 * 1024

const MIME_TO_FORMAT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
}

/**
 * Maps browser/server MIME type to OpenRouter/EuRouter `input_audio.format`.
 */
export function sttFormatFromMime(mime: string): string | null {
  const normalized = mime.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  return MIME_TO_FORMAT[normalized] ?? null
}
