import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE_AUDIO_BITS_PER_SECOND, VOICE_MESSAGE_MAX_MS } from '$lib/capture/voice-message'
import { STT_CLIP_MAX_AUDIO_BYTES, STT_CLIP_MAX_SECONDS, sttFormatFromMime } from './stt-audio'

const root = path.resolve(import.meta.dirname, '../../../..')

describe('stt-audio', () => {
  it('maps common mime types', () => {
    expect(sttFormatFromMime('audio/webm')).toBe('webm')
    expect(sttFormatFromMime('audio/webm;codecs=opus')).toBe('webm')
    expect(sttFormatFromMime('audio/mp4')).toBe('m4a')
    expect(sttFormatFromMime('audio/wav')).toBe('wav')
  })

  it('returns null for unknown mime', () => {
    expect(sttFormatFromMime('application/octet-stream')).toBeNull()
  })
})

describe('one clip upload limit (VM-10)', () => {
  it('is sized for the 5-minute cap the recorder enforces', () => {
    expect(STT_CLIP_MAX_SECONDS * 1000).toBe(VOICE_MESSAGE_MAX_MS)
  })

  it('leaves headroom over 5 minutes at the 32 kbps the recorder asks for', () => {
    const nominal = (VOICE_AUDIO_BITS_PER_SECOND / 8) * STT_CLIP_MAX_SECONDS
    // encoders treat the bitrate as a hint and containers add overhead
    expect(STT_CLIP_MAX_AUDIO_BYTES).toBeGreaterThanOrEqual(4 * nominal)
    expect(STT_CLIP_MAX_AUDIO_BYTES).toBeLessThan(32 * 1024 * 1024)
  })

  describe('adapter-node BODY_SIZE_LIMIT (default 512 KB would reject a whole clip)', () => {
    function limitIn(file: string, pattern: RegExp): number {
      const text = fs.readFileSync(path.join(root, file), 'utf8')
      const match = pattern.exec(text)
      if (!match) throw new Error(`${file} does not set BODY_SIZE_LIMIT`)
      return Number(match[1])
    }

    it('is set explicitly in the Dockerfile runtime stage, above the clip limit', () => {
      const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')
      const runner = dockerfile.slice(dockerfile.indexOf('FROM base AS runner'))
      expect(runner).toMatch(/^ENV BODY_SIZE_LIMIT=\d+$/m)
      expect(limitIn('Dockerfile', /^ENV BODY_SIZE_LIMIT=(\d+)$/m)).toBeGreaterThan(
        STT_CLIP_MAX_AUDIO_BYTES,
      )
    })

    it('is set in .env.example, above the clip limit', () => {
      expect(limitIn('.env.example', /^BODY_SIZE_LIMIT="?(\d+)"?$/m)).toBeGreaterThan(
        STT_CLIP_MAX_AUDIO_BYTES,
      )
    })
  })
})
