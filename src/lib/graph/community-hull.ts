/** Centroid + enclosing radius for member node positions (graph coordinates). */
export function communityCircleFromPositions(
  positions: ReadonlyArray<{ x: number; y: number }>,
  padding = 28,
): { cx: number; cy: number; r: number } | null {
  if (positions.length === 0) return null
  let cx = 0
  let cy = 0
  for (const p of positions) {
    cx += p.x
    cy += p.y
  }
  cx /= positions.length
  cy /= positions.length
  let maxDist = 0
  for (const p of positions) {
    maxDist = Math.max(maxDist, Math.hypot(p.x - cx, p.y - cy))
  }
  return { cx, cy, r: Math.max(padding, maxDist + padding) }
}

import { COMMUNITY_LEAF_LEVEL } from './community-levels'

export { COMMUNITY_LEAF_LEVEL }

/** Brand mesh accent — mesh.svg / DESIGN.md; community borders and label chips. */
export const COMMUNITY_HULL_ACCENT = '#22E876'

/** White radial hull fill — leaf (L2) only; light mode; pair with zoom-scaled opacity. */
export const COMMUNITY_HULL_GRADIENT = {
  center: 'oklch(1 0 0 / 0.20)',
  mid: 'oklch(1 0 0 / 0.04)',
  edge: 'oklch(1 0 0 / 0)',
}

/** Dark green radial hull fill — leaf (L2) only; dark mode (hue ~152 / eigen green). */
export const COMMUNITY_HULL_GRADIENT_DARK = {
  center: 'oklch(0.32 0.08 152 / 0.40)',
  mid: 'oklch(0.28 0.06 152 / 0.14)',
  edge: 'oklch(0.22 0.04 152 / 0)',
}

export type CommunityHullGradientStops = {
  center: string
  mid: string
  edge: string
}

export function communityHullGradient(dark: boolean): CommunityHullGradientStops {
  return dark ? COMMUNITY_HULL_GRADIENT_DARK : COMMUNITY_HULL_GRADIENT
}

export type CommunityHullChromeStyle = {
  stroke: string
  strokeWidth: number
  strokeDasharray: string
  strokeOpacity: number
}

export function communityHullUsesRadialGradient(level: number): boolean {
  return level === COMMUNITY_LEAF_LEVEL
}

export function communityHullFill(level: number): string {
  if (communityHullUsesRadialGradient(level)) {
    return `url(#${communityGradientId(level)})`
  }
  if (level === 1) return 'oklch(1 0 0 / 0.08)'
  return 'oklch(1 0 0 / 0.04)'
}

export function communityHullChromeStyleForLevel(level: number): CommunityHullChromeStyle {
  if (level === COMMUNITY_LEAF_LEVEL) {
    return {
      stroke: COMMUNITY_HULL_ACCENT,
      strokeWidth: 1.25,
      strokeDasharray: '3 4',
      strokeOpacity: 1,
    }
  }
  if (level === 1) {
    return {
      stroke: COMMUNITY_HULL_ACCENT,
      strokeWidth: 1.5,
      strokeDasharray: '8 5',
      strokeOpacity: 0.75,
    }
  }
  return {
    stroke: COMMUNITY_HULL_ACCENT,
    strokeWidth: 2,
    strokeDasharray: '14 8',
    strokeOpacity: 0.55,
  }
}

/** Fade leaf hull fills when zoomed in so large communities do not dominate the viewport. */
export function communityHullFillOpacityForZoom(scale: number, level?: number): number {
  if (level !== undefined && !communityHullUsesRadialGradient(level)) return 1
  if (!Number.isFinite(scale) || scale <= 1) return 1
  return Math.max(0.12, 1 / scale)
}

export function communityGradientId(_level?: number): string {
  return 'graph-community-fill'
}
