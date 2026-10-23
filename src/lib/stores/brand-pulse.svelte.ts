/* The header logo's work animation (ei `headerMark`, app.js:155-157/492/700/900/1017):
   whenever the mesh does work — a capture is kept, a thread is made, a pattern adopted,
   Ask is answering — the logo runs one of its three reversible effects (spin, colour-tile
   gallery, pixel-dither), exactly like ei's `headerMark.pulse(ms)` / `start()` / `stop()`.
   The engine itself (logo-engine.ts) owns the motion and the reduced-motion still; this
   store is only the bridge from any surface's event boundary to the one mounted header
   mark. SSR-safe: no calls reach the engine during SSR. */

type LogoController = {
  pulse(ms?: number): void
  start(): void
  stop(): void
}

let logo: LogoController | null = null

/** The header calls this once its LogoMark is mounted (and with null on teardown). */
export function registerLogo(controller: LogoController | null): void {
  logo = controller
}

/** ei `headerMark.pulse(ms)` — run an effect, then settle back. */
export function pulseBrand(ms = 1200): void {
  if (typeof window === 'undefined') return
  logo?.pulse(ms)
}

/** ei `headerMark.start()` — begin the working effect (Ask answering). */
export function startLogoWork(): void {
  if (typeof window === 'undefined') return
  logo?.start()
}

/** ei `headerMark.stop()` — settle back after the work is done. */
export function stopLogoWork(): void {
  if (typeof window === 'undefined') return
  logo?.stop()
}
