/** Non-interactive home-screen app icon preview mask over the logo canvas. */
export type LogoAppIconOverlay = {
  enabled: boolean;
  /** Canvas-space center of the icon square. */
  x: number;
  y: number;
  /** Square side length in canvas pixels. */
  size: number;
  /** Corner radius as a fraction of `size` (0–0.5). */
  cornerRadiusRatio: number;
};

/** Approximate iOS rounded-rect icon corner proportion. */
export const DEFAULT_APP_ICON_CORNER_RATIO = 0.2237;

export const APP_ICON_SIZE_MIN = 48;
export const APP_ICON_CORNER_RATIO_MIN = 0.08;
export const APP_ICON_CORNER_RATIO_MAX = 0.5;

export function defaultAppIconOverlay(
  canvasWidth: number,
  canvasHeight: number,
): LogoAppIconOverlay {
  const ref = Math.min(canvasWidth, canvasHeight);
  return {
    enabled: false,
    x: canvasWidth * 0.5,
    y: canvasHeight * 0.5,
    size: Math.max(APP_ICON_SIZE_MIN, ref * 0.34),
    cornerRadiusRatio: DEFAULT_APP_ICON_CORNER_RATIO,
  };
}

export function maxAppIconSize(canvasWidth: number, canvasHeight: number): number {
  return Math.max(APP_ICON_SIZE_MIN, Math.min(canvasWidth, canvasHeight) * 0.9);
}

export function appIconBounds(overlay: LogoAppIconOverlay): {
  left: number;
  top: number;
  size: number;
  rx: number;
} {
  const size = Math.max(APP_ICON_SIZE_MIN, overlay.size);
  const ratio = Math.min(
    APP_ICON_CORNER_RATIO_MAX,
    Math.max(APP_ICON_CORNER_RATIO_MIN, overlay.cornerRadiusRatio),
  );
  return {
    left: overlay.x - size * 0.5,
    top: overlay.y - size * 0.5,
    size,
    rx: size * ratio,
  };
}

export function scaleAppIconOverlayToCanvas(
  overlay: LogoAppIconOverlay,
  sx: number,
  sy: number,
): LogoAppIconOverlay {
  const scaleR = Math.min(sx, sy);
  return {
    ...overlay,
    x: overlay.x * sx,
    y: overlay.y * sy,
    size: overlay.size * scaleR,
  };
}

export function normalizeAppIconOverlay(
  overlay: LogoAppIconOverlay,
  canvasWidth: number,
  canvasHeight: number,
): LogoAppIconOverlay {
  const maxSize = maxAppIconSize(canvasWidth, canvasHeight);
  const size = Math.min(maxSize, Math.max(APP_ICON_SIZE_MIN, overlay.size));
  const ratio = Math.min(
    APP_ICON_CORNER_RATIO_MAX,
    Math.max(APP_ICON_CORNER_RATIO_MIN, overlay.cornerRadiusRatio),
  );
  return {
    enabled: overlay.enabled === true,
    x: overlay.x,
    y: overlay.y,
    size,
    cornerRadiusRatio: ratio,
  };
}
