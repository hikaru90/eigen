import type { Metaball } from "./metaball-gl";
import { ensurePenStrokeFont, penStrokePointsFromText } from "./pen-stroke-from-text";

/** How typed text is turned into metaball anchor points. */
export type TextDotPlacementMode = "fill" | "skeleton";

export type TextToMetaballsOptions = {
  text: string;
  /** `fill` = hex grid inside glyphs; `skeleton` = pen-stroke corners (minimal points). */
  placementMode?: TextDotPlacementMode;
  /** Canvas pixel width (e.g. backing store). */
  width: number;
  /** Canvas pixel height. */
  height: number;
  /** CSS/layout width used for font metrics (defaults to width). */
  layoutWidth?: number;
  /** CSS/layout height (defaults to height). */
  layoutHeight?: number;
  /** Multiply layout units → canvas pixels (e.g. devicePixelRatio). */
  pixelScale?: number;
  ballRadius: number;
  maxBalls: number;
  /** Type size in CSS px; when omitted, auto-fits within max text box. */
  fontSize?: number;
};

export type TextToMetaballsResult = {
  balls: Metaball[];
  placementRadius: number;
  fontSize: number;
};

type Point = { x: number; y: number };

type Mask = {
  width: number;
  height: number;
  ink: Uint8Array;
};

const MASK_SCALE = 3;
const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const HEX_SQRT3_HALF = Math.sqrt(3) / 2;
/** Max share of canvas used by the text block (smaller = more margin around word). */
const MAX_TEXT_WIDTH_RATIO = 0.58;
const MAX_TEXT_HEIGHT_RATIO = 0.34;

function fontString(sizePx: number): string {
  return `800 ${sizePx}px ${FONT_FAMILY}`;
}

function parseFontSizePx(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number(match[1]) : 48;
}

function buildMask(imageData: ImageData): Mask {
  const { width, height, data } = imageData;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const sum = data[i] + data[i + 1] + data[i + 2];
      ink[y * width + x] = sum < 600 ? 1 : 0;
    }
  }
  return { width, height, ink };
}

/** Thicken glyph mask so thin strokes get interior sample points. */
function dilateMask(mask: Mask, iterations: number): Mask {
  const { width, height } = mask;
  let cur = mask.ink;
  for (let n = 0; n < iterations; n++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (cur[i]) {
          next[i] = 1;
          continue;
        }
        let hit = false;
        for (let oy = -1; oy <= 1 && !hit; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (cur[ny * width + nx]) {
              hit = true;
              break;
            }
          }
        }
        if (hit) next[i] = 1;
      }
    }
    cur = next;
  }
  return { width, height, ink: cur };
}

function isInk(mask: Mask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.ink[y * mask.width + x] === 1;
}

function countInk(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.ink.length; i++) n += mask.ink[i];
  return n;
}

function cellMostlyInk(mask: Mask, cx: number, cy: number, probe: number): boolean {
  let hits = 0;
  let total = 0;
  const r = Math.max(1, Math.ceil(probe));
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      total++;
      if (isInk(mask, Math.round(cx + ox), Math.round(cy + oy))) hits++;
    }
  }
  return hits / total >= 0.45;
}

/**
 * Hexagonal grid fill inside the glyph — approximates the shape with packed circles,
 * not outline tracing.
 */
function hexFillMask(mask: Mask, spacing: number): Point[] {
  const rowH = spacing * HEX_SQRT3_HALF;
  const points: Point[] = [];
  let row = 0;
  for (let y = rowH * 0.5; y < mask.height; y += rowH) {
    const xOff = (row % 2) * (spacing * 0.5);
    for (let x = spacing * 0.5 + xOff; x < mask.width; x += spacing) {
      if (cellMostlyInk(mask, x, y, spacing * 0.42)) {
        points.push({ x: Math.round(x), y: Math.round(y) });
      }
    }
    row++;
  }
  points.sort((a, b) => a.y - b.y || a.x - b.x);
  return points;
}

function evenSubsample(points: Point[], maxCount: number): Point[] {
  if (points.length <= maxCount) return points;
  const out: Point[] = [];
  const stride = points.length / maxCount;
  for (let i = 0; i < maxCount; i++) {
    out.push(points[Math.floor(i * stride)]);
  }
  return out;
}

async function approximatePenStrokeWithBalls(
  text: string,
  maskW: number,
  maskH: number,
  userRadius: number,
  fontSize: number,
  maxBalls: number,
): Promise<{ points: Point[]; placementRadius: number }> {
  const font = await ensurePenStrokeFont();
  const maskFontSize = fontSize * MASK_SCALE;
  const segmentSpacing = Math.max(
    userRadius * MASK_SCALE * 2.2,
    maskFontSize * 0.22,
  );
  let points = penStrokePointsFromText(
    font,
    text,
    maskFontSize,
    Math.ceil(maskW * MASK_SCALE),
    Math.ceil(maskH * MASK_SCALE),
    segmentSpacing,
  );
  const placementRadius = Math.min(userRadius, Math.max(4, fontSize * 0.11));
  if (points.length > maxBalls) {
    points = evenSubsample(points, maxBalls);
  }
  return { points, placementRadius };
}

/** Tune spacing & radius so ~maxBalls fill the ink region. */
function approximateGlyphsWithBalls(
  mask: Mask,
  maxBalls: number,
  userRadius: number,
  fontSize: number,
): { points: Point[]; placementRadius: number } {
  const ink = countInk(mask);
  if (ink === 0) {
    return { points: [], placementRadius: Math.min(userRadius, Math.max(4, fontSize * 0.12)) };
  }

  const areaPerBall = ink / maxBalls;
  let placementRadius = Math.min(
    userRadius,
    Math.max(4, Math.min(fontSize * 0.13, Math.sqrt(areaPerBall / Math.PI) * 1.15)),
  );

  let spacing = placementRadius * 0.92;
  let points = hexFillMask(mask, spacing);

  for (let i = 0; i < 24 && points.length > maxBalls * 1.08; i++) {
    spacing *= 1.05;
    points = hexFillMask(mask, spacing);
  }

  for (let i = 0; i < 24 && points.length < maxBalls * 0.82; i++) {
    spacing *= 0.95;
    placementRadius *= 0.97;
    points = hexFillMask(mask, spacing);
  }

  if (points.length > maxBalls) {
    points = evenSubsample(points, maxBalls);
  }

  return { points, placementRadius };
}

function measureTextBlock(
  text: string,
  font: string,
): { width: number; height: number; fontSize: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: 0, height: 0, fontSize: parseFontSizePx(font) };
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const fontSize = parseFontSizePx(font);
  return {
    width: metrics.width,
    height:
      (metrics.actualBoundingBoxAscent ?? fontSize * 0.82) +
      (metrics.actualBoundingBoxDescent ?? fontSize * 0.22),
    fontSize,
  };
}

/** Default type size for the slider before the user adjusts it. */
export function suggestTypeFontSize(
  text: string,
  layoutWidth: number,
  layoutHeight: number,
): number {
  const maxTextW = layoutWidth * MAX_TEXT_WIDTH_RATIO;
  const maxTextH = layoutHeight * MAX_TEXT_HEIGHT_RATIO;
  return fitFontSize(text, maxTextW, maxTextH).fontSize;
}

export function typeFontSizeRange(
  layoutWidth: number,
  layoutHeight: number,
  textLength: number,
): { min: number; max: number } {
  const len = Math.max(1, textLength);
  const max = Math.floor(
    Math.min(layoutHeight * MAX_TEXT_HEIGHT_RATIO, layoutWidth / (len * 0.52)),
  );
  return { min: 12, max: Math.max(24, max) };
}

function fitFontSize(text: string, maxWidth: number, maxHeight: number): { fontSize: number; font: string } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { fontSize: 24, font: fontString(24) };

  let fontSize = Math.min(
    maxHeight,
    maxWidth / Math.max(0.55, text.length * 0.52),
  );

  while (fontSize > 12) {
    const font = fontString(fontSize);
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const textH =
      (metrics.actualBoundingBoxAscent ?? fontSize * 0.82) +
      (metrics.actualBoundingBoxDescent ?? fontSize * 0.22);
    if (textW <= maxWidth && textH <= maxHeight) {
      return { fontSize, font };
    }
    fontSize -= 1;
  }

  return { fontSize, font: fontString(fontSize) };
}

function renderTextMask(
  text: string,
  font: string,
  layoutW: number,
  layoutH: number,
): Mask | null {
  const w = Math.ceil(layoutW * MASK_SCALE);
  const h = Math.ceil(layoutH * MASK_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const fontSize = parseFontSizePx(font) * MASK_SCALE;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.font = fontString(fontSize);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.fillText(text, w / 2, h / 2);

  const raw = buildMask(ctx.getImageData(0, 0, w, h));
  return dilateMask(raw, 2);
}

export async function metaballsFromText(
  options: TextToMetaballsOptions,
): Promise<TextToMetaballsResult> {
  const text = options.text.trim();
  if (!text) {
    return {
      balls: [],
      placementRadius: options.ballRadius,
      fontSize: options.fontSize ?? 48,
    };
  }

  const {
    width,
    height,
    ballRadius,
    maxBalls,
    layoutWidth = width,
    layoutHeight = height,
    pixelScale = 1,
    fontSize: requestedFontSize,
  } = options;

  const maxTextW = layoutWidth * MAX_TEXT_WIDTH_RATIO;
  const maxTextH = layoutHeight * MAX_TEXT_HEIGHT_RATIO;
  const { min: fontMin, max: fontMax } = typeFontSizeRange(layoutWidth, layoutHeight, text.length);

  let fontSize =
    requestedFontSize === undefined
      ? fitFontSize(text, maxTextW, maxTextH).fontSize
      : Math.min(fontMax, Math.max(fontMin, requestedFontSize));

  let font = fontString(fontSize);
  let block = measureTextBlock(text, font);

  while (fontSize > fontMin && (block.width > maxTextW || block.height > maxTextH)) {
    fontSize -= 1;
    font = fontString(fontSize);
    block = measureTextBlock(text, font);
  }

  const pad = Math.max(ballRadius * 1.4, 10);
  const maskW = block.width + pad * 2;
  const maskH = block.height + pad * 2;
  const maskWCanvas = maskW * pixelScale;
  const maskHCanvas = maskH * pixelScale;

  const placementMode = options.placementMode ?? "fill";
  const { points, placementRadius } =
    placementMode === "skeleton"
      ? await approximatePenStrokeWithBalls(text, maskW, maskH, ballRadius, fontSize, maxBalls)
      : (() => {
          const mask = renderTextMask(text, font, maskW, maskH);
          if (!mask) return { points: [] as Point[], placementRadius: ballRadius };
          return approximateGlyphsWithBalls(mask, maxBalls, ballRadius, fontSize);
        })();

  const originX = (width - maskWCanvas) / 2;
  const originY = (height - maskHCanvas) / 2;
  const padClamp = placementRadius + 4;

  const balls = points.map(({ x, y }) => ({
    x: Math.min(
      width - padClamp,
      Math.max(padClamp, originX + (x / MASK_SCALE) * pixelScale),
    ),
    y: Math.min(
      height - padClamp,
      Math.max(padClamp, originY + (y / MASK_SCALE) * pixelScale),
    ),
    r: placementRadius,
  }));

  return { balls, placementRadius, fontSize };
}
