import opentype from "opentype.js";
import penFontUrl from "$lib/assets/fonts/GeistMono-Regular.woff?url";

export type Point = { x: number; y: number };

export type PenStrokeFont = ReturnType<typeof opentype.parse>;

type PathCommand = { type: string; x: number; y: number; x1?: number; y1?: number; x2?: number; y2?: number };

let fontLoadPromise: Promise<PenStrokeFont> | null = null;

/** Load stroke font once (fetch + parse; opentype 2.x removed working `load()`). */
export function ensurePenStrokeFont(): Promise<PenStrokeFont> {
  if (!fontLoadPromise) {
    fontLoadPromise = fetch(penFontUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Pen stroke font fetch failed (${res.status})`);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => opentype.parse(buffer))
      .catch((err) => {
        fontLoadPromise = null;
        throw err;
      });
  }
  return fontLoadPromise;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sampleQuadratic(p0: Point, p1: Point, p2: Point, step: number): Point[] {
  const len =
    dist(p0, p1) + dist(p1, p2);
  const n = Math.max(2, Math.ceil(len / step));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, step: number): Point[] {
  const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.ceil(len / step));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;
    out.push({
      x: u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x,
      y: u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y,
    });
  }
  return out;
}

/** Split outline path into pen-down polylines (each moveto starts a stroke). */
export function commandsToStrokes(commands: PathCommand[], curveStep: number): Point[][] {
  const strokes: Point[][] = [];
  let current: Point[] = [];
  let pen: Point | null = null;

  const pushStroke = () => {
    if (current.length >= 2) strokes.push(current);
    current = [];
  };

  for (const cmd of commands) {
    if (cmd.type === "M") {
      pushStroke();
      pen = { x: cmd.x, y: cmd.y };
      current = [pen];
    } else if (cmd.type === "L" && pen) {
      pen = { x: cmd.x, y: cmd.y };
      current.push(pen);
    } else if (cmd.type === "Q" && pen) {
      const end = { x: cmd.x, y: cmd.y };
      const samples = sampleQuadratic(pen, { x: cmd.x1, y: cmd.y1 }, end, curveStep);
      for (let i = 1; i < samples.length; i++) current.push(samples[i]);
      pen = end;
    } else if (cmd.type === "C" && pen) {
      const end = { x: cmd.x, y: cmd.y };
      const samples = sampleCubic(
        pen,
        { x: cmd.x1, y: cmd.y1 },
        { x: cmd.x2, y: cmd.y2 },
        end,
        curveStep,
      );
      for (let i = 1; i < samples.length; i++) current.push(samples[i]);
      pen = end;
    } else if (cmd.type === "Z" && current.length > 0) {
      current.push({ ...current[0] });
      pushStroke();
      pen = null;
    }
  }
  pushStroke();
  return strokes;
}

function turningAngleDeg(a: Point, b: Point, c: Point): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 180;
  const dot = (v1x * v2x + v1y * v2y) / (m1 * m2);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(p, proj);
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.slice();
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[end]];
}

/** Keep stroke ends and corners only — like pen-down path knots. */
export function simplifyPenStroke(polyline: Point[], fontSize: number): Point[] {
  if (polyline.length <= 2) return polyline.slice();
  const curveStep = Math.max(2, fontSize * 0.06);
  const epsilon = Math.max(4, fontSize * 0.14);
  const minCornerDeg = 42;

  const dense = polyline.length > 3 ? rdp(polyline, epsilon * 0.35) : polyline.slice();
  const out: Point[] = [dense[0]];
  for (let i = 1; i < dense.length - 1; i++) {
    const angle = turningAngleDeg(dense[i - 1], dense[i], dense[i + 1]);
    if (angle < 180 - minCornerDeg) out.push(dense[i]);
  }
  out.push(dense[dense.length - 1]);
  return rdp(out, epsilon);
}

/** Add dots along each straight segment between corner/endpoint knots. */
export function sampleAlongKnots(knots: Point[], spacing: number): Point[] {
  if (knots.length === 0) return [];
  if (knots.length === 1 || spacing <= 0) return knots.slice();

  const out: Point[] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    out.push(a);
    const segLen = dist(a, b);
    if (segLen < spacing * 0.45) continue;
    let d = spacing;
    while (d < segLen - spacing * 0.35) {
      const t = d / segLen;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      d += spacing;
    }
  }
  out.push(knots[knots.length - 1]);
  return out;
}

function clusterPoints(points: Point[], radius: number): Point[] {
  if (points.length === 0) return [];
  const r2 = radius * radius;
  const clusters: { x: number; y: number; n: number }[] = [];
  for (const p of points) {
    let best = -1;
    let bestD2 = r2;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        best = i;
        bestD2 = d2;
      }
    }
    if (best >= 0) {
      const c = clusters[best];
      const nn = c.n + 1;
      c.x = (c.x * c.n + p.x) / nn;
      c.y = (c.y * c.n + p.y) / nn;
      c.n = nn;
    } else {
      clusters.push({ x: p.x, y: p.y, n: 1 });
    }
  }
  return clusters.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) }));
}

/**
 * Pen-plotter style points: corners + interpolated dots along each stroke segment.
 * Coordinates: mask pixels, y down (canvas space).
 */
export function penStrokePointsFromText(
  font: PenStrokeFont,
  text: string,
  fontSize: number,
  maskWidth: number,
  maskHeight: number,
  segmentSpacing?: number,
): Point[] {
  const spacing = segmentSpacing ?? Math.max(8, fontSize * 0.28);
  const probe = font.getPath(text, 0, 0, fontSize);
  const bb = probe.getBoundingBox();
  const textW = bb.x2 - bb.x1;
  const textH = bb.y2 - bb.y1;
  const ox = (maskWidth - textW) / 2 - bb.x1;
  const oy = (maskHeight - textH) / 2 - bb.y1;

  const path = font.getPath(text, ox, oy, fontSize);
  const curveStep = Math.max(2, fontSize * 0.06);
  const strokes = commandsToStrokes(path.commands, curveStep);
  const all: Point[] = [];

  for (const stroke of strokes) {
    const knots = simplifyPenStroke(stroke, fontSize);
    const placed = sampleAlongKnots(knots, spacing);
    for (const p of placed) {
      all.push({ x: p.x, y: maskHeight - p.y });
    }
  }

  return clusterPoints(all, Math.max(3, fontSize * 0.07));
}
