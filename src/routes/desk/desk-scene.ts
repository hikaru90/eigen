import type { DeskPalette } from './desk-theme'
import * as THREE from 'three'
import {
  isLabelVisible,
  projectToScreen,
  type DeskLabelKind,
  type DeskLabelLayer,
  type DeskLabelUpdate,
} from './desk-labels'
import {
  findPileAt,
  layoutLooseTasks,
  layoutProjectPiles,
  layoutWallNotes,
  pileSheetOffsets,
  type DeskPilePlacement,
  type WallBounds,
} from './desk-layout'

export type DeskSceneProject = {
  entityId: string
  label: string
  openTaskCount: number
}

export type DeskSceneTask = {
  eventId: string
  label: string
}

export type DeskSceneNote = {
  id: string
  label: string
}

export type DeskSceneData = {
  projects: DeskSceneProject[]
  tasks: DeskSceneTask[]
  notes: DeskSceneNote[]
}

export type CreateDeskSceneOptions = {
  container: HTMLElement
  palette: DeskPalette
  data: DeskSceneData
  reducedMotion: boolean
  labelLayer: DeskLabelLayer
  onSelectPile?: (entityId: string) => void
  onSelectTask?: (eventId: string) => void
  onSelectNote?: (id: string) => void
  onDropTaskOnPile?: (eventId: string, entityId: string) => void
  onTaskContextMenu?: (eventId: string, screen: { x: number; y: number }) => void
}

export type DeskSceneHandle = {
  resize: () => void
  setData: (data: DeskSceneData) => void
  applyPalette: (palette: DeskPalette) => void
  dispose: () => void
}

/** World layout. The wall stands behind the desk; piles mid; loose tasks in front. */
const WALL: WallBounds & { z: number } = { width: 46, height: 10, y0: 0, z: -6.5 }
const DESK = { minX: -26, maxX: 26, minZ: -6.5, maxZ: 16 }
const PILE_BOUNDS = { minX: -10.5, maxX: 10.5, minZ: -4.5, maxZ: 0.5 }
const TASK_ORIGIN = { x: 0, z: 2.8 }
const TASK_COLS = 7
const TASK_SPACING = 1.7
const NOTE_ASPECT = 2.4
const MAX_NOTE_COLS = 40

const SHEET_WIDTH = 1.06
const SHEET_HEIGHT = 1.5
const MAX_SHEETS_PER_PILE = 16
const PILE_PICK_RADIUS = 1.05
const PILE_HOVER_LIFT = 0.07
const TASK_HOVER_LIFT = 0.12

/**
 * Camera frames all three regions at once: wall notes up to y≈7.6, the pile
 * band, and the loose-task rows. Offset is applied to the target, so zoom
 * dollies from the same viewpoint.
 */
const CAMERA_FOV = 38
const CAMERA_TARGET = new THREE.Vector3(0, 2.4, -1)
const CAMERA_OFFSET = new THREE.Vector3(0, 4, 14.5)
const PAN_CLAMP = { x: 9, zMin: -3, zMax: 6 }
const ZOOM_MIN = 0.72
const ZOOM_MAX = 1.45

const IDLE_TIMEOUT_MS = 2000
const ACTIVE_FRAME_INTERVAL_MS = 16
const IDLE_FRAME_INTERVAL_MS = 120

const CLICK_DRAG_THRESHOLD_PX = 5

function srgb(color: { r: number; g: number; b: number }): THREE.Color {
  return new THREE.Color().setRGB(color.r, color.g, color.b, THREE.SRGBColorSpace)
}

/** Sheet texture: paper fill + faint ink border, shared by every instanced mesh. */
function createSheetTexture(foreground: { r: number; g: number; b: number }): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const ink = Math.round(255 * (0.35 * foreground.r + 0.5 * foreground.g + 0.15 * foreground.b))
  ctx.strokeStyle = `rgba(${ink}, ${ink}, ${ink}, 0.16)`
  ctx.lineWidth = 3
  ctx.strokeRect(4, 4, size - 8, size - 8)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function isMobileDevice(): boolean {
  return (
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  )
}

type PileRuntime = {
  placement: DeskPilePlacement
  sheetCount: number
  phase: number
}

type TaskRuntime = { eventId: string; x: number; z: number; rotation: number }

type NoteRuntime = { id: string; x: number; y: number; rotation: number }

export function createDeskScene(options: CreateDeskSceneOptions): DeskSceneHandle {
  const { container, reducedMotion, labelLayer } = options
  let palette = options.palette

  const scene = new THREE.Scene()
  scene.background = srgb(palette.background)
  scene.fog = new THREE.Fog(srgb(palette.background).getHex(), 20, 42)

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 120)
  camera.position.copy(CAMERA_TARGET).add(CAMERA_OFFSET)
  camera.lookAt(CAMERA_TARGET)

  const renderer = new THREE.WebGLRenderer({
    antialias: !isMobileDevice(),
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.className = 'desk-scene-canvas touch-none'
  renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:0;display:block;'
  container.appendChild(renderer.domElement)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  let sheetTexture = createSheetTexture(palette.foreground)
  track(sheetTexture)

  const paperMaterial = track(
    new THREE.MeshBasicMaterial({ map: sheetTexture, color: srgb(palette.paper) }),
  )
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
    }),
  )
  const accentMaterial = track(
    new THREE.MeshBasicMaterial({
      color: srgb(palette.accent),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  )
  const deskMaterial = track(new THREE.MeshBasicMaterial({ color: srgb(palette.desk) }))
  const wallMaterial = track(new THREE.MeshBasicMaterial({ color: srgb(palette.wall) }))
  const wallShadeMaterial = track(new THREE.MeshBasicMaterial({ color: srgb(palette.wallShade) }))

  const sheetGeometry = track(new THREE.PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT))
  const noteGeometry = track(
    new THREE.PlaneGeometry(SHEET_WIDTH * 0.78, SHEET_HEIGHT * 0.55),
  )
  const highlightGeometry = track(new THREE.PlaneGeometry(SHEET_WIDTH * 1.45, SHEET_HEIGHT * 1.3))

  function addPlane(material: THREE.Material, width: number, height: number): THREE.Mesh {
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), material)
    scene.add(mesh)
    return mesh
  }

  // Desk surface.
  const deskMesh = addPlane(deskMaterial, DESK.maxX - DESK.minX, DESK.maxZ - DESK.minZ)
  deskMesh.rotation.x = -Math.PI / 2
  deskMesh.position.set((DESK.minX + DESK.maxX) / 2, 0, (DESK.minZ + DESK.maxZ) / 2)

  // Soft pool of light over the work area so the desk reads as a lit surface.
  const poolTexture = (() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  })()
  track(poolTexture)
  const poolMaterial = track(
    new THREE.MeshBasicMaterial({
      map: poolTexture,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    }),
  )
  const poolMesh = addPlane(poolMaterial, 26, 16)
  poolMesh.rotation.x = -Math.PI / 2
  poolMesh.position.set(0, 0.004, 0.5)

  // Wall behind the desk, with a darker upper band so it reads as a wall.
  const wallMesh = addPlane(wallMaterial, WALL.width, WALL.height)
  wallMesh.position.set(0, WALL.y0 + WALL.height / 2, WALL.z)
  const wallShadeMesh = addPlane(wallShadeMaterial, WALL.width, WALL.height * 0.45)
  wallShadeMesh.position.set(0, WALL.y0 + WALL.height * 0.775, WALL.z + 0.01)

  // Drop-target / hover highlight, moved under the active pile.
  const highlightMesh = new THREE.Mesh(highlightGeometry, accentMaterial)
  highlightMesh.rotation.x = -Math.PI / 2
  highlightMesh.visible = false
  scene.add(highlightMesh)

  let piles: PileRuntime[] = []
  let tasks: TaskRuntime[] = []
  let notes: NoteRuntime[] = []
  let pileMesh: THREE.InstancedMesh | null = null
  let shadowMesh: THREE.InstancedMesh | null = null
  let taskMesh: THREE.InstancedMesh | null = null
  let noteMesh: THREE.InstancedMesh | null = null

  const dummy = new THREE.Object3D()

  /** Instanced spreads live far from the mesh origin — three's bounding-sphere
   * culling would drop whole batches when the origin sphere leaves the frustum. */
  function makeInstanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number) {
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.frustumCulled = false
    return mesh
  }

  function removeInstanced(mesh: THREE.InstancedMesh | null) {
    if (!mesh) return
    scene.remove(mesh)
    mesh.dispose()
  }

  function rebuildInstances() {
    removeInstanced(pileMesh)
    removeInstanced(shadowMesh)
    removeInstanced(taskMesh)
    removeInstanced(noteMesh)
    pileMesh = null
    shadowMesh = null
    taskMesh = null
    noteMesh = null

    // Project piles: stacked sheets, one pile per active project.
    const projects = options.data.projects
    piles = projects.map((project, index) => {
      const sheetCount = Math.max(1, Math.min(project.openTaskCount, MAX_SHEETS_PER_PILE))
      return {
        placement: { entityId: project.entityId, x: 0, z: 0, sheetCount },
        sheetCount,
        phase: index * 1.7,
      }
    })
    if (piles.length > 0) {
      const placements = layoutProjectPiles(
        projects.map((p) => p.entityId),
        PILE_BOUNDS,
      )
      piles.forEach((pile, i) => {
        pile.placement.x = placements[i].x
        pile.placement.z = placements[i].z
      })
      const totalSheets = piles.reduce((sum, pile) => sum + pile.sheetCount, 0)
      const newPileMesh = makeInstanced(sheetGeometry, paperMaterial, totalSheets)
      const newShadowMesh = makeInstanced(sheetGeometry, shadowMaterial, piles.length)
      let i = 0
      piles.forEach((pile, pileIndex) => {
        dummy.position.set(pile.placement.x, 0.002, pile.placement.z)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.setScalar(1.22)
        dummy.updateMatrix()
        newShadowMesh.setMatrixAt(pileIndex, dummy.matrix)

        const offsets = pileSheetOffsets(pile.sheetCount, pile.placement.entityId)
        for (const offset of offsets) {
          dummy.position.set(
            pile.placement.x + offset.dx,
            0.012 + offset.y,
            pile.placement.z + offset.dz,
          )
          dummy.rotation.set(-Math.PI / 2, 0, offset.rot)
          dummy.scale.setScalar(1)
          dummy.updateMatrix()
          newPileMesh.setMatrixAt(i++, dummy.matrix)
        }
      })
      pileMesh = newPileMesh
      shadowMesh = newShadowMesh
      scene.add(shadowMesh, pileMesh)
    }

    // Loose tasks: single sheets on the desk in front of the piles.
    tasks = layoutLooseTasks(
      options.data.tasks.map((t) => t.eventId),
      TASK_ORIGIN,
      { cols: TASK_COLS, spacing: TASK_SPACING },
    ).map((placement) => ({
      eventId: placement.id,
      x: placement.x,
      z: placement.z,
      rotation: placement.rotation,
    }))
    if (tasks.length > 0) {
      const newTaskMesh = makeInstanced(sheetGeometry, paperMaterial, tasks.length)
      tasks.forEach((task, i) => {
        dummy.position.set(task.x, 0.012, task.z)
        dummy.rotation.set(-Math.PI / 2, 0, task.rotation)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        newTaskMesh.setMatrixAt(i, dummy.matrix)
      })
      taskMesh = newTaskMesh
      scene.add(taskMesh)
    }

    // Wall notes: graph nodes pinned on the wall behind the desk.
    notes = []
    const noteCount = options.data.notes.length
    if (noteCount > 0) {
      const cols = Math.min(
        MAX_NOTE_COLS,
        Math.max(3, Math.round(Math.sqrt(noteCount * NOTE_ASPECT))),
      )
      const rows = Math.ceil(noteCount / cols)
      notes = layoutWallNotes(
        options.data.notes.map((n) => n.id),
        WALL,
        { cols, spacing: Math.min(WALL.width / cols, WALL.height / rows) },
      ).map((placement) => ({
        id: placement.id,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
      }))
      const newNoteMesh = makeInstanced(noteGeometry, paperMaterial, notes.length)
      notes.forEach((note, i) => {
        dummy.position.set(note.x, note.y, WALL.z + 0.03)
        dummy.rotation.set(0, 0, note.rotation)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        newNoteMesh.setMatrixAt(i, dummy.matrix)
      })
      noteMesh = newNoteMesh
      scene.add(noteMesh)
    }

    labelLayer.setLabels(labelSpecs())
  }

  function labelSpecs() {
    const specs: Array<{ id: string; kind: DeskLabelKind; text: string }> = []
    for (const project of options.data.projects) {
      specs.push({
        id: project.entityId,
        kind: 'project',
        text: `${project.label} · ${project.openTaskCount}`,
      })
    }
    for (const task of options.data.tasks) {
      specs.push({ id: task.eventId, kind: 'task', text: task.label })
    }
    for (const note of options.data.notes) {
      specs.push({ id: note.id, kind: 'note', text: note.label })
    }
    return specs
  }

  // --- pointer state -------------------------------------------------------
  type DragSource = 'canvas' | 'label' | null
  let dragSource: DragSource = null
  let draggedTaskIndex = -1
  let pointerDownX = 0
  let pointerDownY = 0
  let pointerDragged = false
  let panMode = false
  let panStartX = 0
  let panStartY = 0
  let panTargetX = 0
  let panTargetZ = 0
  let panCurrentX = 0
  let panCurrentZ = 0
  let zoom = 1
  let zoomTarget = 1

  let hoveredPileIndex = -1
  let hoveredTaskIndex = -1
  let hoveredNoteIndex = -1

  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const deskPoint = new THREE.Vector3()
  const viewProjection = new THREE.Matrix4()

  function setPointerNdc(event: { clientX: number; clientY: number }) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  function raycastInstances(mesh: THREE.InstancedMesh | null): number {
    if (!mesh) return -1
    const hits = raycaster.intersectObject(mesh)
    return hits.length > 0 ? (hits[0].instanceId ?? -1) : -1
  }

  function deskPointFromNdc(): boolean {
    raycaster.setFromCamera(pointerNdc, camera)
    return raycaster.ray.intersectPlane(deskPlane, deskPoint) !== null
  }

  function dropPileUnderPointer(): DeskPilePlacement | null {
    return deskPointFromNdc()
      ? findPileAt(
          deskPoint.x,
          deskPoint.z,
          piles.map((p) => p.placement),
          PILE_PICK_RADIUS,
        )
      : null
  }

  function moveDraggedTaskToPointer() {
    if (draggedTaskIndex < 0 || draggedTaskIndex >= tasks.length) return
    if (!deskPointFromNdc()) return
    dummy.position.set(deskPoint.x, TASK_HOVER_LIFT + 0.3, deskPoint.z)
    dummy.rotation.set(-Math.PI / 2, 0, tasks[draggedTaskIndex].rotation)
    dummy.scale.setScalar(1.04)
    dummy.updateMatrix()
    taskMesh?.setMatrixAt(draggedTaskIndex, dummy.matrix)
    if (taskMesh) taskMesh.instanceMatrix.needsUpdate = true
    highlightMesh.position.set(deskPoint.x, 0.005, deskPoint.z)
    const pile = dropPileUnderPointer()
    hoveredPileIndex = pile ? piles.findIndex((p) => p.placement === pile) : -1
    highlightMesh.visible = hoveredPileIndex >= 0
    if (highlightMesh.visible) {
      const target = piles[hoveredPileIndex].placement
      highlightMesh.position.set(target.x, 0.005, target.z)
    }
  }

  function beginDrag(source: DragSource, taskIndex: number, event: { clientX: number; clientY: number }) {
    dragSource = source
    draggedTaskIndex = taskIndex
    pointerDownX = event.clientX
    pointerDownY = event.clientY
    pointerDragged = false
    panMode = false
  }

  function resetDrag() {
    dragSource = null
    draggedTaskIndex = -1
    pointerDragged = false
    highlightMesh.visible = false
    rebuildInstances()
  }

  /** Drop: commit the assign; returns the dropped task's eventId or null. */
  function finishDrag(): { eventId: string; entityId: string } | null {
    const task = tasks[draggedTaskIndex]
    const pile = pointerDragged ? dropPileUnderPointer() : null
    const entityId = pile?.entityId ?? null
    resetDrag()
    if (task && entityId) {
      return { eventId: task.eventId, entityId }
    }
    return null
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    markActive()
    setPointerNdc(event)
    raycaster.setFromCamera(pointerNdc, camera)
    const taskHit = raycastInstances(taskMesh)
    if (taskHit >= 0) {
      beginDrag('canvas', taskHit, event)
      renderer.domElement.setPointerCapture?.(event.pointerId)
    } else {
      panMode = true
      pointerDownX = event.clientX
      pointerDownY = event.clientY
      panStartX = event.clientX
      panStartY = event.clientY
      pointerDragged = false
    }
  }

  function onPointerMove(event: PointerEvent) {
    markActive()

    if (dragSource === 'label') return // owned by the window handlers

    if (draggedTaskIndex >= 0) {
      const dx = event.clientX - pointerDownX
      const dy = event.clientY - pointerDownY
      if (!pointerDragged && Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) pointerDragged = true
      if (pointerDragged) moveDraggedTaskToPointer()
      return
    }

    if (panMode) {
      const dx = event.clientX - pointerDownX
      const dy = event.clientY - pointerDownY
      if (!pointerDragged && Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) pointerDragged = true
      if (!pointerDragged) return
      const scale = (CAMERA_OFFSET.length() * zoom) / 420
      panTargetX -= (event.clientX - panStartX) * scale
      panTargetZ -= (event.clientY - panStartY) * scale
      panTargetX = Math.max(-PAN_CLAMP.x, Math.min(PAN_CLAMP.x, panTargetX))
      panTargetZ = Math.max(PAN_CLAMP.zMin, Math.min(PAN_CLAMP.zMax, panTargetZ))
      panStartX = event.clientX
      panStartY = event.clientY
      return
    }

    // Hover feedback.
    setPointerNdc(event)
    raycaster.setFromCamera(pointerNdc, camera)
    hoveredPileIndex = raycastInstances(pileMesh)
    hoveredTaskIndex = raycastInstances(taskMesh)
    hoveredNoteIndex = raycastInstances(noteMesh)
    highlightMesh.visible = false
    renderer.domElement.style.cursor =
      hoveredPileIndex >= 0 || hoveredTaskIndex >= 0 || hoveredNoteIndex >= 0 ? 'pointer' : 'grab'
  }

  function onPointerUp(event: PointerEvent) {
    markActive()
    renderer.domElement.releasePointerCapture?.(event.pointerId)
    if (dragSource === 'canvas' && draggedTaskIndex >= 0) {
      const dropped = finishDrag()
      if (dropped) options.onDropTaskOnPile?.(dropped.eventId, dropped.entityId)
    }
    panMode = false
  }

  function onClick(event: MouseEvent) {
    if (pointerDragged || draggedTaskIndex >= 0) {
      pointerDragged = false
      return
    }
    setPointerNdc(event)
    raycaster.setFromCamera(pointerNdc, camera)
    const pileHit = raycastInstances(pileMesh)
    if (pileHit >= 0) {
      options.onSelectPile?.(piles[pileHit].placement.entityId)
      return
    }
    const taskHit = raycastInstances(taskMesh)
    if (taskHit >= 0) {
      options.onSelectTask?.(tasks[taskHit].eventId)
      return
    }
    const noteHit = raycastInstances(noteMesh)
    if (noteHit >= 0) {
      options.onSelectNote?.(notes[noteHit].id)
    }
  }

  function onContextMenu(event: MouseEvent) {
    setPointerNdc(event)
    raycaster.setFromCamera(pointerNdc, camera)
    const taskHit = raycastInstances(taskMesh)
    if (taskHit >= 0) {
      event.preventDefault()
      options.onTaskContextMenu?.(tasks[taskHit].eventId, { x: event.clientX, y: event.clientY })
    }
  }

  function clampPan() {
    panTargetX = Math.max(-PAN_CLAMP.x, Math.min(PAN_CLAMP.x, panTargetX))
    panTargetZ = Math.max(PAN_CLAMP.zMin, Math.min(PAN_CLAMP.zMax, panTargetZ))
  }

  function onWheel(event: WheelEvent) {
    markActive()
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomTarget * (1 - event.deltaY * 0.002)))
      return
    }
    event.preventDefault()
    const scale = (CAMERA_OFFSET.length() * zoom) / 420
    panTargetX += event.deltaX * scale
    panTargetZ += event.deltaY * scale
    clampPan()
  }

  // Window-level handlers only serve label-initiated drags (the pointerdown
  // happened on a DOM label button, not the canvas).
  function onWindowPointerMove(event: PointerEvent) {
    if (dragSource !== 'label' || draggedTaskIndex < 0) return
    markActive()
    const dx = event.clientX - pointerDownX
    const dy = event.clientY - pointerDownY
    if (!pointerDragged && Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) pointerDragged = true
    if (pointerDragged) moveDraggedTaskToPointer()
  }

  function onWindowPointerUp() {
    if (dragSource !== 'label' || draggedTaskIndex < 0) return
    const dropped = finishDrag()
    if (dropped) options.onDropTaskOnPile?.(dropped.eventId, dropped.entityId)
  }

  function activateLabel(id: string, kind: DeskLabelKind) {
    if (kind === 'project') options.onSelectPile?.(id)
    else if (kind === 'task') options.onSelectTask?.(id)
    else options.onSelectNote?.(id)
  }

  function beginLabelDrag(id: string, kind: DeskLabelKind, event: PointerEvent) {
    if (kind !== 'task') return
    const index = tasks.findIndex((t) => t.eventId === id)
    if (index < 0) return
    beginDrag('label', index, event)
  }

  // --- frame loop ----------------------------------------------------------
  let lastInteractionTime = performance.now()
  let isIdle = false
  let animationFrame = 0
  let lastFrameTime = 0
  let renderError: string | null = null
  let frames = 0

  function markActive() {
    lastInteractionTime = performance.now()
    if (isIdle) {
      isIdle = false
      lastFrameTime = 0
    }
  }

  function applyCamera() {
    const eased = reducedMotion ? 1 : 0.14
    zoom += (zoomTarget - zoom) * eased
    panCurrentX += (panTargetX - panCurrentX) * eased
    panCurrentZ += (panTargetZ - panCurrentZ) * eased
    camera.position.copy(CAMERA_TARGET).addScaledVector(CAMERA_OFFSET, zoom)
    camera.position.x += panCurrentX
    camera.position.z += panCurrentZ
    camera.lookAt(CAMERA_TARGET.x + panCurrentX, CAMERA_TARGET.y, CAMERA_TARGET.z + panCurrentZ)
  }

  function animatePiles(now: number) {
    const mesh = pileMesh
    if (!mesh) return
    let i = 0
    piles.forEach((pile, index) => {
      const hovered = index === hoveredPileIndex
      const lift = hovered ? PILE_HOVER_LIFT : 0
      const breathe =
        reducedMotion || lift > 0 ? 0 : Math.sin(now * 0.0004 + pile.phase) * 0.006
      const offsets = pileSheetOffsets(pile.sheetCount, pile.placement.entityId)
      for (const offset of offsets) {
        dummy.position.set(
          pile.placement.x + offset.dx,
          0.012 + offset.y + lift + breathe * (1 + i / 40),
          pile.placement.z + offset.dz,
        )
        dummy.rotation.set(-Math.PI / 2, 0, offset.rot)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i++, dummy.matrix)
      }
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  function updateLabels() {
    camera.updateMatrixWorld()
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    const viewport = { width: w, height: h, marginPx: 32 }
    const updates: DeskLabelUpdate[] = []

    function push(
      id: string,
      kind: DeskLabelKind,
      world: { x: number; y: number; z: number },
      emphasized: boolean,
    ) {
      const projected = projectToScreen(world, viewProjection.elements, w, h)
      const visible =
        !projected.behind &&
        isLabelVisible({ x: projected.screenX, y: projected.screenY }, viewport)
      updates.push({
        id,
        kind,
        screenX: projected.screenX,
        screenY: projected.screenY,
        visible,
        emphasized,
      })
    }

    piles.forEach((pile, index) => {
      push(
        pile.placement.entityId,
        'project',
        {
          x: pile.placement.x,
          y: 0.1 + pile.sheetCount * 0.018 + PILE_HOVER_LIFT,
          z: pile.placement.z + 1.05,
        },
        index === hoveredPileIndex,
      )
    })
    tasks.forEach((task, index) => {
      push(
        task.eventId,
        'task',
        { x: task.x, y: 0.1 + (index === hoveredTaskIndex ? TASK_HOVER_LIFT : 0), z: task.z + 0.95 },
        index === hoveredTaskIndex || index === draggedTaskIndex,
      )
    })
    notes.forEach((note, index) => {
      push(note.id, 'note', { x: note.x, y: note.y + 0.45, z: WALL.z + 0.05 }, index === hoveredNoteIndex)
    })
    labelLayer.update(updates)
  }

  function animate(timestamp: number) {
    const now = timestamp || performance.now()
    const idle = now - lastInteractionTime > IDLE_TIMEOUT_MS

    const minInterval = idle ? IDLE_FRAME_INTERVAL_MS : ACTIVE_FRAME_INTERVAL_MS
    if (lastFrameTime && now - lastFrameTime < minInterval) {
      animationFrame = requestAnimationFrame(animate)
      return
    }

    lastFrameTime = now
    animationFrame = requestAnimationFrame(animate)
    isIdle = idle

    applyCamera()
    animatePiles(now)
    updateLabels()
    try {
      renderer.render(scene, camera)
      renderError = null
    } catch (err) {
      renderError = err instanceof Error ? err.message : String(err)
    }
    if (import.meta.env.DEV) {
      frames++
      ;(window as unknown as Record<string, unknown>).__deskDebug = {
        frames,
        renderError,
        piles: piles.length,
        tasks: tasks.length,
        notes: notes.length,
      }
    }
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)
  renderer.domElement.addEventListener('click', onClick)
  renderer.domElement.addEventListener('contextmenu', onContextMenu)
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)

  labelLayer.bindActivate(activateLabel)
  labelLayer.bindDragStart(beginLabelDrag)
  labelLayer.bindContextMenu((id, kind, screen) => {
    if (kind === 'task') options.onTaskContextMenu?.(id, screen)
  })

  rebuildInstances()
  resize()
  animate(0)

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w < 1 || h < 1) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, true)
  }

  return {
    resize,
    setData(next: DeskSceneData) {
      options.data = next
      hoveredPileIndex = -1
      hoveredTaskIndex = -1
      hoveredNoteIndex = -1
      resetDrag()
    },
    applyPalette(next: DeskPalette) {
      palette = next
      scene.background = srgb(palette.background)
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color = srgb(palette.background)
      }
      deskMaterial.color = srgb(palette.desk)
      wallMaterial.color = srgb(palette.wall)
      wallShadeMaterial.color = srgb(palette.wallShade)
      accentMaterial.color = srgb(palette.accent)
      paperMaterial.color = srgb(palette.paper)
      const fresh = createSheetTexture(palette.foreground)
      paperMaterial.map = fresh
      paperMaterial.needsUpdate = true
      const textureIndex = disposables.indexOf(sheetTexture)
      if (textureIndex >= 0) disposables[textureIndex] = fresh
      else track(fresh)
      sheetTexture.dispose()
      sheetTexture = fresh
      markActive()
    },
    dispose() {
      cancelAnimationFrame(animationFrame)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      renderer.domElement.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      removeInstanced(pileMesh)
      removeInstanced(shadowMesh)
      removeInstanced(taskMesh)
      removeInstanced(noteMesh)
      scene.remove(highlightMesh)
      for (const item of disposables) item.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
