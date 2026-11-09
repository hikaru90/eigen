/**
 * Layer 1 of "silence never becomes text" (docs/planning/feature-voice-message-stt.md §8):
 * an audio check on the FINISHED clip, before anything is uploaded.
 *
 * The clip is decoded and its short-frame RMS is read from the real samples — never from the
 * live waveform meter, which reads flat when an iOS AudioContext stays suspended (the bug that
 * killed the old silence gate). A clip is "speech-level" when enough frames, in total, rise
 * above {@link VOICED_RMS_THRESHOLD}: a minimum voiced DURATION, not one peak, so a click or
 * a bump does not count. This is level arithmetic on samples, not a decision about meaning;
 * whether the recognised text is real dictation is Layer 2's LLM judge.
 *
 * The constants below are deliberately conservative (wrongly dropping real speech is worse than
 * letting noise through to Layer 2) and are UNCALIBRATED on real devices: they come from
 * typical levels (soft speech through a phone mic is around -40 to -30 dBFS RMS; a quiet room
 * after the browser's noise suppression is below -50 dBFS), not from measurements. Calibrate on
 * real recordings before tightening them.
 */

/** RMS frame length. Short enough to resolve a click, long enough to cover a voice period. */
export const FRAME_MS = 20
/**
 * A frame counts as voiced at or above this RMS (0–1 full scale): 0.005 ≈ -46 dBFS. Soft speech
 * sits well above it; a quiet room with noise suppression sits below it.
 */
export const VOICED_RMS_THRESHOLD = 0.005
/**
 * Total voiced time (not necessarily contiguous) a clip needs: 160 ms = 8 frames, about one short
 * word. A click or a bump is shorter than that.
 */
export const MIN_VOICED_MS = 160
/**
 * The clip is decoded at this rate (the decoder resamples): a 5-minute clip then stays near 26 MB
 * of floats per channel, and it is a rate older Safari accepts for an OfflineAudioContext.
 */
export const CLIP_DECODE_SAMPLE_RATE = 22_050

export type DecodedClip = {
  /** One array of samples (−1…1) per channel. */
  channels: Float32Array[]
  sampleRate: number
}

/** Whether a decoded clip holds speech-level sound for at least {@link MIN_VOICED_MS} in total. */
export function clipHasSpeechLevelSound(decoded: DecodedClip): boolean {
  const { channels, sampleRate } = decoded
  if (channels.length === 0) return false
  const length = Math.min(...channels.map((c) => c.length))
  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))
  const neededFrames = Math.ceil(MIN_VOICED_MS / FRAME_MS)
  const thresholdSq = VOICED_RMS_THRESHOLD * VOICED_RMS_THRESHOLD

  let voicedFrames = 0
  for (let start = 0; start + frameSize <= length; start += frameSize) {
    let sumSq = 0
    for (let i = start; i < start + frameSize; i++) {
      let sample = 0
      for (const channel of channels) sample += channel[i]!
      sample /= channels.length
      sumSq += sample * sample
    }
    if (sumSq / frameSize >= thresholdSq) {
      voicedFrames += 1
      if (voicedFrames >= neededFrames) return true
    }
  }
  return false
}

/**
 * Decodes a recorded clip with an OfflineAudioContext (independent of any live AudioContext).
 * Rejects when the browser cannot decode the codec: the caller then cannot judge the clip.
 */
export async function decodeClip(clip: Blob): Promise<DecodedClip> {
  const Offline =
    typeof OfflineAudioContext === 'undefined'
      ? (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
      : OfflineAudioContext
  if (!Offline) throw new Error('OfflineAudioContext is not available')
  const context = new Offline(1, 1, CLIP_DECODE_SAMPLE_RATE)
  const buffer = await context.decodeAudioData(await clip.arrayBuffer())
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  return { channels, sampleRate: buffer.sampleRate }
}
