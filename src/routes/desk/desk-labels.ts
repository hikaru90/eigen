/**
 * Desk label layer: pure projection/culling math for DOM labels that track GPU
 * geometry. The scene applies these each frame; only visible labels get DOM nodes.
 */

export type LabelViewport = { width: number; height: number; marginPx: number }

export type ScreenPoint = { x: number; y: number }

export type ProjectedLabel = {
  screenX: number
  screenY: number
  /** Geometry behind the camera (clip w <= 0) can never be visible. */
  behind: boolean
}

export function isLabelVisible(point: ScreenPoint, viewport: LabelViewport): boolean {
  const { width, height, marginPx } = viewport
  return (
    point.x >= -marginPx &&
    point.x <= width + marginPx &&
    point.y >= -marginPx &&
    point.y <= height + marginPx
  )
}

/**
 * Project a world point through a column-major 4x4 view-projection matrix
 * (WebGL convention: matrix[12..14] is translation, matrix[3|7|11] the w row)
 * into viewport pixel coordinates with y growing downward.
 */
export function projectToScreen(
  world: { x: number; y: number; z: number },
  viewProjection: ArrayLike<number>,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedLabel {
  const { x, y, z } = world
  const m = viewProjection
  const wClip = m[3] * x + m[7] * y + m[11] * z + m[15]
  if (wClip <= 0) {
    return { screenX: 0, screenY: 0, behind: true }
  }
  const ndcX = (m[0] * x + m[4] * y + m[8] * z + m[12]) / wClip
  const ndcY = (m[1] * x + m[5] * y + m[9] * z + m[13]) / wClip
  return {
    screenX: (ndcX * 0.5 + 0.5) * viewportWidth,
    screenY: (-ndcY * 0.5 + 0.5) * viewportHeight,
    behind: false,
  }
}

/** Label text: trimmed, ellipsis-truncated like the graph labels. */
export function deskLabelText(text: string, maxLen = 42): string {
  const trimmed = text.trim()
  if (!trimmed) return '—'
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 2)}…` : trimmed
}

export type DeskLabelKind = 'project' | 'task' | 'note'

/**
 * Label styling rides Tailwind utilities as literal strings — this DOM is
 * created outside Svelte, so there is no markup to carry classes; the scanner
 * picks the utilities up from this file.
 */
const LABEL_BASE =
  'max-w-44 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-0.5 border border-border rounded-sm bg-card text-foreground font-sans text-[11px] leading-[1.3] shadow-[0_1px_2px_rgb(0_0_0/8%)] opacity-95'
const LABEL_KIND: Record<DeskLabelKind, string> = {
  project: 'bg-primary text-primary-foreground font-semibold',
  task: '',
  note: 'text-muted-foreground text-[10px] opacity-75',
}
/** Emphasized labels: full opacity, the eigen green edge. Toggled per update. */
const LABEL_EMPHASIS_CLASSES = [
  'opacity-100',
  'border-eigen-green',
  'shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--color-eigen-green)_45%,transparent)]',
]

export type DeskLabelSpec = { id: string; kind: DeskLabelKind; text: string }

export type DeskLabelUpdate = {
  id: string
  kind: DeskLabelKind
  screenX: number
  screenY: number
  visible: boolean
  emphasized: boolean
}

export type DeskLabelActivateFn = (id: string, kind: DeskLabelKind) => void
export type DeskLabelDragStartFn = (id: string, kind: DeskLabelKind, event: PointerEvent) => void
export type DeskLabelContextMenuFn = (
  id: string,
  kind: DeskLabelKind,
  screen: { x: number; y: number },
) => void

export type DeskLabelLayer = {
  setLabels: (specs: DeskLabelSpec[]) => void
  update: (updates: DeskLabelUpdate[]) => void
  bindActivate: (fn: DeskLabelActivateFn) => void
  bindDragStart: (fn: DeskLabelDragStartFn) => void
  bindContextMenu: (fn: DeskLabelContextMenuFn) => void
  dispose: () => void
}

/**
 * DOM layer that keeps crisp text anchored to GPU geometry. Labels are buttons,
 * so they double as the accessible click/drag surface for desk items (and give
 * E2E tests stable targets). Handlers are bound later by the scene to avoid
 * creation-order coupling.
 */
export function createDeskLabelLayer(container: HTMLElement): DeskLabelLayer {
  const layer = document.createElement('div')
  layer.className = 'desk-label-layer'
  layer.style.cssText =
    'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;'
  container.appendChild(layer)

  const buttonById = new Map<string, HTMLButtonElement>()
  let activate: DeskLabelActivateFn | null = null
  let dragStart: DeskLabelDragStartFn | null = null
  let contextMenu: DeskLabelContextMenuFn | null = null

  function keyOf(id: string, kind: DeskLabelKind): string {
    return `${kind}:${id}`
  }

  function setLabels(specs: DeskLabelSpec[]) {
    const seen = new Set<string>()
    for (const spec of specs) {
      const key = keyOf(spec.id, spec.kind)
      seen.add(key)
      let button = buttonById.get(key)
      if (!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = `${LABEL_BASE} ${LABEL_KIND[spec.kind]}`
        button.dataset.deskId = spec.id
        button.dataset.deskKind = spec.kind
        button.style.cssText =
          'position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;'
        button.addEventListener('click', () => activate?.(spec.id, spec.kind))
        button.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          dragStart?.(spec.id, spec.kind, event)
        })
        button.addEventListener('contextmenu', (event) => {
          if (spec.kind !== 'task') return
          event.preventDefault()
          event.stopPropagation()
          contextMenu?.(spec.id, spec.kind, { x: event.clientX, y: event.clientY })
        })
        layer.appendChild(button)
        buttonById.set(key, button)
      }
      button.textContent = deskLabelText(spec.text)
    }
    for (const [key, button] of buttonById) {
      if (!seen.has(key)) {
        button.remove()
        buttonById.delete(key)
      }
    }
  }

  function update(updates: DeskLabelUpdate[]) {
    for (const item of updates) {
      const button = buttonById.get(keyOf(item.id, item.kind))
      if (!button) continue
      if (!item.visible) {
        if (button.style.display !== 'none') button.style.display = 'none'
        continue
      }
      if (button.style.display === 'none') button.style.display = ''
      button.style.left = `${item.screenX}px`
      button.style.top = `${item.screenY}px`
      for (const cls of LABEL_EMPHASIS_CLASSES) button.classList.toggle(cls, item.emphasized)
    }
  }

  function dispose() {
    layer.remove()
    buttonById.clear()
    activate = null
    dragStart = null
    contextMenu = null
  }

  return {
    setLabels,
    update,
    bindActivate: (fn) => {
      activate = fn
    },
    bindDragStart: (fn) => {
      dragStart = fn
    },
    bindContextMenu: (fn) => {
      contextMenu = fn
    },
    dispose,
  }
}
