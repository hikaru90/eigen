import { describe, expect, it } from 'vitest';
import {
	createDrawScheduler,
	findNearestGraphNode,
	popInNodeScale,
	roundTripScreenWorld,
	screenToWorld,
	type FrameScheduler,
	type GraphCanvasNode,
	worldToScreen
} from './graph-canvas-render';

describe('screenToWorld / worldToScreen', () => {
	const transform = { k: 2, x: 100, y: 50 };

	it('inverts zoom translate + scale', () => {
		expect(screenToWorld(200, 150, transform)).toEqual({ x: 50, y: 50 });
		expect(worldToScreen(50, 50, transform)).toEqual({ x: 200, y: 150 });
	});

	it('round-trips within tolerance', () => {
		const back = roundTripScreenWorld(320, 480, transform);
		expect(back.x).toBeCloseTo(320, 5);
		expect(back.y).toBeCloseTo(480, 5);
	});
});

describe('findNearestGraphNode', () => {
	const nodes: GraphCanvasNode[] = [
		{ id: 'a', x: 0, y: 0, radius: 8, fill: '#fff', label: 'A', selected: false },
		{ id: 'b', x: 40, y: 0, radius: 8, fill: '#fff', label: 'B', selected: false }
	];

	it('returns the nearest node within hit radius', () => {
		expect(findNearestGraphNode(2, 1, nodes)?.id).toBe('a');
		expect(findNearestGraphNode(38, 0, nodes)?.id).toBe('b');
	});

	it('returns null when outside all hit radii', () => {
		expect(findNearestGraphNode(20, 0, nodes)).toBeNull();
	});
});

describe('popInNodeScale', () => {
	it('starts small and ends at 1', () => {
		expect(popInNodeScale(0, 520)).toBeCloseTo(0.08, 2);
		expect(popInNodeScale(520, 520)).toBe(1);
	});
});

describe('createDrawScheduler', () => {
	it('coalesces a burst of requestDraw calls into one draw on flush', () => {
		const queued: Array<() => void> = [];
		const frame: FrameScheduler = {
			request: (cb) => {
				queued.push(cb);
				return queued.length;
			},
			cancel: () => {}
		};

		let count = 0;
		const scheduler = createDrawScheduler(() => {
			count++;
		}, frame);

		scheduler.requestDraw();
		scheduler.requestDraw();
		scheduler.requestDraw();
		expect(count).toBe(0);
		expect(queued).toHaveLength(1);

		queued[0]();
		expect(count).toBe(1);
		scheduler.dispose();
	});
});
