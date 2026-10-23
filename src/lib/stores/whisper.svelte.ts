/* The whisper: the only status line (ei DESIGN.md "No machinery").
   Ported from ei app.js:159-173 — a walk of timed steps, each swapping in with a
   blur-out/in ("settling… → knitting it in… → kept"). The store owns only state and
   timing; the blur itself is the consumer's CSS (`is-swap` in ei styles.css:238-243).

   Usage (later waves):
     import { whisper, showWhisper, resetWhisper } from '$lib/stores/whisper.svelte'
     showWhisper([
       { text: m.whisper_settling(), durationMs: 800 },
       { text: m.whisper_knitting(), durationMs: 1100 },
       { text: m.whisper_kept(), durationMs: 2000 },
     ])
     <span class="whisper" class:is-swap={whisper.swapping} aria-live="polite">{whisper.text}</span>
   SSR-safe: no window/document access at module import time. */

export type WhisperStep = {
  text: string
  /** How long the step stays readable before the next swap. */
  durationMs: number
}

/** ei app.js:165 — the blur-out/in gap between two texts. */
export const WHISPER_SWAP_MS = 200

/** The current whisper. Render `text`; apply the blur-out class while `swapping`. */
export const whisper = $state({
  text: '',
  swapping: false,
})

let timers: ReturnType<typeof setTimeout>[] = []

function clearTimers(): void {
  for (const timer of timers) clearTimeout(timer)
  timers = []
}

function swapTo(text: string): void {
  whisper.swapping = true
  timers.push(
    setTimeout(() => {
      whisper.text = text
      whisper.swapping = false
    }, WHISPER_SWAP_MS),
  )
}

/**
 * Walk the steps with timed swaps and clear at the end.
 * A new show cancels any prior walk, exactly like ei's `whisper(steps)`.
 */
export function showWhisper(steps: WhisperStep[]): void {
  clearTimers()
  let t = 0
  for (const step of steps) {
    timers.push(setTimeout(() => swapTo(step.text), t))
    t += Math.max(0, step.durationMs)
  }
  timers.push(setTimeout(() => swapTo(''), t))
}

/** Stop the walk and clear the line immediately. */
export function resetWhisper(): void {
  clearTimers()
  whisper.text = ''
  whisper.swapping = false
}
