import {
  snapshotFromEditor,
  type LogoDotPreset,
} from "../../../routes/logo/preset-types";
import type { BallAnchor } from "../../../routes/logo/metaball-interaction";
import {
  fieldParamsFromPartial,
  type MetaballFieldParams,
} from "../../../routes/logo/metaball-params";
import type { LogoAppIconOverlay } from "../../../routes/logo/app-icon-overlay";
import {
  APP_ICON_CORNER_RATIO_MAX,
  APP_ICON_CORNER_RATIO_MIN,
  APP_ICON_SIZE_MIN,
  defaultAppIconOverlay,
  normalizeAppIconOverlay,
} from "../../../routes/logo/app-icon-overlay";
import type { LogoTextLayer } from "../../../routes/logo/text-layer";
import { DEFAULT_LOGO_TEXT_FONT_WEIGHT } from "../../../routes/logo/text-layer";
import type { TextDotPlacementMode } from "../../../routes/logo/text-to-metaballs";

export type LogoEditorSnapshot = Omit<LogoDotPreset, "id" | "savedAt">;

function isBallAnchor(value: unknown): value is BallAnchor {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  const nums = ["x", "y", "r", "jitterOx", "jitterOy"] as const;
  return nums.every((k) => typeof a[k] === "number" && Number.isFinite(a[k] as number));
}

function parseFieldParams(value: unknown): MetaballFieldParams | null {
  if (value === undefined) return fieldParamsFromPartial();
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  const keys = [
    "threshold",
    "fieldStrength",
    "falloffExponent",
    "minDistance",
    "noiseMaskOuter",
    "noiseMaskInner",
    "bridgeStrength",
    "bridgeThinning",
  ] as const;
  if (!keys.every((k) => typeof p[k] === "number" && Number.isFinite(p[k] as number))) {
    return null;
  }
  return fieldParamsFromPartial({
    threshold: p.threshold as number,
    fieldStrength: p.fieldStrength as number,
    falloffExponent: p.falloffExponent as number,
    minDistance: p.minDistance as number,
    noiseMaskOuter: p.noiseMaskOuter as number,
    noiseMaskInner: p.noiseMaskInner as number,
    bridgeStrength: p.bridgeStrength as number,
    bridgeThinning: p.bridgeThinning as number,
  });
}

function parsePlacementMode(value: unknown): TextDotPlacementMode {
  return value === "skeleton" ? "skeleton" : "fill";
}

function parseTextLayer(value: unknown): LogoTextLayer | null {
  if (typeof value !== "object" || value === null) return null;
  const layer = value as Record<string, unknown>;
  if (
    typeof layer.id !== "string" ||
    layer.id.length === 0 ||
    typeof layer.text !== "string" ||
    typeof layer.x !== "number" ||
    !Number.isFinite(layer.x) ||
    typeof layer.y !== "number" ||
    !Number.isFinite(layer.y) ||
    typeof layer.fontSize !== "number" ||
    !Number.isFinite(layer.fontSize) ||
    typeof layer.fontFamily !== "string" ||
    layer.fontFamily.length === 0
  ) {
    return null;
  }
  if (layer.locked !== undefined && typeof layer.locked !== "boolean") return null;
  if (layer.fontWeight !== undefined) {
    if (typeof layer.fontWeight !== "number" || !Number.isFinite(layer.fontWeight)) return null;
    if (layer.fontWeight < 100 || layer.fontWeight > 900) return null;
  }
  return {
    id: layer.id,
    text: layer.text,
    x: layer.x,
    y: layer.y,
    fontSize: layer.fontSize,
    fontFamily: layer.fontFamily,
    fontWeight:
      layer.fontWeight === undefined ? DEFAULT_LOGO_TEXT_FONT_WEIGHT : (layer.fontWeight as number),
    locked: layer.locked === true,
  };
}

function parseTextLayers(value: unknown): LogoTextLayer[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const layers: LogoTextLayer[] = [];
  for (const item of value) {
    const layer = parseTextLayer(item);
    if (!layer) return null;
    layers.push(layer);
  }
  return layers;
}

function parseOptionalLinkNumber(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseLinkSettings(b: Record<string, unknown>): {
  linkAllPairs: boolean;
  linkNeighborsPerBall: number;
  linkMaxDistance: number;
  linkDistanceThinning: number;
} | null {
  const linkAllPairs = b.linkAllPairs === undefined ? false : b.linkAllPairs;
  if (typeof linkAllPairs !== "boolean") return null;
  const linkNeighborsPerBall = parseOptionalLinkNumber(b.linkNeighborsPerBall, 2);
  const linkMaxDistance = parseOptionalLinkNumber(b.linkMaxDistance, 0);
  const linkDistanceThinning = parseOptionalLinkNumber(b.linkDistanceThinning, 0.75);
  if (
    linkNeighborsPerBall === null ||
    linkMaxDistance === null ||
    linkDistanceThinning === null
  ) {
    return null;
  }
  return {
    linkAllPairs,
    linkNeighborsPerBall,
    linkMaxDistance,
    linkDistanceThinning,
  };
}

function parseAppIconOverlay(
  value: unknown,
  canvasWidth: number,
  canvasHeight: number,
): LogoAppIconOverlay | null {
  if (value === undefined) {
    return defaultAppIconOverlay(canvasWidth, canvasHeight);
  }
  if (typeof value !== "object" || value === null) return null;
  const overlay = value as Record<string, unknown>;
  if (overlay.enabled !== undefined && typeof overlay.enabled !== "boolean") return null;
  const nums = ["x", "y", "size", "cornerRadiusRatio"] as const;
  if (!nums.every((k) => typeof overlay[k] === "number" && Number.isFinite(overlay[k] as number))) {
    return null;
  }
  const size = overlay.size as number;
  const cornerRadiusRatio = overlay.cornerRadiusRatio as number;
  if (size < APP_ICON_SIZE_MIN || cornerRadiusRatio < APP_ICON_CORNER_RATIO_MIN) return null;
  if (cornerRadiusRatio > APP_ICON_CORNER_RATIO_MAX) return null;
  return normalizeAppIconOverlay(
    {
      enabled: overlay.enabled === true,
      x: overlay.x as number,
      y: overlay.y as number,
      size,
      cornerRadiusRatio,
    },
    canvasWidth,
    canvasHeight,
  );
}

/** Validate JSON body from the logo editor (preset save or autosave). */
export function parseLogoSnapshotBody(body: unknown): LogoEditorSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.ballAnchors) || !b.ballAnchors.every(isBallAnchor)) return null;
  const nums = [
    "canvasWidth",
    "canvasHeight",
    "ballRadius",
    "positionJitter",
    "noiseAmount",
    "noiseSeed",
    "typeFontSize",
  ] as const;
  if (!nums.every((k) => typeof b[k] === "number" && Number.isFinite(b[k] as number))) {
    return null;
  }
  if (typeof b.connectBalls !== "boolean") return null;
  if (typeof b.typeText !== "string") return null;
  if ((b.canvasWidth as number) < 1 || (b.canvasHeight as number) < 1) return null;
  const fieldParams = parseFieldParams(b.fieldParams);
  if (!fieldParams) return null;
  const textLayers = parseTextLayers(b.textLayers);
  if (textLayers === null) return null;
  const linkSettings = parseLinkSettings(b);
  if (linkSettings === null) return null;
  const appIconOverlay = parseAppIconOverlay(
    b.appIconOverlay,
    b.canvasWidth as number,
    b.canvasHeight as number,
  );
  if (appIconOverlay === null) return null;
  return snapshotFromEditor({
    canvasWidth: b.canvasWidth as number,
    canvasHeight: b.canvasHeight as number,
    ballAnchors: b.ballAnchors as BallAnchor[],
    ballRadius: b.ballRadius as number,
    positionJitter: b.positionJitter as number,
    noiseAmount: b.noiseAmount as number,
    noiseSeed: b.noiseSeed as number,
    connectBalls: b.connectBalls as boolean,
    typeText: b.typeText as string,
    typeFontSize: b.typeFontSize as number,
    typePlacementMode: parsePlacementMode(b.typePlacementMode),
    textLayers,
    ...linkSettings,
    appIconOverlay,
    fieldParams,
  });
}
