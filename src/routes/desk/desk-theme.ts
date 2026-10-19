/**
 * Desk palette: resolves the app's CSS variables (hex, rgb(), oklch — light and
 * dark) into sRGB floats for three.js. Pure functions; no DOM, no three.js.
 * The guardrail policy applies: no implicit color defaults — a missing variable
 * is a hard error.
 */

export type Rgb = { r: number; g: number; b: number }

export type DeskPalette = {
  /** Scene backdrop (page background). */
  background: Rgb
  /** Desk surface. */
  desk: Rgb
  /** Loose sheet / pile paper front. */
  paper: Rgb
  /** Slightly shaded paper for pile sides / edges. */
  paperShade: Rgb
  /** Wall behind the desk. */
  wall: Rgb
  /** Receded wall shade for the far edges of the wall. */
  wallShade: Rgb
  /** Primary text / ink. */
  foreground: Rgb
  /** Secondary text / ink. */
  muted: Rgb
  /** Eigen green accent. */
  accent: Rgb
  /** Eigen lime accent. */
  accentAlt: Rgb
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function srgbEncode(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** OKLCH (L 0..1, C, H degrees) → sRGB [0,1]. Out-of-gamut channels clamp. */
export function oklchToRgb(l: number, c: number, hDegrees: number): Rgb {
  const hRad = (hDegrees * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const L = l_ * l_ * l_
  const M = m_ * m_ * m_
  const S = s_ * s_ * s_

  return {
    r: clamp01(srgbEncode(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S)),
    g: clamp01(srgbEncode(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S)),
    b: clamp01(srgbEncode(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S)),
  }
}

function parseNumberList(value: string): number[] {
  const withoutAlpha = value.split('/')[0]
  const nums = withoutAlpha.match(/-?\d+(?:\.\d+)?%?/g)
  if (!nums || nums.length < 3) throw new Error(`Unsupported color: "${value}"`)
  return nums.map((n) => (n.endsWith('%') ? parseFloat(n) / 100 : parseFloat(n)))
}

/** Parse the CSS color forms the app theme uses (#hex, rgb(), oklch()) to sRGB. */
export function cssColorToRgb(input: string): Rgb {
  const value = input.trim().toLowerCase()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
      }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
      }
    }
    throw new Error(`Unsupported hex color: "${input}"`)
  }
  if (value.startsWith('rgb(') || value.startsWith('rgba(')) {
    const [r, g, b] = parseNumberList(value.slice(value.indexOf('(') + 1))
    // rgb() channel numbers are 0-255; percentages are already 0-1.
    const scale = (v: number) => (v > 1 ? v / 255 : v)
    return { r: clamp01(scale(r)), g: clamp01(scale(g)), b: clamp01(scale(b)) }
  }
  if (value.startsWith('oklch(')) {
    const [l, c, h] = parseNumberList(value.slice(value.indexOf('(') + 1))
    return oklchToRgb(l, c, h)
  }
  throw new Error(`Unsupported color: "${input}"`)
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

export function shadeRgb(color: Rgb, amount: number): Rgb {
  return mixRgb(color, { r: 0, g: 0, b: 0 }, amount)
}

const REQUIRED_VARIABLES = [
  '--background',
  '--card',
  '--secondary',
  '--foreground',
  '--muted-foreground',
  '--color-eigen-green',
  '--color-eigen-lime',
] as const

/**
 * Map app theme variables onto desk material colors. Throws when a variable is
 * missing or unparsable — the desk renders in the app's real palette or not at all.
 */
export function resolveDeskPalette(read: (name: string) => string | null | undefined): DeskPalette {
  const missing = REQUIRED_VARIABLES.filter((name) => !read(name)?.trim())
  if (missing.length > 0) {
    throw new Error(`Desk palette missing CSS variables: ${missing.join(', ')}`)
  }
  const background = cssColorToRgb(read('--background')!)
  const foreground = cssColorToRgb(read('--foreground')!)
  // Pull paper a touch toward the ink color so sheets stay legible against the
  // desk in dark mode (where --card and the desk surface are nearly identical).
  const paper = mixRgb(cssColorToRgb(read('--card')!), foreground, 0.06)
  return {
    background,
    // Pull the desk toward paper so it reads as a lit surface against the backdrop.
    desk: mixRgb(cssColorToRgb(read('--secondary')!), paper, 0.35),
    paper,
    paperShade: shadeRgb(paper, 0.06),
    wall: shadeRgb(background, 0.35),
    wallShade: shadeRgb(background, 0.5),
    foreground: cssColorToRgb(read('--foreground')!),
    muted: cssColorToRgb(read('--muted-foreground')!),
    accent: cssColorToRgb(read('--color-eigen-green')!),
    accentAlt: cssColorToRgb(read('--color-eigen-lime')!),
  }
}
