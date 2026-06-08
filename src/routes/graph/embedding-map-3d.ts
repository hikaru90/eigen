import * as THREE from 'three';
import { MOUSE, TOUCH } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';

export type EmbeddingMap3dPoint = {
	item: EmbeddingSnapshotItem;
	x: number;
	y: number;
	z: number;
	color: string;
};

export type CreateEmbeddingMap3dOptions = {
	container: HTMLElement;
	points: EmbeddingMap3dPoint[];
	onSelectItem?: (item: EmbeddingSnapshotItem | null) => void;
};

export type EmbeddingMap3dHandle = {
	resize: () => void;
	setSelectedId: (id: string | null) => void;
	setVisibleSubtypes: (visibleTypes: ReadonlySet<string>) => void;
	dispose: () => void;
};

const POINT_RADIUS = 0.028;
const HIGHLIGHT_RADIUS = 0.048;
const HIGHLIGHT_COLOR = 0xfbbf24;

/** Counter-scale world-space spheres so apparent dot size stays fixed while the camera dollies. */
export function screenSpacePointScale(distance: number, referenceDistance: number): number {
	if (!(referenceDistance > 0) || !Number.isFinite(distance)) return 1;
	return distance / referenceDistance;
}

/** Match /graph force layout: text at x=12, y=4 beside the node circle. */
const LABEL_MARGIN_LEFT_PX = 12;
const LABEL_MARGIN_TOP_PX = 4;
const CLICK_DRAG_THRESHOLD_PX = 4;
const WHEEL_DELTA_PIXEL = 0;

export type EmbeddingMapWheelInput = {
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	deltaX: number;
	deltaY: number;
	deltaMode: number;
};

export type EmbeddingMapWheelMode = 'pan' | 'zoom';

/** Pinch (ctrl/meta wheel) zooms; shift or trackpad two-finger drag pans; mouse wheel zooms. */
export function embeddingMapWheelMode(input: EmbeddingMapWheelInput): EmbeddingMapWheelMode {
	if (input.ctrlKey || input.metaKey) return 'zoom';
	if (input.shiftKey) return 'pan';
	if (
		input.deltaMode === WHEEL_DELTA_PIXEL &&
		(Math.abs(input.deltaX) > 0 || Math.abs(input.deltaY) > 0)
	) {
		return 'pan';
	}
	return 'zoom';
}

export function embeddingMapShouldSuppressSelectionClick(input: {
	dragged: boolean;
	shiftKey: boolean;
}): boolean {
	return input.dragged || input.shiftKey;
}

/** Wheel/trackpad deltas are opposite OrbitControls' drag pan axis on macOS — invert for natural grab-pan. */
export function embeddingMapWheelPanDeltas(deltaX: number, deltaY: number): { x: number; y: number } {
	return { x: -deltaX, y: -deltaY };
}

function parseCssColor(color: string): THREE.Color {
	return new THREE.Color(color);
}

/** Match 2D graph node label truncation on /graph. */
export function embeddingMapLabelText(item: EmbeddingSnapshotItem): string {
	const base = item.label?.trim() || item.id;
	return base.length > 42 ? `${base.slice(0, 40)}…` : base;
}

function createLabelElement(text: string, itemId: string): HTMLDivElement {
	const el = document.createElement('div');
	el.className = 'embedding-map-label';
	el.dataset.itemId = itemId;
	el.textContent = text;
	el.style.marginLeft = `${LABEL_MARGIN_LEFT_PX}px`;
	el.style.marginTop = `${LABEL_MARGIN_TOP_PX}px`;
	return el;
}

export function createEmbeddingMap3d(options: CreateEmbeddingMap3dOptions): EmbeddingMap3dHandle {
	const { container, points, onSelectItem } = options;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
	camera.position.set(0, 0, 2.4);

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setClearColor(0x000000, 0);
	renderer.domElement.className = 'embedding-map-3d touch-none';
	renderer.domElement.style.cursor = 'grab';
	container.appendChild(renderer.domElement);

	const labelRenderer = new CSS2DRenderer();
	labelRenderer.domElement.className = 'embedding-map-labels touch-none';
	labelRenderer.domElement.style.pointerEvents = 'none';
	container.appendChild(labelRenderer.domElement);

	const stackLayer = (el: HTMLElement, zIndex: number) => {
		el.style.position = 'absolute';
		el.style.top = '0';
		el.style.left = '0';
		el.style.zIndex = String(zIndex);
	};
	stackLayer(renderer.domElement, 0);
	stackLayer(labelRenderer.domElement, 1);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enablePan = true;
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.rotateSpeed = 0.65;
	controls.zoomSpeed = 0.9;
	controls.panSpeed = 0.75;
	controls.minDistance = 0.4;
	controls.maxDistance = 8;
	controls.mouseButtons = {
		LEFT: MOUSE.ROTATE,
		MIDDLE: MOUSE.DOLLY,
		RIGHT: MOUSE.PAN
	};
	controls.touches = {
		ONE: TOUCH.ROTATE,
		TWO: TOUCH.DOLLY_PAN
	};

	const pointMeshes: THREE.Mesh[] = [];
	const labelByItemId = new Map<string, HTMLDivElement>();
	const sphereGeometry = new THREE.SphereGeometry(POINT_RADIUS, 10, 10);

	for (const point of points) {
		const material = new THREE.MeshBasicMaterial({
			color: parseCssColor(point.color),
			transparent: true,
			opacity: 0.88
		});
		const mesh = new THREE.Mesh(sphereGeometry, material);
		mesh.position.set(point.x, point.y, point.z);
		mesh.userData = { itemId: point.item.id, item: point.item };
		scene.add(mesh);
		pointMeshes.push(mesh);

		const labelEl = createLabelElement(embeddingMapLabelText(point.item), point.item.id);
		labelByItemId.set(point.item.id, labelEl);
		const label = new CSS2DObject(labelEl);
		// Left-middle anchor at the dot; pixel margin offsets match the 2D graph tab.
		label.center.set(0, 0.5);
		mesh.add(label);
	}

	const highlightGeometry = new THREE.SphereGeometry(HIGHLIGHT_RADIUS, 12, 12);
	const highlightMaterial = new THREE.MeshBasicMaterial({
		color: HIGHLIGHT_COLOR,
		transparent: true,
		opacity: 0.35,
		depthWrite: false
	});
	const highlightRingMaterial = new THREE.MeshBasicMaterial({
		color: HIGHLIGHT_COLOR,
		transparent: true,
		opacity: 0.95
	});
	const highlightGlow = new THREE.Mesh(highlightGeometry, highlightMaterial);
	const highlightCore = new THREE.Mesh(
		new THREE.SphereGeometry(POINT_RADIUS * 1.35, 10, 10),
		highlightRingMaterial
	);
	const highlightGroup = new THREE.Group();
	highlightGroup.add(highlightGlow);
	highlightGroup.add(highlightCore);
	highlightGroup.visible = false;
	scene.add(highlightGroup);

	const raycaster = new THREE.Raycaster();
	raycaster.params.Points = { threshold: POINT_RADIUS * 2 };
	const pointer = new THREE.Vector2();
	const worldPos = new THREE.Vector3();
	const referenceDistance = camera.position.distanceTo(controls.target);
	let animationFrame = 0;

	function updateScreenSpacePointScales() {
		for (const mesh of pointMeshes) {
			mesh.getWorldPosition(worldPos);
			const scale = screenSpacePointScale(camera.position.distanceTo(worldPos), referenceDistance);
			mesh.scale.setScalar(scale);
		}

		if (highlightGroup.visible) {
			const scale = screenSpacePointScale(
				camera.position.distanceTo(highlightGroup.position),
				referenceDistance
			);
			highlightGroup.scale.setScalar(scale);
		}
	}

	let currentSelectedId: string | null = null;

	function setSelectedId(id: string | null) {
		currentSelectedId = id;
		for (const mesh of pointMeshes) {
			const on = id !== null && mesh.userData.itemId === id;
			const mat = mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = on ? 1 : 0.88;
			const labelEl = labelByItemId.get(mesh.userData.itemId as string);
			if (labelEl) {
				labelEl.classList.toggle('embedding-map-label--selected', on);
			}
		}

		if (id === null) {
			highlightGroup.visible = false;
			return;
		}

		const target = pointMeshes.find((m) => m.userData.itemId === id);
		if (!target || !target.visible) {
			highlightGroup.visible = false;
			return;
		}

		highlightGroup.position.copy(target.position);
		highlightGroup.visible = true;
	}

	function setVisibleSubtypes(visibleTypes: ReadonlySet<string>) {
		const showAll = visibleTypes.size === 0;
		for (const mesh of pointMeshes) {
			const item = mesh.userData.item as EmbeddingSnapshotItem;
			const visible = showAll || visibleTypes.has(item.subtype);
			mesh.visible = visible;
			const labelEl = labelByItemId.get(mesh.userData.itemId as string);
			if (labelEl) {
				labelEl.style.display = visible ? '' : 'none';
			}
		}

		if (currentSelectedId !== null) {
			const selectedMesh = pointMeshes.find((m) => m.userData.itemId === currentSelectedId);
			if (!selectedMesh?.visible) {
				setSelectedId(null);
				onSelectItem?.(null);
			}
		}
	}

	function resize() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w < 1 || h < 1) return;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h, true);
		labelRenderer.setSize(w, h);
	}

	let pointerDownX = 0;
	let pointerDownY = 0;
	let pointerDragged = false;
	let shiftKeyHeld = false;

	function updateCanvasCursor() {
		if (pointerDragged) {
			renderer.domElement.style.cursor = shiftKeyHeld ? 'move' : 'grabbing';
			return;
		}
		renderer.domElement.style.cursor = shiftKeyHeld ? 'move' : 'grab';
	}

	function onPointerDown(event: PointerEvent) {
		pointerDownX = event.clientX;
		pointerDownY = event.clientY;
		pointerDragged = false;
		shiftKeyHeld = event.shiftKey;
		updateCanvasCursor();
	}

	function onPointerMove(event: PointerEvent) {
		if (pointerDragged) return;
		const dx = event.clientX - pointerDownX;
		const dy = event.clientY - pointerDownY;
		if (Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX) {
			pointerDragged = true;
			updateCanvasCursor();
		}
	}

	function onPointerUp(event: PointerEvent) {
		shiftKeyHeld = event.shiftKey;
		updateCanvasCursor();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Shift') return;
		shiftKeyHeld = true;
		updateCanvasCursor();
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.key !== 'Shift') return;
		shiftKeyHeld = false;
		updateCanvasCursor();
	}

	function onWheelCapture(event: WheelEvent) {
		if (embeddingMapWheelMode(event) !== 'pan') return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const { x, y } = embeddingMapWheelPanDeltas(event.deltaX, event.deltaY);
		controls.pan(x, y);
		controls.update();
	}

	function onClick(event: MouseEvent) {
		if (embeddingMapShouldSuppressSelectionClick({ dragged: pointerDragged, shiftKey: event.shiftKey })) {
			pointerDragged = false;
			return;
		}

		const rect = renderer.domElement.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(pointMeshes, false);
		if (hits.length > 0) {
			const hit = hits[0].object as THREE.Mesh;
			const item = hit.userData.item as EmbeddingSnapshotItem;
			onSelectItem?.(item);
			pointerDragged = false;
			return;
		}
		onSelectItem?.(null);
		pointerDragged = false;
	}

	function animate() {
		animationFrame = requestAnimationFrame(animate);
		controls.update();
		updateScreenSpacePointScales();
		renderer.render(scene, camera);
		labelRenderer.render(scene, camera);
	}

	renderer.domElement.addEventListener('pointerdown', onPointerDown);
	renderer.domElement.addEventListener('pointermove', onPointerMove);
	renderer.domElement.addEventListener('pointerup', onPointerUp);
	renderer.domElement.addEventListener('pointercancel', onPointerUp);
	renderer.domElement.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
	renderer.domElement.addEventListener('click', onClick);
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	resize();
	animate();

	return {
		resize,
		setSelectedId,
		setVisibleSubtypes,
		dispose() {
			cancelAnimationFrame(animationFrame);
			renderer.domElement.removeEventListener('pointerdown', onPointerDown);
			renderer.domElement.removeEventListener('pointermove', onPointerMove);
			renderer.domElement.removeEventListener('pointerup', onPointerUp);
			renderer.domElement.removeEventListener('pointercancel', onPointerUp);
			renderer.domElement.removeEventListener('wheel', onWheelCapture, { capture: true });
			renderer.domElement.removeEventListener('click', onClick);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			controls.dispose();
			sphereGeometry.dispose();
			highlightGeometry.dispose();
			highlightCore.geometry.dispose();
			for (const mesh of pointMeshes) {
				(mesh.material as THREE.Material).dispose();
				scene.remove(mesh);
			}
			highlightMaterial.dispose();
			highlightRingMaterial.dispose();
			scene.remove(highlightGroup);
			renderer.dispose();
			renderer.domElement.remove();
			labelRenderer.domElement.remove();
		}
	};
}
