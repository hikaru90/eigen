import * as THREE from 'three';
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
	dispose: () => void;
};

const POINT_RADIUS = 0.028;
const HIGHLIGHT_RADIUS = 0.048;
const HIGHLIGHT_COLOR = 0xfbbf24;

/** Match /graph force layout: text at x=12, y=4 beside the node circle. */
const LABEL_MARGIN_LEFT_PX = 12;
const LABEL_MARGIN_TOP_PX = 4;

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

	const stackLayer = (el: HTMLElement) => {
		el.style.position = 'absolute';
		el.style.top = '0';
		el.style.left = '0';
	};
	stackLayer(renderer.domElement);
	stackLayer(labelRenderer.domElement);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.rotateSpeed = 0.65;
	controls.zoomSpeed = 0.9;
	controls.panSpeed = 0.75;
	controls.minDistance = 0.4;
	controls.maxDistance = 8;

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
	let animationFrame = 0;

	function setSelectedId(id: string | null) {
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
		if (!target) {
			highlightGroup.visible = false;
			return;
		}

		highlightGroup.position.copy(target.position);
		highlightGroup.visible = true;
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

	function onPointerDown() {
		renderer.domElement.style.cursor = 'grabbing';
	}

	function onPointerUp() {
		renderer.domElement.style.cursor = 'grab';
	}

	function onClick(event: MouseEvent) {
		const rect = renderer.domElement.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(pointMeshes, false);
		if (hits.length > 0) {
			const hit = hits[0].object as THREE.Mesh;
			const item = hit.userData.item as EmbeddingSnapshotItem;
			onSelectItem?.(item);
			return;
		}
		onSelectItem?.(null);
	}

	function animate() {
		animationFrame = requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
		labelRenderer.render(scene, camera);
	}

	renderer.domElement.addEventListener('pointerdown', onPointerDown);
	renderer.domElement.addEventListener('pointerup', onPointerUp);
	renderer.domElement.addEventListener('click', onClick);

	resize();
	animate();

	return {
		resize,
		setSelectedId,
		dispose() {
			cancelAnimationFrame(animationFrame);
			renderer.domElement.removeEventListener('pointerdown', onPointerDown);
			renderer.domElement.removeEventListener('pointerup', onPointerUp);
			renderer.domElement.removeEventListener('click', onClick);
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
