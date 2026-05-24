/** Normal text drawn above the metaball canvas (not dot-placement type tool). */
export type LogoTextLayer = {
  id: string;
  text: string;
  /** Canvas-space anchor (center of the text box). */
  x: number;
  y: number;
  fontSize: number;
  /** CSS `font-family` value. */
  fontFamily: string;
  /** CSS `font-weight` (100–900). */
  fontWeight: number;
  /** When true, the layer ignores canvas pointer events (not draggable or selectable). */
  locked: boolean;
};

export const LOGO_TEXT_FONT_WEIGHT_OPTIONS = [
  { value: 100, label: "Thin" },
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
] as const;

export const DEFAULT_LOGO_TEXT_FONT_WEIGHT = 400;

export const LOGO_TEXT_FONT_OPTIONS = [
  { value: "system-ui, sans-serif", label: "System" },
  { value: "'Inter', sans-serif", label: "Inter" },
  { value: "Georgia, 'Times New Roman', serif", label: "Serif" },
  { value: "'Geist Mono', ui-monospace, monospace", label: "Monospace" },
  { value: "'MontserratThin', sans-serif", label: "Montserrat Thin" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
] as const;

export const LOGO_TEXT_FONT_SIZE_MIN = 8;
export const LOGO_TEXT_FONT_SIZE_MAX = 256;

export function defaultLogoTextLayer(
  canvasWidth: number,
  canvasHeight: number,
  id: string,
): LogoTextLayer {
  return {
    id,
    text: "Text",
    x: canvasWidth * 0.5,
    y: canvasHeight * 0.5,
    fontSize: 48,
    fontFamily: LOGO_TEXT_FONT_OPTIONS[0].value,
    fontWeight: DEFAULT_LOGO_TEXT_FONT_WEIGHT,
    locked: false,
  };
}

export function clampTextLayerPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  pad = 8,
): { x: number; y: number } {
  return {
    x: Math.min(width - pad, Math.max(pad, x)),
    y: Math.min(height - pad, Math.max(pad, y)),
  };
}

export function scaleTextLayersToCanvas(
  layers: LogoTextLayer[],
  sx: number,
  sy: number,
): LogoTextLayer[] {
  const scaleR = Math.min(sx, sy);
  return layers.map((layer) => ({
    ...layer,
    x: layer.x * sx,
    y: layer.y * sy,
    fontSize: layer.fontSize * scaleR,
  }));
}

export function fontOptionLabel(family: string): string {
  return LOGO_TEXT_FONT_OPTIONS.find((o) => o.value === family)?.label ?? family;
}

export function fontWeightOptionLabel(weight: number): string {
  return (
    LOGO_TEXT_FONT_WEIGHT_OPTIONS.find((o) => o.value === weight)?.label ?? String(weight)
  );
}

export function normalizeTextLayer(layer: LogoTextLayer): LogoTextLayer {
  const weight =
    typeof layer.fontWeight === "number" && Number.isFinite(layer.fontWeight)
      ? layer.fontWeight
      : DEFAULT_LOGO_TEXT_FONT_WEIGHT;
  return { ...layer, fontWeight: weight, locked: layer.locked === true };
}
