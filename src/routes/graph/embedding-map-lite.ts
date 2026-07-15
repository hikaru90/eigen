import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';
import { isEmbeddingItemVisibleByAuthorLayers } from '$lib/graph/graph-author-layers';

export type EmbeddingMapLitePoint = {
	item: EmbeddingSnapshotItem;
	x: number;
	y: number;
	color: string;
};

export type CreateEmbeddingMapLiteOptions = {
	container: HTMLElement;
	points: EmbeddingMapLitePoint[];
	onSelectItem?: (item: EmbeddingSnapshotItem | null) => void;
};

export type EmbeddingMapLiteHandle = {
	resize: () => void;
	setSelectedId: (id: string | null) => void;
	setVisibleSubtypes: (visibleTypes: ReadonlySet<string>) => void;
	setVisibleAuthorLayers: (visibleLayers: ReadonlySet<string>) => void;
	dispose: () => void;
};

const POINT_RADIUS = 4;
const HIGHLIGHT_RADIUS = 8;
const HIGHLIGHT_COLOR = '#fbbf24';
const LABEL_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
const LABEL_MAX_WIDTH = 176;
const LABEL_PADDING = 4;
const LABEL_OFFSET_X = 12;
const LABEL_OFFSET_Y = 4;

/** Match 2D graph node label truncation on /graph. */
function embeddingMapLabelText(item: EmbeddingSnapshotItem): string {
	const base = item.label?.trim() || item.id;
	return base.length > 42 ? `${base.slice(0, 40)}…` : base;
}

/** Convert world coords to screen coords with pan/zoom transform */
function worldToScreen(
	x: number,
	y: number,
	width: number,
	height: number,
	offsetX: number,
	offsetY: number,
	scale: number
): { sx: number; sy: number } {
	const sx = (x * scale + offsetX) * width / 2 + width / 2;
	const sy = (-y * scale + offsetY) * height / 2 + height / 2;
	return { sx, sy };
}

export function createEmbeddingMapLite(options: CreateEmbeddingMapLiteOptions): EmbeddingMapLiteHandle {
	const { container, points, onSelectItem } = options;

	const canvas = document.createElement('canvas');
	canvas.className = 'embedding-map-lite touch-none';
	canvas.style.cursor = 'default';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	container.appendChild(canvas);

	const ctx = canvas.getContext('2d')!;

	/** Transform state */
	let offsetX = 0;
	let offsetY = 0;
	let scale = 1;
	let selectedId: string | null = null;
	const visibleFlags = new Uint8Array(points.length).fill(1);
	let visibleSubtypes = new Set<string>();
	let visibleAuthorLayers = new Set<string>();

	function recomputeVisibility() {
		const showAllSubtypes = visibleSubtypes.size === 0;
		for (let i = 0; i < points.length; i++) {
			const item = points[i].item;
			const subtypeOk = showAllSubtypes || visibleSubtypes.has(item.subtype);
			const authorOk = isEmbeddingItemVisibleByAuthorLayers(item, visibleAuthorLayers);
			visibleFlags[i] = subtypeOk && authorOk ? 1 : 0;
		}
	}

	/** Interaction state */
	let isDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;

	function resize() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w < 1 || h < 1) return;

		const dpr = Math.min(window.devicePixelRatio, 2);
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx.scale(dpr, dpr);

		render();
	}

	function render() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w < 1 || h < 1) return;

		ctx.clearRect(0, 0, w, h);

		/** Draw edges first (light gray lines between nearby points) */
		ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
		ctx.lineWidth = 1;
		for (let i = 0; i < points.length; i++) {
			if (!visibleFlags[i]) continue;
			const p1 = points[i];
			const s1 = worldToScreen(p1.x, p1.y, w, h, offsetX, offsetY, scale);

			/** Connect to a few nearest neighbors */
			for (let j = i + 1; j < Math.min(i + 5, points.length); j++) {
				if (!visibleFlags[j]) continue;
				const p2 = points[j];
				const s2 = worldToScreen(p2.x, p2.y, w, h, offsetX, offsetY, scale);
				const dist = Math.hypot(s2.sx - s1.sx, s2.sy - s1.sy);
				if (dist < 100) {
					ctx.beginPath();
					ctx.moveTo(s1.sx, s1.sy);
					ctx.lineTo(s2.sx, s2.sy);
					ctx.stroke();
				}
			}
		}

		/** Draw points */
		for (let i = 0; i < points.length; i++) {
			if (!visibleFlags[i]) continue;
			const point = points[i];
			const { sx, sy } = worldToScreen(point.x, point.y, w, h, offsetX, offsetY, scale);

			const isSelected = point.item.id === selectedId;
			const radius = isSelected ? HIGHLIGHT_RADIUS : POINT_RADIUS;

			/** Highlight glow */
			if (isSelected) {
				ctx.beginPath();
				ctx.arc(sx, sy, HIGHLIGHT_RADIUS + 4, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
				ctx.fill();
			}

			/** Point */
			ctx.beginPath();
			ctx.arc(sx, sy, radius, 0, Math.PI * 2);
			ctx.fillStyle = isSelected ? HIGHLIGHT_COLOR : point.color;
			ctx.globalAlpha = selectedId ? (isSelected ? 1 : 0.5) : 0.88;
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		/** Draw labels for selected or hovered points */
		for (let i = 0; i < points.length; i++) {
			if (!visibleFlags[i]) continue;
			const point = points[i];
			const isSelected = point.item.id === selectedId;
			if (!isSelected) continue;

			const { sx, sy } = worldToScreen(point.x, point.y, w, h, offsetX, offsetY, scale);
			const text = embeddingMapLabelText(point.item);

			/** Measure text */
			ctx.font = LABEL_FONT;
			const textWidth = Math.min(ctx.measureText(text).width, LABEL_MAX_WIDTH - LABEL_PADDING * 2);

			const labelX = sx + LABEL_OFFSET_X;
			const labelY = sy + LABEL_OFFSET_Y;
			const boxWidth = textWidth + LABEL_PADDING * 2;
			const boxHeight = 16;

			/** Label background */
			ctx.fillStyle = 'color-mix(in oklab, var(--background) 88%, transparent)';
			ctx.globalAlpha = 0.92;
			ctx.beginPath();
			ctx.roundRect(labelX - LABEL_PADDING, labelY - 10, boxWidth, boxHeight, 2);
			ctx.fill();
			ctx.globalAlpha = 1;

			/** Label border for selected */
			if (isSelected) {
				ctx.strokeStyle = HIGHLIGHT_COLOR;
				ctx.lineWidth = 1;
				ctx.stroke();
			}

			/** Label text */
			ctx.fillStyle = 'var(--foreground)';
			ctx.font = LABEL_FONT;
			ctx.textBaseline = 'middle';
			ctx.fillText(text, labelX, labelY - 2);
		}
	}

	function setSelectedId(id: string | null) {
		selectedId = id;
		render();
	}

	function setVisibleSubtypes(visibleTypes: ReadonlySet<string>) {
		visibleSubtypes = new Set(visibleTypes);
		recomputeVisibility();
		render();
	}

	function setVisibleAuthorLayers(visibleLayers: ReadonlySet<string>) {
		visibleAuthorLayers = new Set(visibleLayers);
		recomputeVisibility();
		render();
	}

	function findNearestPoint(screenX: number, screenY: number): EmbeddingSnapshotItem | null {
		const w = container.clientWidth;
		const h = container.clientHeight;
		let closestIdx = -1;
		let closestDist = Infinity;

		for (let i = 0; i < points.length; i++) {
			if (!visibleFlags[i]) continue;
			const point = points[i];
			const { sx, sy } = worldToScreen(point.x, point.y, w, h, offsetX, offsetY, scale);
			const dist = Math.hypot(sx - screenX, sy - screenY);
			if (dist < closestDist && dist < 20) {
				closestDist = dist;
				closestIdx = i;
			}
		}

		return closestIdx >= 0 ? points[closestIdx].item : null;
	}

	function onPointerDown(e: PointerEvent) {
		isDragging = false;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
	}

	function onPointerMove(e: PointerEvent) {
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		if (Math.hypot(dx, dy) > 4) {
			isDragging = true;
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) {
			const rect = canvas.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			const item = findNearestPoint(sx, sy);
			onSelectItem?.(item);
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		scale = Math.max(0.1, Math.min(10, scale * delta));
		render();
	}

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointercancel', onPointerUp);
	canvas.addEventListener('wheel', onWheel, { passive: false });

	resize();

	return {
		resize,
		setSelectedId,
		setVisibleSubtypes,
		setVisibleAuthorLayers,
		dispose() {
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('pointerup', onPointerUp);
			canvas.removeEventListener('pointercancel', onPointerUp);
			canvas.removeEventListener('wheel', onWheel);
			canvas.remove();
		}
	};
}
