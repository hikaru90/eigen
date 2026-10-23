/* Settle motion helpers, ported from ei app.js: a captured thought never pops — its words
   condense into a dot (`releaseGhostWords`), the dot flies a bezier into its slot with a
   strand of yarn behind it (`flyThought` + `yarnTrail`), and everything eases out long.
   Called from event boundaries (capture submit, vote, …) — never from `$effect`.
   All helpers respect `prefers-reduced-motion` by skipping (or snapping to the end state)
   and are safe to call during SSR (no document -> no-op / immediate arrival). */

export type Point = { x: number; y: number }
export type Rect = { left: number; right: number; top: number; bottom: number }

/** ei app.js:9 and styles.css `--ease`. */
export const EASE = 'cubic-bezier(.22,1,.36,1)'
/** ei app.js:540 — the flight/trail easing. */
export const FLIGHT_EASE = 'cubic-bezier(.6,0,.2,1)'
/** ei app.js:478 — the released words' condense easing. */
export const GHOST_EASE = 'cubic-bezier(.5,0,.2,1)'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TRAIL_LIFE_MS = 900
const GHOST_LIFE_MS = 1100
/** Defaults from the design tokens; plain fallbacks keep the helpers usable before wave 1 lands. */
const SIGNAL = 'var(--signal, #3a52e6)'
const SIGNAL_HALO = 'var(--signal-2, rgba(58, 82, 230, 0.13))'
const INK = 'var(--ink, #141413)'

const r2 = (n: number): number => +n.toFixed(2)

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ————— pure flight geometry ————— */

/** ei app.js:532 — the flight's bezier control point. */
export function flightControl(x0: number, y0: number, x1: number, y1: number): Point {
  return { x: (x0 + x1) / 2 + 70, y: y0 + (y1 - y0) * 0.3 }
}

/** Point on the quadratic bezier at t. */
export function quadPoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  t: number,
): Point {
  const u = 1 - t
  return {
    x: u * u * x0 + 2 * u * t * cx + t * t * x1,
    y: u * u * y0 + 2 * u * t * cy + t * t * y1,
  }
}

/** ei app.js:534-539 — WAAPI transform frames for the dot's flight (scales 1 -> 0.7). */
export function flightFrames(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  control: Point,
  steps = 28,
): string[] {
  const frames: string[] = []
  for (let i = 0; i <= steps; i++) {
    const s = i / steps
    const p = quadPoint(x0, y0, control.x, control.y, x1, y1, s)
    frames.push(`translate(${r2(p.x)}px, ${r2(p.y)}px) scale(${r2(1 - 0.3 * s)})`)
  }
  return frames
}

/* ————— released words (the ghost) ————— */

/** ei app.js:469 — the point the released words condense into. */
export function gatherCenter(rects: Rect[]): Point {
  const left = Math.min(...rects.map((q) => q.left))
  const right = Math.max(...rects.map((q) => q.right))
  const top = Math.min(...rects.map((q) => q.top))
  const bottom = Math.max(...rects.map((q) => q.bottom))
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

/** ei app.js:478 — word i starts a little later, capped so long thoughts stay in step. */
export function condenseDelay(index: number): number {
  return Math.min(index * 16, 240)
}

/**
 * Split into word/space tokens for the ghost's spans (layout tokenization only —
 * no meaning is decided here).
 */
export function splitGhostWords(text: string): { kind: 'word' | 'space'; text: string }[] {
  const tokens: { kind: 'word' | 'space'; text: string }[] = []
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue
    tokens.push({ kind: /^\s+$/.test(part) ? 'space' : 'word', text: part })
  }
  return tokens
}

/** ei app.js:473-477 — where a ghost word travels: 62% of the way to the gather point. */
function condenseTransform(rect: Rect, center: Point): string {
  const dx = center.x - (rect.left + (rect.right - rect.left) / 2)
  const dy = center.y - (rect.top + (rect.bottom - rect.top) / 2)
  return `translate(${r2(dx * 0.62)}px, ${r2(dy * 0.62)}px) scale(.55)`
}

/**
 * The released-words ghost: the field's words lift out as a fixed overlay, each word
 * condensing toward the returned gather point; the overlay cleans itself up.
 * Reduced motion (or no document): nothing renders and the caller skips the flight.
 */
export function releaseGhostWords(source: HTMLElement, text: string): Point | null {
  if (typeof document === 'undefined' || prefersReducedMotion()) return null
  const tokens = splitGhostWords(text)
  if (!tokens.some((t) => t.kind === 'word')) return null

  const cs = getComputedStyle(source)
  const r = source.getBoundingClientRect()
  const ghost = document.createElement('div')
  ghost.className = 'settle-ghost'
  ghost.style.cssText =
    'position:fixed;z-index:40;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;' +
    `left:${r.left}px;top:${r.top}px;width:${r.width}px;` +
    `font-size:${cs.fontSize};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing};` +
    `font-family:${cs.fontFamily};color:${INK}`
  for (const token of tokens) {
    if (token.kind === 'space') {
      ghost.append(token.text.includes('\n') ? '\n' : ' ')
    } else {
      const span = document.createElement('span')
      span.textContent = token.text
      span.style.display = 'inline-block'
      span.style.willChange = 'transform, opacity, filter'
      ghost.append(span)
    }
  }
  document.body.append(ghost)

  const spans = Array.from(ghost.querySelectorAll<HTMLElement>('span'))
  const rects = spans.map((s) => s.getBoundingClientRect())
  const center = gatherCenter(rects)
  spans.forEach((span, i) => {
    span
      .animate(
        [
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
          { opacity: 0, transform: condenseTransform(rects[i], center), filter: 'blur(8px)' },
        ],
        { duration: 720, delay: condenseDelay(i), easing: GHOST_EASE, fill: 'forwards' },
      )
  })
  setTimeout(() => ghost.remove(), GHOST_LIFE_MS)
  return center
}

/* ————— the yarn trail ————— */

/**
 * A thought never travels alone: it pulls a strand of yarn behind it
 * (ei app.js:501-514). The strand draws itself along the quadratic curve, then fades.
 */
export function yarnTrail(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  options: { color?: string; durationMs?: number; easing?: string } = {},
): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) return
  const { color = SIGNAL, durationMs = 860, easing = FLIGHT_EASE } = options
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:40;pointer-events:none;overflow:visible'
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', `M${x0} ${y0}Q${cx} ${cy} ${x1} ${y1}`)
  path.style.fill = 'none'
  path.style.stroke = color
  path.style.strokeWidth = '1.3'
  path.style.strokeLinecap = 'round'
  path.style.strokeOpacity = '0.55'
  svg.append(path)
  document.body.append(svg)
  const length = path.getTotalLength()
  path.style.strokeDasharray = `${length}`
  path
    .animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: durationMs, easing, fill: 'forwards' })
    .onfinish = () => {
      svg
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: TRAIL_LIFE_MS, easing: EASE, fill: 'forwards' })
        .onfinish = () => svg.remove()
    }
}

/* ————— the flying dot ————— */

function toPoint(from: Point | DOMRect): Point {
  return 'left' in from
    ? { x: from.left + from.width / 2, y: from.top + from.height / 2 }
    : { x: from.x, y: from.y }
}

/**
 * The dot that carries a thought (ei app.js:516-548): it gathers at `from`, then flies a
 * bezier to the center of `toEl` with a yarn trail behind it. `onArrive` fires when it
 * lands (the consumer leans the target icon, whispers, …).
 * Reduced motion snaps: no dot, immediate arrival.
 */
export function flyThought(
  from: Point | DOMRect,
  toEl: Element,
  options: {
    color?: string
    haloColor?: string
    durationMs?: number
    easing?: string
    onArrive?: () => void
  } = {},
): void {
  const { x: x0, y: y0 } = toPoint(from)
  const arrive = () => options.onArrive?.()
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    arrive()
    return
  }
  const { color = SIGNAL, haloColor = SIGNAL_HALO, durationMs = 860, easing = FLIGHT_EASE } = options

  const dot = document.createElement('div')
  dot.style.cssText =
    'position:fixed;left:0;top:0;z-index:41;width:8px;height:8px;margin:-4px 0 0 -4px;' +
    'border-radius:50%;pointer-events:none;' +
    `background:${color};box-shadow:0 0 0 5px ${haloColor}`
  document.body.append(dot)

  const here = `translate(${x0}px, ${y0}px)`
  const gather = dot.animate(
    [
      { transform: `${here} scale(0)`, opacity: 0 },
      { transform: `${here} scale(1.6)`, opacity: 1, offset: 0.55 },
      { transform: `${here} scale(1)`, opacity: 1 },
    ],
    { duration: 620, delay: 200, easing: EASE, fill: 'both' },
  )
  gather.onfinish = () => {
    const rect = toEl.getBoundingClientRect()
    const x1 = rect.left + rect.width / 2
    const y1 = rect.top + rect.height / 2
    const control = flightControl(x0, y0, x1, y1)
    const fly = dot.animate(
      flightFrames(x0, y0, x1, y1, control).map((transform) => ({ transform })),
      { duration: durationMs, easing, fill: 'forwards' },
    )
    yarnTrail(x0, y0, control.x, control.y, x1, y1, { color, durationMs, easing })
    gather.cancel()
    fly.onfinish = () => {
      dot.remove()
      arrive()
    }
  }
}
