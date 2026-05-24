/** Tunable metaball field uniforms (shader + UI). */
export type MetaballFieldParams = {
  /** Iso-surface level; lower = larger merged blobs. */
  threshold: number;
  /** Scales field strength — higher pulls blobs together more (attraction). */
  fieldStrength: number;
  /** Distance falloff power (2 ≈ inverse-square). */
  falloffExponent: number;
  /** Minimum center distance (px) before field applies; avoids singularities. */
  minDistance: number;
  /** Procedural noise mask: outer radius × ball radius. */
  noiseMaskOuter: number;
  /** Procedural noise mask: inner radius × ball radius. */
  noiseMaskInner: number;
  /** Metaball tube bridges along ball pairs (0 = off). */
  bridgeStrength: number;
  /** Higher = thinner bridges for farther pairs. */
  bridgeThinning: number;
};

export const DEFAULT_METABALL_FIELD_PARAMS: MetaballFieldParams = {
  threshold: 1,
  fieldStrength: 1,
  falloffExponent: 2,
  minDistance: 0.5,
  noiseMaskOuter: 2.85,
  noiseMaskInner: 0.35,
  bridgeStrength: 0,
  bridgeThinning: 0.75,
};

export const METABALL_FIELD_SLIDER = {
  threshold: { min: 0.15, max: 4, step: 0.05 },
  fieldStrength: { min: 0.1, max: 3, step: 0.05 },
  falloffExponent: { min: 1, max: 4, step: 0.1 },
  minDistance: { min: 0.2, max: 2, step: 0.05 },
  noiseMaskOuter: { min: 1, max: 6, step: 0.05 },
  noiseMaskInner: { min: 0.1, max: 1.5, step: 0.05 },
  bridgeStrength: { min: 0, max: 1, step: 0.02 },
  bridgeThinning: { min: 0, max: 1.5, step: 0.05 },
  linkDistanceThinning: { min: 0, max: 1.5, step: 0.05 },
  /** 0 = unlimited; otherwise max link length × canvas reference distance. */
  linkMaxDistance: { min: 0, max: 2, step: 0.05 },
} as const;

export function fieldParamsFromPartial(
  partial?: Partial<MetaballFieldParams>,
): MetaballFieldParams {
  const d = DEFAULT_METABALL_FIELD_PARAMS;
  if (!partial) return { ...d };
  return {
    threshold: partial.threshold ?? d.threshold,
    fieldStrength: partial.fieldStrength ?? d.fieldStrength,
    falloffExponent: partial.falloffExponent ?? d.falloffExponent,
    minDistance: partial.minDistance ?? d.minDistance,
    noiseMaskOuter: partial.noiseMaskOuter ?? d.noiseMaskOuter,
    noiseMaskInner: partial.noiseMaskInner ?? d.noiseMaskInner,
    bridgeStrength: partial.bridgeStrength ?? d.bridgeStrength,
    bridgeThinning: partial.bridgeThinning ?? d.bridgeThinning,
  };
}
