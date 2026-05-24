import type { Metaball } from "./metaball-gl";

export type CanvasPoint = { x: number; y: number };

/** Canonical ball position; jitter is applied from a fixed direction on display. */
export type BallAnchor = {
  x: number;
  y: number;
  r: number;
  jitterOx: number;
  jitterOy: number;
};

export type BallHit =
  | { kind: "move"; index: number }
  | { kind: "resize"; index: number };

const RESIZE_INNER_FACTOR = 0.55;
const RESIZE_OUTER_FACTOR = 1.15;

export function newBallAnchor(x: number, y: number, r: number): BallAnchor {
  const angle = Math.random() * Math.PI * 2;
  return { x, y, r, jitterOx: Math.cos(angle), jitterOy: Math.sin(angle) };
}

export function jitterAmount01(positionJitter: number, jitterMax: number): number {
  return positionJitter / jitterMax;
}

export function maxJitterOffset(ballRadius: number, amount01: number): number {
  return amount01 * ballRadius * 0.65;
}

export function ballFromAnchor(
  anchor: BallAnchor,
  amount01: number,
  width: number,
  height: number,
): Metaball {
  const offset = maxJitterOffset(anchor.r, amount01);
  const { x, y } = clampBallPosition(
    anchor.x + anchor.jitterOx * offset,
    anchor.y + anchor.jitterOy * offset,
    anchor.r,
    width,
    height,
  );
  return { x, y, r: anchor.r };
}

export function anchorBaseFromBall(
  ball: Metaball,
  anchor: BallAnchor,
  amount01: number,
): CanvasPoint {
  const offset = maxJitterOffset(anchor.r, amount01);
  return {
    x: ball.x - anchor.jitterOx * offset,
    y: ball.y - anchor.jitterOy * offset,
  };
}

export function canvasPointFromPointer(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): CanvasPoint {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

/** Top-most ball under the pointer (last in array wins). */
export function hitBall(px: CanvasPoint, balls: Metaball[]): BallHit | null {
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    const d = Math.hypot(px.x - b.x, px.y - b.y);
    if (d > b.r * RESIZE_OUTER_FACTOR) continue;
    if (d >= b.r * RESIZE_INNER_FACTOR) return { kind: "resize", index: i };
    if (d <= b.r) return { kind: "move", index: i };
  }
  return null;
}

export function clampBallPosition(
  x: number,
  y: number,
  r: number,
  width: number,
  height: number,
): CanvasPoint {
  const pad = r + 2;
  return {
    x: Math.min(width - pad, Math.max(pad, x)),
    y: Math.min(height - pad, Math.max(pad, y)),
  };
}

export function clampRadius(r: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, r));
}
