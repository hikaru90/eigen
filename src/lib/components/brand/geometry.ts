/* Eigenmesh brand geometry, ported 1:1 from the ei prototype so every surface draws the
   same shapes:
   - menu icons: ei `assets/menu-icons.js` (resting squares, links and the capture arc)
   - the mark: ei `assets/logo.js` scene (six uneven squares, seven center-to-center links)
   - the spinner triangle: ei `assets/spinner.js` (the ask icon's three squares)
   - yarn waves: ei `assets/menu-icons.js` `wavy`/`wavyArc` (the one yarn shape, `--yarn-wave`)
   Pure path math only — no DOM, no randomness, no semantic decisions. */

export type Point = { x: number; y: number }
export type Tile = [x: number, y: number, halfSize: number]

const r2 = (n: number): number => +n.toFixed(2)

/* ————— menu icons (ei assets/menu-icons.js:11-21) ————— */

export const MENU_SQ = 4.4
export const MENU_HALF = MENU_SQ / 2
export const MENU_CORNER = 0.55
export const MENU_LINK_WIDTH = 0.6
/** Radius of the capture icon's open arc (gap on the right). */
export const MENU_ARC_RADIUS = 7.88
/** ei assets/menu-icons.js body(): the arc's resting path. */
export const ARC_PATH = 'M5.57 -5.57A7.88 7.88 0 1 0 5.57 5.57'

export type MenuIcon = {
  squares: [x: number, y: number][]
  links: [a: number, b: number][]
  arc: boolean
}

export const MENU_ICONS = {
  capture: { squares: [[0, 0]], links: [], arc: true },
  mesh: { squares: [[-7.7, 0], [7.7, 0]], links: [[0, 1]], arc: false },
  ask: {
    squares: [
      [0, -8.2],
      [-7.5, 6.6],
      [7.5, 6.6],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
    arc: false,
  },
} satisfies Record<string, MenuIcon>

export type MenuKind = keyof typeof MENU_ICONS

/** Straight center-to-center link, as the logo draws them. */
export function linkPath(a: [number, number], b: [number, number]): string {
  return `M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}`
}

/* ————— the yarn wave (ei assets/menu-icons.js:100-121) ————— */

export type WavyOptions = {
  /** Wave height in CSS pixels (the strand's swing either side of the straight line). */
  amplitude?: number
  /** Full waves along the strand. */
  waves?: number
  /** Polyline samples. */
  samples?: number
  /** Sine envelope so the wave fades to zero at both pinned ends. */
  envelope?: number
}

/**
 * A soft wave along a link, pinned at both squares (ei assets/menu-icons.js `wavy`).
 * `amplitude: 0` degenerates to the straight link.
 */
export function wavyPath(
  a: [number, number],
  b: [number, number],
  options: WavyOptions & { amplitude: number },
): string {
  const { amplitude, waves = 1, samples = 18, envelope = 2.2 } = options
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 0.05 || amplitude < 0.01) return `M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}`
  const nx = -dy / len
  const ny = dx / len
  const k = Math.max(1, Math.round(waves))
  let d = `M${r2(a[0])} ${r2(a[1])}`
  for (let s = 1; s <= samples; s++) {
    const t = s / samples
    const o = amplitude * Math.sin(t * k * 2 * Math.PI) * Math.min(1, Math.sin(t * Math.PI) * envelope)
    d += `L${r2(a[0] + dx * t + nx * o)} ${r2(a[1] + dy * t + ny * o)}`
  }
  return d
}

/** The menu icon's wave: amplitude 0.75, one wave per 6px of strand (menu-icons.js WAVE/AMP). */
export function menuWavy(a: [number, number], b: [number, number]): string {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  return wavyPath(a, b, {
    amplitude: 0.75,
    waves: len / 6,
    samples: Math.max(4, Math.ceil(len / 0.9)),
  })
}

/** The spinner's wave: amplitude 0.7, two waves over 18 samples (spinner.js `wavy`). */
export function spinnerWavy(a: [number, number], b: [number, number]): string {
  return wavyPath(a, b, { amplitude: 0.7, waves: 2, samples: 18 })
}

/**
 * Capture's open arc, wobbling the same way (ei assets/menu-icons.js `wavyArc`).
 * `wave: 0` reproduces the resting arc's geometry as a polyline.
 */
export function wavyArcPath(options: { wave: number; amplitude?: number } & Partial<WavyOptions>): string {
  const { wave, amplitude = 0.75, waves = 5, samples = 48, envelope = 3 } = options
  const R = MENU_ARC_RADIUS
  const from = Math.PI / 4
  const to = Math.PI * (7 / 4)
  let d = ''
  for (let s = 0; s <= samples; s++) {
    const t = s / samples
    const th = -(from + (to - from) * t)
    const rr = R + amplitude * wave * Math.sin(t * waves * 2 * Math.PI) * Math.min(1, Math.sin(t * Math.PI) * envelope)
    d += (s ? 'L' : 'M') + r2(rr * Math.cos(th)) + ' ' + r2(rr * Math.sin(th))
  }
  return d
}

/* ————— the mark (ei assets/logo.js scene, line 206) ————— */

/** The approved mark: six uneven soft squares in an 8x8 viewBox. */
export const MARK_TILES: Tile[] = [
  [5.35, 6.75, 0.7225],
  [6.75, 3, 0.7036],
  [4.55, 1.05, 0.6611],
  [2.75, 4.85, 0.6435],
  [1.9, 3, 0.6126],
  [0.95, 4.8, 0.601],
]
/** The seven fine center-to-center links between them. */
export const MARK_LINKS: [a: number, b: number][] = [
  [0, 1],
  [0, 3],
  [1, 2],
  [2, 4],
  [3, 4],
  [3, 5],
  [4, 5],
]
export const MARK_CORNER = 0.14
export const MARK_LINK_WIDTH = 0.17

/* ————— the spinner triangle (ei assets/spinner.js:11-13) ————— */

export const SPINNER_R = 6.6
/** The ask icon's three squares: one up, two below. */
export const SPINNER_PTS: [number, number][] = [
  [0, -SPINNER_R],
  [-SPINNER_R * 0.866, SPINNER_R * 0.5],
  [SPINNER_R * 0.866, SPINNER_R * 0.5],
]
export const SPINNER_LINKS: [a: number, b: number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
]
