import { describe, expect, it } from 'vitest'
import { cssColorToRgb, mixRgb, resolveDeskPalette, shadeRgb, type Rgb } from './desk-theme'

function closeTo(actual: number, expected: number, eps = 0.005) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps)
}

describe('cssColorToRgb', () => {
  it('parses 6-digit hex', () => {
    const { r, g, b } = cssColorToRgb('#22e876')
    closeTo(r, 0x22 / 255)
    closeTo(g, 0xe8 / 255)
    closeTo(b, 0x76 / 255)
  })

  it('parses 3-digit hex', () => {
    const { r, g, b } = cssColorToRgb('#f0a')
    closeTo(r, 1)
    closeTo(g, 0)
    closeTo(b, 0xaa / 255)
  })

  it('parses rgb()', () => {
    const { r, g, b } = cssColorToRgb('rgb(17, 34, 51)')
    closeTo(r, 17 / 255)
    closeTo(g, 34 / 255)
    closeTo(b, 51 / 255)
  })

  it('parses oklch black and white exactly', () => {
    const black = cssColorToRgb('oklch(0 0 0)')
    closeTo(black.r, 0)
    closeTo(black.g, 0)
    closeTo(black.b, 0)
    const white = cssColorToRgb('oklch(1 0 0)')
    closeTo(white.r, 1)
    closeTo(white.g, 1)
    closeTo(white.b, 1)
  })

  it('maps oklch chroma to a gray', () => {
    const gray = cssColorToRgb('oklch(0.5 0 180)')
    closeTo(gray.r, gray.g)
    closeTo(gray.g, gray.b)
  })

  it('keeps oklch hue direction: 145deg is green-dominant, 30deg is red-dominant', () => {
    const green = cssColorToRgb('oklch(0.7 0.15 145)')
    expect(green.g).toBeGreaterThan(green.r)
    expect(green.g).toBeGreaterThan(green.b)
    const red = cssColorToRgb('oklch(0.7 0.15 30)')
    expect(red.r).toBeGreaterThan(red.g)
    expect(red.r).toBeGreaterThan(red.b)
  })

  it('clamps out-of-gamut oklch into [0, 1]', () => {
    const clipped = cssColorToRgb('oklch(0.9 0.37 145)')
    for (const channel of [clipped.r, clipped.g, clipped.b]) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })

  it('throws on unrecognized color input (no implicit fallback)', () => {
    expect(() => cssColorToRgb('not-a-color')).toThrow()
    expect(() => cssColorToRgb('')).toThrow()
  })
})

describe('mixRgb / shadeRgb', () => {
  it('mixes colors by t', () => {
    const mixed = mixRgb({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0.25)
    closeTo(mixed.r, 0.25)
    closeTo(mixed.g, 0.25)
    closeTo(mixed.b, 0.25)
  })

  it('shadeRgb darkens toward black', () => {
    const shaded = shadeRgb({ r: 0.8, g: 0.4, b: 0.2 }, 0.5)
    closeTo(shaded.r, 0.4)
    closeTo(shaded.g, 0.2)
    closeTo(shaded.b, 0.1)
  })

  it('is identity at t=0', () => {
    const base: Rgb = { r: 0.3, g: 0.6, b: 0.9 }
    const mixed = mixRgb(base, { r: 1, g: 0, b: 0 }, 0)
    expect(mixed).toEqual(base)
  })
})

describe('resolveDeskPalette', () => {
  const LIGHT: Record<string, string> = {
    '--background': '#e8ede5',
    '--card': '#ffffff',
    '--secondary': '#f0f3f0',
    '--foreground': '#111111',
    '--muted-foreground': '#999999',
    '--border': 'rgb(17 17 17 / 10%)',
    '--color-eigen-green': '#22e876',
    '--color-eigen-lime': '#8fe01f',
  }

  function fakeRead(vars: Record<string, string>) {
    return (name: string) => vars[name]
  }

  it('maps app variables onto desk roles', () => {
    const palette = resolveDeskPalette(fakeRead(LIGHT))
    const paper = mixRgb(cssColorToRgb('#ffffff'), cssColorToRgb('#111111'), 0.06)
    expect(palette.paper).toEqual(paper)
    expect(palette.accent).toEqual(cssColorToRgb('#22e876'))
    expect(palette.accentAlt).toEqual(cssColorToRgb('#8fe01f'))
    expect(palette.foreground).toEqual(cssColorToRgb('#111111'))
    // The desk pulls toward paper so it reads as a lit surface, not background.
    expect(palette.desk).toEqual(mixRgb(cssColorToRgb('#f0f3f0'), paper, 0.35))
  })

  it('derives the wall as a darker shade of the background', () => {
    const palette = resolveDeskPalette(fakeRead(LIGHT))
    const expected = shadeRgb(cssColorToRgb('#e8ede5'), 0.35)
    expect(palette.wall).toEqual(expected)
    expect(palette.desk).not.toEqual(palette.wall)
  })

  it('resolves the dark oklch theme without fallbacks', () => {
    const dark = resolveDeskPalette(
      fakeRead({
        '--background': 'oklch(0.215 0.015 152)',
        '--card': 'oklch(0.27 0.017 152)',
        '--secondary': 'oklch(0.28 0.015 152)',
        '--foreground': 'oklch(0.985 0.005 152)',
        '--muted-foreground': 'oklch(0.705 0.02 152)',
        '--border': 'oklch(0.92 0.02 152 / 12%)',
        '--color-eigen-green': '#22e876',
        '--color-eigen-lime': '#8fe01f',
      }),
    )
    // Dark background must stay dark in sRGB terms.
    const luminance = 0.2126 * dark.background.r + 0.7152 * dark.background.g + 0.0722 * dark.background.b
    expect(luminance).toBeLessThan(0.25)
  })

  it('throws listing missing variables instead of defaulting', () => {
    expect(() => resolveDeskPalette(fakeRead({ '--background': '#fff' }))).toThrow(
      /--card.*--secondary|--secondary.*--card/s,
    )
  })
})
