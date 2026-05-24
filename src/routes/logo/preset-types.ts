import type { BallAnchor } from "./metaball-interaction";
import type { LogoTextLayer } from "./text-layer";
import type { TextDotPlacementMode } from "./text-to-metaballs";
import {
  DEFAULT_METABALL_FIELD_PARAMS,
  fieldParamsFromPartial,
  type MetaballFieldParams,
} from "./metaball-params";
import { scaleTextLayersToCanvas, normalizeTextLayer } from "./text-layer";

/** Serializable dot layout and related display options from the logo canvas. */
export type LogoDotPreset = {
  id: number;
  savedAt: string;
  canvasWidth: number;
  canvasHeight: number;
  ballAnchors: BallAnchor[];
  ballRadius: number;
  positionJitter: number;
  noiseAmount: number;
  noiseSeed: number;
  connectBalls: boolean;
  typeText: string;
  typeFontSize: number;
  /** Omitted in presets saved before stroke-line mode existed. */
  typePlacementMode?: TextDotPlacementMode;
  /** Omitted in presets saved before overlay text existed. */
  textLayers?: LogoTextLayer[];
  /** Omitted in presets saved before link settings were persisted. */
  linkAllPairs?: boolean;
  linkNeighborsPerBall?: number;
  linkMaxDistance?: number;
  linkDistanceThinning?: number;
  fieldParams: MetaballFieldParams;
};

export type LogoDotPresetFile = {
  nextId: number;
  presets: LogoDotPreset[];
};

export type LogoDotPresetSummary = Pick<LogoDotPreset, "id" | "savedAt"> & {
  ballCount: number;
};

/** Autosaved working copy (`data/logo-dot-current.json`). */
export type LogoDotCurrent = Omit<LogoDotPreset, "id">;

export function snapshotFromEditor(input: {
  canvasWidth: number;
  canvasHeight: number;
  ballAnchors: BallAnchor[];
  ballRadius: number;
  positionJitter: number;
  noiseAmount: number;
  noiseSeed: number;
  connectBalls: boolean;
  typeText: string;
  typeFontSize: number;
  typePlacementMode: TextDotPlacementMode;
  textLayers: LogoTextLayer[];
  linkAllPairs: boolean;
  linkNeighborsPerBall: number;
  linkMaxDistance: number;
  linkDistanceThinning: number;
  fieldParams: MetaballFieldParams;
}): Omit<LogoDotPreset, "id" | "savedAt"> {
  return {
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    ballAnchors: input.ballAnchors.map((a) => ({ ...a })),
    ballRadius: input.ballRadius,
    positionJitter: input.positionJitter,
    noiseAmount: input.noiseAmount,
    noiseSeed: input.noiseSeed,
    connectBalls: input.connectBalls,
    typeText: input.typeText,
    typeFontSize: input.typeFontSize,
    typePlacementMode: input.typePlacementMode,
    textLayers: input.textLayers.map((layer) => normalizeTextLayer({ ...layer })),
    linkAllPairs: input.linkAllPairs,
    linkNeighborsPerBall: input.linkNeighborsPerBall,
    linkMaxDistance: input.linkMaxDistance,
    linkDistanceThinning: input.linkDistanceThinning,
    fieldParams: { ...input.fieldParams },
  };
}

export function scalePresetToCanvas(
  preset: LogoDotPreset,
  canvasWidth: number,
  canvasHeight: number,
): Omit<LogoDotPreset, "id" | "savedAt"> {
  const sx = canvasWidth / preset.canvasWidth;
  const sy = canvasHeight / preset.canvasHeight;
  const scaleR = Math.min(sx, sy);
  return {
    canvasWidth,
    canvasHeight,
    ballAnchors: preset.ballAnchors.map((a) => ({
      ...a,
      x: a.x * sx,
      y: a.y * sy,
      r: a.r * scaleR,
    })),
    ballRadius: preset.ballRadius * scaleR,
    positionJitter: preset.positionJitter,
    noiseAmount: preset.noiseAmount,
    noiseSeed: preset.noiseSeed,
    connectBalls: preset.connectBalls,
    typeText: preset.typeText,
    typeFontSize: preset.typeFontSize,
    typePlacementMode: preset.typePlacementMode ?? "fill",
    textLayers: scaleTextLayersToCanvas(preset.textLayers ?? [], sx, sy).map(normalizeTextLayer),
    linkAllPairs: preset.linkAllPairs ?? false,
    linkNeighborsPerBall: preset.linkNeighborsPerBall ?? 2,
    linkMaxDistance: preset.linkMaxDistance ?? 0,
    linkDistanceThinning: preset.linkDistanceThinning ?? 0.75,
    fieldParams: fieldParamsFromPartial(preset.fieldParams),
  };
}

export { DEFAULT_METABALL_FIELD_PARAMS };
