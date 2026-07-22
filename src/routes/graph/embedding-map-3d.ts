import * as THREE from 'three'
import { MOUSE, TOUCH } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server'
import { isEmbeddingItemVisibleByAuthorLayers } from '$lib/graph/graph-author-layers'

export type EmbeddingMap3dPoint = {
  item: EmbeddingSnapshotItem
  x: number
  y: number
  z: number
  color: string
}

export type CreateEmbeddingMap3dOptions = {
  container: HTMLElement
  points: EmbeddingMap3dPoint[]
  onSelectItem?: (item: EmbeddingSnapshotItem | null) => void
}

export type EmbeddingMap3dHandle = {
  resize: () => void
  setSelectedId: (id: string | null) => void
  setVisibleSubtypes: (visibleTypes: ReadonlySet<string>) => void
  setVisibleAuthorLayers: (visibleLayers: ReadonlySet<string>) => void
  dispose: () => void
}

const POINT_RADIUS = 0.028
const HIGHLIGHT_RADIUS = 0.048
const HIGHLIGHT_COLOR = 0xfbbf24

/** Idle detection thresholds */
const IDLE_TIMEOUT_MS = 2000
const IDLE_FRAME_INTERVAL_MS = 100
const ACTIVE_FRAME_INTERVAL_MS = 16

/** Counter-scale world-space spheres so apparent dot size stays fixed while the camera dollies. */
export function screenSpacePointScale(distance: number, referenceDistance: number): number {
  if (!(referenceDistance > 0) || !Number.isFinite(distance)) return 1
  return distance / referenceDistance
}

/** Match /graph force layout: text at x=12, y=4 beside the node circle. */
const LABEL_MARGIN_LEFT_PX = 12
const LABEL_MARGIN_TOP_PX = 4
const CLICK_DRAG_THRESHOLD_PX = 4

export function embeddingMapShouldSuppressSelectionClick(input: { dragged: boolean }): boolean {
  return input.dragged
}

function parseCssColor(color: string): THREE.Color {
  return new THREE.Color(color)
}

/** Match 2D graph node label truncation on /graph. */
export function embeddingMapLabelText(item: EmbeddingSnapshotItem): string {
  const base = item.label?.trim() || item.id
  return base.length > 42 ? `${base.slice(0, 40)}…` : base
}

function createLabelElement(text: string, itemId: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'embedding-map-label'
  el.dataset.itemId = itemId
  el.textContent = text
  el.style.marginLeft = `${LABEL_MARGIN_LEFT_PX}px`
  el.style.marginTop = `${LABEL_MARGIN_TOP_PX}px`
  return el
}

/** Detect mobile/touch devices for antialiasing decision */
function isMobileDevice(): boolean {
  return (
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  )
}

/** Get geometry detail level based on point count and device capability */
function getGeometryDetail(pointCount: number): { segments: number; rings: number } {
  if (pointCount > 500 || isMobileDevice()) {
    return { segments: 6, rings: 6 }
  }
  if (pointCount > 200) {
    return { segments: 8, rings: 8 }
  }
  return { segments: 10, rings: 10 }
}

export function createEmbeddingMap3d(options: CreateEmbeddingMap3dOptions): EmbeddingMap3dHandle {
  const { container, points, onSelectItem } = options

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.set(0, 0, 2.4)

  /** Disable antialiasing on mobile for better battery/thermal performance */
  const antialias = !isMobileDevice()
  const renderer = new THREE.WebGLRenderer({ antialias, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.className = 'embedding-map-3d touch-none'
  renderer.domElement.style.cursor = 'grab'
  container.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'embedding-map-labels touch-none'
  labelRenderer.domElement.style.pointerEvents = 'none'
  container.appendChild(labelRenderer.domElement)

  const stackLayer = (el: HTMLElement, zIndex: number) => {
    el.style.position = 'absolute'
    el.style.top = '0'
    el.style.left = '0'
    el.style.zIndex = String(zIndex)
  }
  stackLayer(renderer.domElement, 0)
  stackLayer(labelRenderer.domElement, 1)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = true
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.rotateSpeed = 0.65
  controls.zoomSpeed = 0.9
  controls.panSpeed = 0.75
  controls.minDistance = 0.4
  controls.maxDistance = 8
  controls.mouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.PAN,
  }
  /** One-finger rotates; two-finger pinch zooms / pan. */
  controls.touches = {
    ONE: TOUCH.ROTATE,
    TWO: TOUCH.DOLLY_PAN,
  }

  /** Use Points geometry for better performance with many points */
  const positions = new Float32Array(points.length * 3)
  const colors = new Float32Array(points.length * 3)
  const sizes = new Float32Array(points.length)
  const visibleFlags = new Uint8Array(points.length)
  let visibleSubtypes = new Set<string>()
  let visibleAuthorLayers = new Set<string>()

  const labelByItemId = new Map<string, HTMLDivElement>()
  const pointIndexByItemId = new Map<string, number>()

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    positions[i * 3] = point.x
    positions[i * 3 + 1] = point.y
    positions[i * 3 + 2] = point.z

    const color = parseCssColor(point.color)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b

    sizes[i] = POINT_RADIUS * 2
    visibleFlags[i] = 1

    pointIndexByItemId.set(point.item.id, i)

    const labelEl = createLabelElement(embeddingMapLabelText(point.item), point.item.id)
    labelByItemId.set(point.item.id, labelEl)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  /** Create a circular texture for points (WebGL defaults to squares without a texture) */
  const pointTexture = (() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    /** Draw a solid circle */
    const center = size / 2
    const radius = size / 2 - 1
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  })()

  /** Create points material with size attenuation for consistent screen-space sizing */
  const pointsMaterial = new THREE.PointsMaterial({
    size: POINT_RADIUS * 2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.88,
    vertexColors: true,
    depthWrite: false,
    map: pointTexture,
  })

  const pointsObject = new THREE.Points(geometry, pointsMaterial)
  scene.add(pointsObject)

  /** Depth sorting: use index buffer for efficient back-to-front rendering */
  const indexArray = new Uint16Array(points.length)
  for (let i = 0; i < points.length; i++) indexArray[i] = i
  const depthBuffer = new Float32Array(points.length)
  const indexBuffer = new THREE.BufferAttribute(indexArray, 1)
  geometry.setIndex(indexBuffer)

  let lastDepthSortCamX = NaN
  let lastDepthSortCamY = NaN
  let lastDepthSortCamZ = NaN

  function updateDepthSort() {
    const camPos = camera.position

    /** Compute squared distance from camera for each point */
    for (let i = 0; i < points.length; i++) {
      const x = positions[i * 3] - camPos.x
      const y = positions[i * 3 + 1] - camPos.y
      const z = positions[i * 3 + 2] - camPos.z
      depthBuffer[i] = x * x + y * y + z * z
    }

    /** Sort indices by depth (farthest first for painter's algorithm) */
    indexArray.sort((a, b) => depthBuffer[a] - depthBuffer[b])

    /** Mark index buffer as needing GPU upload */
    indexBuffer.needsUpdate = true
    lastDepthSortCamX = camPos.x
    lastDepthSortCamY = camPos.y
    lastDepthSortCamZ = camPos.z
  }

  function needsDepthSort(): boolean {
    if (!isIdle) return true
    const p = camera.position
    return p.x !== lastDepthSortCamX || p.y !== lastDepthSortCamY || p.z !== lastDepthSortCamZ
  }

  /** Create individual label objects for selection/hover */
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const labelEl = labelByItemId.get(point.item.id)
    if (labelEl) {
      const label = new CSS2DObject(labelEl)
      label.center.set(0, 0.5)
      label.position.set(point.x, point.y, point.z)
      scene.add(label)
    }
  }

  /** Highlight geometry for selected point */
  const highlightGeometry = new THREE.SphereGeometry(HIGHLIGHT_RADIUS, 12, 12)
  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  })
  const highlightRingMaterial = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0.95,
  })
  const detail = getGeometryDetail(points.length)
  const highlightCore = new THREE.Mesh(
    new THREE.SphereGeometry(POINT_RADIUS * 1.35, detail.segments, detail.rings),
    highlightRingMaterial,
  )
  const highlightGlow = new THREE.Mesh(highlightGeometry, highlightMaterial)
  const highlightGroup = new THREE.Group()
  highlightGroup.add(highlightGlow)
  highlightGroup.add(highlightCore)
  highlightGroup.visible = false
  scene.add(highlightGroup)

  const raycaster = new THREE.Raycaster()
  raycaster.params.Points = { threshold: POINT_RADIUS * 2 }
  const pointer = new THREE.Vector2()
  const worldPos = new THREE.Vector3()
  const referenceDistance = camera.position.distanceTo(controls.target)

  /** Store original positions for hit detection (before depth sorting) */
  const originalPositions = positions.slice()

  /** Idle detection state */
  let lastInteractionTime = performance.now()
  let isIdle = false
  let animationFrame = 0
  let lastFrameTime = 0

  function markActive() {
    lastInteractionTime = performance.now()
    if (isIdle) {
      isIdle = false
      lastFrameTime = 0
    }
  }

  controls.addEventListener('start', markActive)
  controls.addEventListener('change', markActive)

  function updateScreenSpacePointScales() {
    /** For PointsMaterial, size attenuation handles scaling automatically */
    if (highlightGroup.visible) {
      const scale = screenSpacePointScale(
        camera.position.distanceTo(highlightGroup.position),
        referenceDistance,
      )
      highlightGroup.scale.setScalar(scale)
    }
  }

  let currentSelectedId: string | null = null

  function setSelectedId(id: string | null) {
    currentSelectedId = id

    /** Update opacity for all points */
    const opacities = pointsMaterial
    if (id === null) {
      opacities.opacity = 0.88
      highlightGroup.visible = false
      /** Reset all label styles */
      for (const [, labelEl] of labelByItemId) {
        labelEl.classList.remove('embedding-map-label--selected')
      }
    } else {
      /** Dim non-selected points */
      opacities.opacity = 0.5
      const selectedIdx = pointIndexByItemId.get(id)
      if (selectedIdx !== undefined) {
        /** Highlight the selected label */
        const labelEl = labelByItemId.get(id)
        if (labelEl) {
          labelEl.classList.add('embedding-map-label--selected')
        }
      }
    }

    if (id === null) {
      highlightGroup.visible = false
      return
    }

    /** Find the selected point position */
    const idx = pointIndexByItemId.get(id)
    if (idx === undefined || !visibleFlags[idx]) {
      highlightGroup.visible = false
      return
    }

    highlightGroup.position.set(
      originalPositions[idx * 3],
      originalPositions[idx * 3 + 1],
      originalPositions[idx * 3 + 2],
    )
    highlightGroup.visible = true
  }

  function recomputeVisibility() {
    const showAllSubtypes = visibleSubtypes.size === 0
    for (let i = 0; i < points.length; i++) {
      const point = points[i]
      const subtypeOk = showAllSubtypes || visibleSubtypes.has(point.item.subtype)
      const authorOk = isEmbeddingItemVisibleByAuthorLayers(point.item, visibleAuthorLayers)
      const visible = subtypeOk && authorOk
      visibleFlags[i] = visible ? 1 : 0

      const labelEl = labelByItemId.get(point.item.id)
      if (labelEl) {
        labelEl.style.display = visible ? '' : 'none'
      }
    }

    const visibleCount = visibleFlags.reduce((sum, v) => sum + v, 0)
    pointsMaterial.opacity = visibleCount > 0 ? (currentSelectedId ? 0.5 : 0.88) : 0

    if (currentSelectedId !== null) {
      const selectedIdx = pointIndexByItemId.get(currentSelectedId)
      if (selectedIdx !== undefined && !visibleFlags[selectedIdx]) {
        setSelectedId(null)
        onSelectItem?.(null)
      }
    }
  }

  function setVisibleSubtypes(visibleTypes: ReadonlySet<string>) {
    visibleSubtypes = new Set(visibleTypes)
    recomputeVisibility()
  }

  function setVisibleAuthorLayers(visibleLayers: ReadonlySet<string>) {
    visibleAuthorLayers = new Set(visibleLayers)
    recomputeVisibility()
  }

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w < 1 || h < 1) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, true)
    labelRenderer.setSize(w, h)
  }

  let pointerDownX = 0
  let pointerDownY = 0
  let pointerDragged = false

  function onPointerDown(event: PointerEvent) {
    pointerDownX = event.clientX
    pointerDownY = event.clientY
    pointerDragged = false
    markActive()
  }

  function onPointerMove(event: PointerEvent) {
    markActive()
    if (pointerDragged) return
    const dx = event.clientX - pointerDownX
    const dy = event.clientY - pointerDownY
    if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
      pointerDragged = true
    }
  }

  function onPointerUp() {
    markActive()
  }

  function onClick(event: MouseEvent) {
    if (embeddingMapShouldSuppressSelectionClick({ dragged: pointerDragged })) {
      pointerDragged = false
      return
    }

    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)

    /** For Points geometry, we need to manually check distances */
    let closestIdx = -1
    let closestDist = Infinity

    for (let i = 0; i < points.length; i++) {
      if (!visibleFlags[i]) continue

      const x = originalPositions[i * 3]
      const y = originalPositions[i * 3 + 1]
      const z = originalPositions[i * 3 + 2]

      worldPos.set(x, y, z)
      const projected = worldPos.clone().project(camera)

      const dx = projected.x - pointer.x
      const dy = projected.y - pointer.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < closestDist && dist < 0.05) {
        closestDist = dist
        closestIdx = i
      }
    }

    if (closestIdx >= 0) {
      const item = points[closestIdx].item
      onSelectItem?.(item)
    } else {
      onSelectItem?.(null)
    }
    pointerDragged = false
  }

  function animate(timestamp: number) {
    /** Idle throttling: skip frames when not interacting */
    const now = timestamp || performance.now()
    const timeSinceInteraction = now - lastInteractionTime

    if (timeSinceInteraction > IDLE_TIMEOUT_MS) {
      if (!isIdle) {
        isIdle = true
      }
      /** In idle mode, render at much lower frame rate */
      const idleFrameInterval = IDLE_FRAME_INTERVAL_MS * 5
      if (lastFrameTime && now - lastFrameTime < idleFrameInterval) {
        animationFrame = requestAnimationFrame(animate)
        return
      }
    } else {
      /** Active mode: throttle to target frame interval */
      if (lastFrameTime && now - lastFrameTime < ACTIVE_FRAME_INTERVAL_MS) {
        animationFrame = requestAnimationFrame(animate)
        return
      }
    }

    lastFrameTime = now
    animationFrame = requestAnimationFrame(animate)

    controls.update()
    if (needsDepthSort()) updateDepthSort()
    updateScreenSpacePointScales()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)
  renderer.domElement.addEventListener('click', onClick)

  resize()
  animate(0)

  return {
    resize,
    setSelectedId,
    setVisibleSubtypes,
    setVisibleAuthorLayers,
    dispose() {
      cancelAnimationFrame(animationFrame)
      controls.removeEventListener('start', markActive)
      controls.removeEventListener('change', markActive)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      highlightGeometry.dispose()
      highlightCore.geometry.dispose()
      highlightMaterial.dispose()
      highlightRingMaterial.dispose()
      geometry.dispose()
      pointsMaterial.dispose()
      pointTexture.dispose()
      scene.remove(pointsObject)
      scene.remove(highlightGroup)
      renderer.dispose()
      renderer.domElement.remove()
      labelRenderer.domElement.remove()
    },
  }
}
