import { describe, expect, it } from 'vitest'
import { COMMUNITY_HULL_GRADIENT, COMMUNITY_HULL_GRADIENT_DARK } from './community-hull'
import {
  createDrawScheduler,
  drawGraphCanvasScene,
  findNearestGraphNode,
  popInNodeScale,
  readGraphCanvasTheme,
  roundTripScreenWorld,
  screenToWorld,
  type FrameScheduler,
  type GraphCanvasNode,
  type GraphCanvasScene,
  worldToScreen,
} from './graph-canvas-render'

/** Minimal ctx that records paint ops so we can assert label z-order. */
function recordingCanvasContext() {
  const ops: string[] = []
  const ctx = {
    ops,
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    translate() {},
    scale() {},
    beginPath() {},
    arc() {
      ops.push('arc')
    },
    moveTo() {},
    lineTo() {},
    fill() {
      ops.push('fill')
    },
    stroke() {
      ops.push('stroke')
    },
    fillText(text: string) {
      ops.push(`fillText:${text}`)
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
    setLineDash() {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    shadowColor: '',
    shadowBlur: 0,
  }
  return ctx as unknown as CanvasRenderingContext2D & { ops: string[] }
}

describe('screenToWorld / worldToScreen', () => {
  const transform = { k: 2, x: 100, y: 50 }

  it('inverts zoom translate + scale', () => {
    expect(screenToWorld(200, 150, transform)).toEqual({ x: 50, y: 50 })
    expect(worldToScreen(50, 50, transform)).toEqual({ x: 200, y: 150 })
  })

  it('round-trips within tolerance', () => {
    const back = roundTripScreenWorld(320, 480, transform)
    expect(back.x).toBeCloseTo(320, 5)
    expect(back.y).toBeCloseTo(480, 5)
  })
})

describe('findNearestGraphNode', () => {
  const nodes: GraphCanvasNode[] = [
    { id: 'a', x: 0, y: 0, radius: 8, fill: '#fff', label: 'A', selected: false },
    { id: 'b', x: 40, y: 0, radius: 8, fill: '#fff', label: 'B', selected: false },
  ]

  it('returns the nearest node within hit radius', () => {
    expect(findNearestGraphNode(2, 1, nodes)?.id).toBe('a')
    expect(findNearestGraphNode(38, 0, nodes)?.id).toBe('b')
  })

  it('returns null when outside all hit radii', () => {
    expect(findNearestGraphNode(20, 0, nodes)).toBeNull()
  })
})

describe('popInNodeScale', () => {
  it('starts small and ends at 1', () => {
    expect(popInNodeScale(0, 520)).toBeCloseTo(0.08, 2)
    expect(popInNodeScale(520, 520)).toBe(1)
  })
})

describe('createDrawScheduler', () => {
  it('coalesces a burst of requestDraw calls into one draw on flush', () => {
    const queued: Array<() => void> = []
    const frame: FrameScheduler = {
      request: (cb) => {
        queued.push(cb)
        return queued.length
      },
      cancel: () => {},
    }

    let count = 0
    const scheduler = createDrawScheduler(() => {
      count++
    }, frame)

    scheduler.requestDraw()
    scheduler.requestDraw()
    scheduler.requestDraw()
    expect(count).toBe(0)
    expect(queued).toHaveLength(1)

    queued[0]()
    expect(count).toBe(1)
    scheduler.dispose()
  })
})

describe('drawGraphCanvasScene label paint order', () => {
  it('draws every node label after every node body so labels are never under a neighboring node', () => {
    const ctx = recordingCanvasContext()
    const scene: GraphCanvasScene = {
      width: 200,
      height: 200,
      dpr: 1,
      transform: { k: 1, x: 0, y: 0 },
      zoomScale: 1,
      hulls: [],
      links: [],
      nodes: [
        { id: 'a', x: 0, y: 0, radius: 8, fill: '#fff', label: 'Alpha', selected: false },
        { id: 'b', x: 10, y: 0, radius: 8, fill: '#fff', label: 'Beta', selected: false },
      ],
      popIns: [],
      nowMs: 0,
      theme: {
        edgeColor: '#000',
        edgeOpacity: 0.35,
        nodeStrokeColor: '#000',
        labelColor: '#000',
        selectedStroke: '#fbbf24',
        hullGradient: COMMUNITY_HULL_GRADIENT,
      },
    }

    drawGraphCanvasScene(ctx, scene)

    const firstLabel = ctx.ops.findIndex((op) => op.startsWith('fillText:'))
    expect(firstLabel).toBeGreaterThan(-1)
    const fillsBeforeLabels = ctx.ops.slice(0, firstLabel).filter((op) => op === 'fill')
    // One filled arc body per node must precede any label paint.
    expect(fillsBeforeLabels.length).toBeGreaterThanOrEqual(2)
    expect(ctx.ops.filter((op) => op.startsWith('fillText:'))).toEqual([
      'fillText:Alpha',
      'fillText:Beta',
    ])
  })
})

describe('readGraphCanvasTheme', () => {
  function stubContainer(dark: boolean): HTMLElement {
    const classList = {
      contains(token: string) {
        return dark && token === 'dark'
      },
    }
    const documentElement = { classList }
    const ownerDocument = { documentElement }
    return {
      ownerDocument,
      // getComputedStyle is called on the container; stub via a global override below.
    } as unknown as HTMLElement
  }

  it('picks the dark green hull gradient when documentElement has .dark', () => {
    const prev = globalThis.getComputedStyle
    globalThis.getComputedStyle = (() => ({ color: '#eee' })) as typeof getComputedStyle
    try {
      expect(readGraphCanvasTheme(stubContainer(true)).hullGradient).toBe(
        COMMUNITY_HULL_GRADIENT_DARK,
      )
    } finally {
      globalThis.getComputedStyle = prev
    }
  })

  it('picks the white hull gradient when documentElement is light', () => {
    const prev = globalThis.getComputedStyle
    globalThis.getComputedStyle = (() => ({ color: '#111' })) as typeof getComputedStyle
    try {
      expect(readGraphCanvasTheme(stubContainer(false)).hullGradient).toBe(COMMUNITY_HULL_GRADIENT)
    } finally {
      globalThis.getComputedStyle = prev
    }
  })
})
