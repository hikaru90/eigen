import type { Metaball } from "./metaball-gl";

export type BallLinkSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  distance: number;
  /** SVG stroke width (CSS px, non-scaling). */
  strokeWidth: number;
  strokeOpacity: number;
  /** Metaball tube radius along the segment (canvas px). */
  tubeRadius: number;
};

export type BallLinkTopology = "nearest" | "all-pairs";

export type BallLinkStyleOptions = {
  canvasWidth: number;
  canvasHeight: number;
  /** `nearest`: each ball links to k closest others; `all-pairs`: every pair (dense hub). */
  topology: BallLinkTopology;
  /** Used when topology is `nearest` (1 = single closest neighbor per ball). */
  neighborsPerBall: number;
  /**
   * Max center-to-center distance for a link, as a multiple of the canvas reference distance.
   * `0` = no limit (always connect to the k nearest neighbors).
   */
  maxLinkDistance: number;
  /** 0 = uniform width; 1 = far pairs much thinner. */
  distanceThinning: number;
  minStrokeWidth: number;
  maxStrokeWidth: number;
  baseStrokeOpacity: number;
  /** Scales tube radius for shader bridges (0 = no bridges). */
  bridgeStrength: number;
  bridgeThinning: number;
};

const MAX_SHADER_LINKS = 384;

function canvasRefDistance(width: number, height: number): number {
  return Math.hypot(width, height) * 0.35;
}

function maxLinkDistancePx(options: BallLinkStyleOptions, refDist: number): number {
  if (options.maxLinkDistance <= 0) return Infinity;
  return options.maxLinkDistance * refDist;
}

function strokeStyleForDistance(
  distance: number,
  refDist: number,
  thinning: number,
  minW: number,
  maxW: number,
  baseOpacity: number,
): { strokeWidth: number; strokeOpacity: number } {
  const t = Math.min(1, Math.max(0, distance / refDist));
  const thin = Math.pow(t, Math.max(0.15, thinning));
  const strokeWidth = maxW - thin * (maxW - minW);
  const strokeOpacity = baseOpacity * (0.55 + 0.45 * thin);
  return { strokeWidth, strokeOpacity };
}

function tubeRadiusForLink(
  ballA: Metaball,
  ballB: Metaball,
  distance: number,
  refDist: number,
  bridgeThinning: number,
  bridgeStrength: number,
): number {
  if (bridgeStrength <= 0) return 0;
  const avgR = (ballA.r + ballB.r) * 0.5;
  const thin = Math.pow(refDist / Math.max(distance, refDist * 0.2), bridgeThinning);
  return avgR * 0.42 * thin * bridgeStrength;
}

function pushSegment(
  segments: BallLinkSegment[],
  a: Metaball,
  b: Metaball,
  refDist: number,
  options: BallLinkStyleOptions,
) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const { strokeWidth, strokeOpacity } = strokeStyleForDistance(
    distance,
    refDist,
    options.distanceThinning,
    options.minStrokeWidth,
    options.maxStrokeWidth,
    options.baseStrokeOpacity,
  );
  const tubeRadius = tubeRadiusForLink(
    a,
    b,
    distance,
    refDist,
    options.bridgeThinning,
    options.bridgeStrength,
  );
  segments.push({
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    distance,
    strokeWidth,
    strokeOpacity,
    tubeRadius,
  });
}

function computeAllPairLinks(balls: Metaball[], options: BallLinkStyleOptions): BallLinkSegment[] {
  const refDist = canvasRefDistance(options.canvasWidth, options.canvasHeight);
  const maxDist = maxLinkDistancePx(options, refDist);
  const segments: BallLinkSegment[] = [];
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const distance = Math.hypot(balls[j].x - balls[i].x, balls[j].y - balls[i].y);
      if (distance > maxDist) continue;
      pushSegment(segments, balls[i], balls[j], refDist, options);
    }
  }
  return segments;
}

/** Each ball connects to its k nearest neighbors (deduped undirected edges). */
function computeNearestNeighborLinks(
  balls: Metaball[],
  options: BallLinkStyleOptions,
): BallLinkSegment[] {
  const refDist = canvasRefDistance(options.canvasWidth, options.canvasHeight);
  const maxDist = maxLinkDistancePx(options, refDist);
  const k = Math.max(1, Math.min(balls.length - 1, Math.floor(options.neighborsPerBall)));
  const seen = new Set<string>();
  const segments: BallLinkSegment[] = [];

  for (let i = 0; i < balls.length; i++) {
    const neighbors: { j: number; distance: number }[] = [];
    for (let j = 0; j < balls.length; j++) {
      if (i === j) continue;
      neighbors.push({
        j,
        distance: Math.hypot(balls[j].x - balls[i].x, balls[j].y - balls[i].y),
      });
    }
    neighbors.sort((a, b) => a.distance - b.distance);

    for (const { j, distance } of neighbors.slice(0, k)) {
      if (distance > maxDist) continue;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pushSegment(segments, balls[lo], balls[hi], refDist, options);
    }
  }

  return segments;
}

export function computeBallLinks(
  balls: Metaball[],
  options: BallLinkStyleOptions,
): BallLinkSegment[] {
  if (balls.length < 2) return [];
  if (options.topology === "all-pairs") {
    return computeAllPairLinks(balls, options);
  }
  return computeNearestNeighborLinks(balls, options);
}

/** Links sent to the shader (capped; prefers longer segments for thin far bridges). */
export function linksForShader(
  segments: BallLinkSegment[],
  maxLinks = MAX_SHADER_LINKS,
): BallLinkSegment[] {
  if (segments.length <= maxLinks) return segments;
  return [...segments]
    .sort((a, b) => b.distance - a.distance)
    .slice(0, maxLinks);
}

export const SHADER_MAX_BALL_LINKS = MAX_SHADER_LINKS;
