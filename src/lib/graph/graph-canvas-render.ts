import {
  COMMUNITY_HULL_ACCENT,
  COMMUNITY_HULL_GRADIENT,
  COMMUNITY_LEAF_LEVEL,
  communityHullChromeStyleForLevel,
  communityHullFillOpacityForZoom,
  communityHullUsesRadialGradient,
  type CommunityHullChromeStyle,
} from './community-hull'

export type ZoomTransform = { k: number; x: number; y: number }

export type GraphCanvasNode = {
  id: string
  x: number
  y: number
  radius: number
  fill: string
  label: string
  selected: boolean
}

export type GraphCanvasLink = {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

export type GraphCanvasHull = {
  id: string
  level: number
  cx: number
  cy: number
  r: number
}

export type GraphCanvasTheme = {
  edgeColor: string
  edgeOpacity: number
  nodeStrokeColor: string
  labelColor: string
  selectedStroke: string
}

export type GraphCanvasPopIn = {
  nodeId: string
  startMs: number
  durationMs: number
}

export const GRAPH_CANVAS_POP_IN_DURATION_MS = 520
export const GRAPH_NODE_HIT_PADDING = 4

/** Invert a d3-style zoom transform (screen px → graph world coords). */
export function screenToWorld(
  screenX: number,
  screenY: number,
  transform: ZoomTransform,
): { x: number; y: number } {
  const k = transform.k || 1
  return {
    x: (screenX - transform.x) / k,
    y: (screenY - transform.y) / k,
  }
}

/** Apply a d3-style zoom transform (graph world → screen px). */
export function worldToScreen(
  worldX: number,
  worldY: number,
  transform: ZoomTransform,
): { x: number; y: number } {
  return {
    x: worldX * transform.k + transform.x,
    y: worldY * transform.k + transform.y,
  }
}

/** Round-trip screen → world → screen within floating-point tolerance. */
export function roundTripScreenWorld(
  screenX: number,
  screenY: number,
  transform: ZoomTransform,
): { x: number; y: number } {
  const world = screenToWorld(screenX, screenY, transform)
  return worldToScreen(world.x, world.y, transform)
}

/** Pick the nearest node whose center lies within its hit radius (+ optional padding). */
export function findNearestGraphNode(
  worldX: number,
  worldY: number,
  nodes: ReadonlyArray<GraphCanvasNode>,
  extraHitPadding = GRAPH_NODE_HIT_PADDING,
): GraphCanvasNode | null {
  let best: GraphCanvasNode | null = null
  let bestDist = Infinity
  for (const node of nodes) {
    const hitR = node.radius + extraHitPadding
    const dist = Math.hypot(worldX - node.x, worldY - node.y)
    if (dist <= hitR && dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  return best
}

/** Pop-in scale factor (0.08 → 1) with cubic ease-out, matching prior SVG transition. */
export function popInNodeScale(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0) return 0.08
  if (elapsedMs >= durationMs) return 1
  const t = elapsedMs / durationMs
  const eased = 1 - Math.pow(1 - t, 3)
  return 0.08 + eased * 0.92
}

/** Pop-in flash background opacity (peak ~0.4 at midpoint, then fade). */
export function popInFlashOpacity(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0
  const t = elapsedMs / durationMs
  if (t < 0.5) return 0.4 * (t / 0.5)
  return 0.4 * (1 - (t - 0.5) / 0.5)
}

/** Pop-in ring opacity (peak ~0.6 early, then fade). */
export function popInRingOpacity(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0
  const t = elapsedMs / durationMs
  if (t < 0.35) return 0.6 * (t / 0.35)
  return 0.6 * (1 - (t - 0.35) / 0.65)
}

/** Pop-in ring radius expansion beyond node core. */
export function popInRingExtraRadius(
  elapsedMs: number,
  durationMs: number,
  maxExtra: number,
): number {
  if (elapsedMs <= 0) return 0
  if (elapsedMs >= durationMs) return 0
  const t = elapsedMs / durationMs
  return maxExtra * Math.min(1, t * 1.8)
}

export type FrameScheduler = {
  request: (callback: () => void) => number
  cancel: (id: number) => void
}

const defaultFrameScheduler: FrameScheduler = {
  request: (callback) =>
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame(callback)
      : (setTimeout(callback, 0) as unknown as number),
  cancel: (id) =>
    typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame(id) : clearTimeout(id),
}

export type DrawScheduler = {
  requestDraw: () => void
  dispose: () => void
}

/** Coalesce multiple dirty marks into a single draw per animation frame. */
export function createDrawScheduler(
  draw: () => void,
  frame: FrameScheduler = defaultFrameScheduler,
): DrawScheduler {
  let frameId: number | null = null
  let pending = false

  function flush() {
    frameId = null
    if (!pending) return
    pending = false
    draw()
  }

  function requestDraw() {
    pending = true
    if (frameId !== null) return
    frameId = frame.request(flush)
  }

  function dispose() {
    if (frameId !== null) {
      frame.cancel(frameId)
      frameId = null
    }
    pending = false
  }

  return { requestDraw, dispose }
}

function applyZoomTransform(ctx: CanvasRenderingContext2D, transform: ZoomTransform, dpr: number) {
  ctx.setTransform(dpr * transform.k, 0, 0, dpr * transform.k, dpr * transform.x, dpr * transform.y)
}

function drawDashedCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  style: CommunityHullChromeStyle,
) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.strokeWidth
  ctx.globalAlpha = style.strokeOpacity
  const parts = style.strokeDasharray.split(/[\s,]+/).map(Number)
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    ctx.setLineDash(parts)
  }
  ctx.stroke()
  ctx.restore()
}

function drawHullFill(ctx: CanvasRenderingContext2D, hull: GraphCanvasHull, zoomScale: number) {
  const opacity = communityHullFillOpacityForZoom(zoomScale, hull.level)
  ctx.save()
  ctx.globalAlpha = opacity

  if (communityHullUsesRadialGradient(hull.level)) {
    const grad = ctx.createRadialGradient(hull.cx, hull.cy, 0, hull.cx, hull.cy, hull.r)
    grad.addColorStop(0, COMMUNITY_HULL_GRADIENT.center)
    grad.addColorStop(0.65, COMMUNITY_HULL_GRADIENT.mid)
    grad.addColorStop(1, COMMUNITY_HULL_GRADIENT.edge)
    ctx.fillStyle = grad
  } else if (hull.level === 1) {
    ctx.fillStyle = 'oklch(1 0 0 / 0.08)'
  } else {
    ctx.fillStyle = 'oklch(1 0 0 / 0.04)'
  }

  ctx.beginPath()
  ctx.arc(hull.cx, hull.cy, hull.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export type GraphCanvasScene = {
  width: number
  height: number
  dpr: number
  transform: ZoomTransform
  zoomScale: number
  hulls: ReadonlyArray<GraphCanvasHull>
  links: ReadonlyArray<GraphCanvasLink>
  nodes: ReadonlyArray<GraphCanvasNode>
  popIns: ReadonlyArray<GraphCanvasPopIn>
  nowMs: number
  theme: GraphCanvasTheme
}

/** Paint hull fills/borders, edges, and nodes onto a 2D canvas context. */
export function drawGraphCanvasScene(ctx: CanvasRenderingContext2D, scene: GraphCanvasScene) {
  const { width, height, dpr, transform, zoomScale, hulls, links, nodes, popIns, nowMs, theme } =
    scene

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.restore()

  applyZoomTransform(ctx, transform, dpr)

  for (const hull of hulls) {
    drawHullFill(ctx, hull, zoomScale)
    const chrome = communityHullChromeStyleForLevel(hull.level)
    drawDashedCircle(ctx, hull.cx, hull.cy, hull.r, chrome)
  }

  ctx.save()
  ctx.strokeStyle = theme.edgeColor
  ctx.globalAlpha = theme.edgeOpacity
  ctx.lineWidth = 1.2 / Math.max(transform.k, 0.001)
  ctx.beginPath()
  for (const link of links) {
    ctx.moveTo(link.sourceX, link.sourceY)
    ctx.lineTo(link.targetX, link.targetY)
  }
  ctx.stroke()
  ctx.restore()

  const popInById = new Map(popIns.map((p) => [p.nodeId, p]))
  const invK = 1 / Math.max(transform.k, 0.001)
  const labelFont = `${10 * invK}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
  const labelOffsetX = 12 * invK
  const labelOffsetY = 4 * invK

  // Pass 1: node bodies (and pop-in chrome). Labels are deferred so a later
  // neighbor never paints over an earlier node's text.
  for (const node of nodes) {
    const popIn = popInById.get(node.id)
    const elapsed = popIn ? nowMs - popIn.startMs : GRAPH_CANVAS_POP_IN_DURATION_MS
    const scale = popIn ? popInNodeScale(elapsed, popIn.durationMs) : 1
    const flashOpacity = popIn ? popInFlashOpacity(elapsed, popIn.durationMs) : 0
    const ringOpacity = popIn ? popInRingOpacity(elapsed, popIn.durationMs) : 0
    const ringExtra = popIn ? popInRingExtraRadius(elapsed, popIn.durationMs, 24) : 0

    ctx.save()
    ctx.translate(node.x, node.y)
    ctx.scale(scale, scale)

    if (flashOpacity > 0) {
      ctx.beginPath()
      ctx.arc(0, 0, node.radius + 5, 0, Math.PI * 2)
      ctx.fillStyle = COMMUNITY_HULL_ACCENT
      ctx.globalAlpha = flashOpacity
      ctx.fill()
      ctx.globalAlpha = 1
    }

    if (ringOpacity > 0) {
      ctx.beginPath()
      ctx.arc(0, 0, node.radius + ringExtra, 0, Math.PI * 2)
      ctx.strokeStyle = COMMUNITY_HULL_ACCENT
      ctx.lineWidth = 2 * invK
      ctx.globalAlpha = ringOpacity
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    if (node.selected) {
      ctx.shadowColor = theme.selectedStroke
      ctx.shadowBlur = 8 * invK
    }

    ctx.beginPath()
    ctx.arc(0, 0, node.radius, 0, Math.PI * 2)
    ctx.fillStyle = node.fill
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = node.selected ? theme.selectedStroke : theme.nodeStrokeColor
    ctx.lineWidth = (node.selected ? 3.2 : 1) * invK
    ctx.stroke()

    ctx.restore()
  }

  // Pass 2: labels on top of every node body.
  ctx.fillStyle = theme.labelColor
  ctx.font = labelFont
  ctx.textBaseline = 'middle'
  for (const node of nodes) {
    const popIn = popInById.get(node.id)
    const elapsed = popIn ? nowMs - popIn.startMs : GRAPH_CANVAS_POP_IN_DURATION_MS
    const scale = popIn ? popInNodeScale(elapsed, popIn.durationMs) : 1

    ctx.save()
    ctx.translate(node.x, node.y)
    ctx.scale(scale, scale)
    ctx.fillText(node.label, labelOffsetX, labelOffsetY)
    ctx.restore()
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** Resolve CSS color tokens used by the graph canvas (foreground, muted). */
export function readGraphCanvasTheme(container: HTMLElement): GraphCanvasTheme {
  const style = getComputedStyle(container)
  const foreground = style.color || '#e5e5e5'
  return {
    edgeColor: foreground,
    edgeOpacity: 0.35,
    nodeStrokeColor: foreground,
    labelColor: foreground,
    selectedStroke: '#fbbf24',
  }
}

export { COMMUNITY_LEAF_LEVEL }
