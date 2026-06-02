export type Metaball = { x: number; y: number; r: number };

import type { BallLinkSegment } from "./ball-links";
import { SHADER_MAX_BALL_LINKS } from "./ball-links";
import type { MetaballFieldParams } from "./metaball-params";

export type MetaballNoise = { amount: number; seed: number };

/** Normalized RGB (0–1) for metaball fill. */
export type MetaballFillColor = readonly [r: number, g: number, b: number];

export const DEFAULT_METABALL_FILL_COLOR: MetaballFillColor = [0, 0, 0];

/** Brand accent — see DESIGN.md */
export const EIGEN_ACCENT_HEX = "#28F97F";

export function metaballColorFromHex(hex: string): MetaballFillColor {
  const normalized = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid metaball color hex: ${hex}`);
  }
  const n = Number.parseInt(normalized, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as MetaballFillColor;
}

export const EIGEN_ACCENT_METABALL_COLOR = metaballColorFromHex(EIGEN_ACCENT_HEX);

const MAX_BALLS = 128;
const MAX_LINKS = SHADER_MAX_BALL_LINKS;

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform int u_ballCount;
uniform vec3 u_balls[${MAX_BALLS}];
uniform float u_threshold;
uniform float u_fieldStrength;
uniform float u_falloffExponent;
uniform float u_minDistanceSq;
uniform float u_noiseMaskOuter;
uniform float u_noiseMaskInner;
uniform float u_noiseAmount;
uniform float u_noiseSeed;
uniform int u_linkCount;
uniform vec4 u_links[${MAX_LINKS}];
uniform float u_linkTubeR[${MAX_LINKS}];
uniform vec3 u_fillColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float cellNoiseMetaball(vec2 px, vec2 cell) {
  float selector = hash21(cell + u_noiseSeed);
  if (selector > 0.72) return 0.0;

  vec2 center = vec2(
    hash21(cell + u_noiseSeed + 1.7),
    hash21(cell + u_noiseSeed + 2.9)
  ) * 8.0;
  float r = 1.5 + 5.5 * hash21(cell + u_noiseSeed + 4.1);
  vec2 d = px - (cell * 8.0 + center);
  float d2 = dot(d, d);
  if (d2 < 0.25) return 0.0;
  return (r * r) / d2;
}

float noiseMaskAroundBalls(vec2 px) {
  float mask = 0.0;
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    if (i >= u_ballCount) break;
    vec3 b = u_balls[i];
    float dist = length(px - b.xy);
    float outer = b.z * u_noiseMaskOuter;
    float inner = b.z * u_noiseMaskInner;
    mask = max(mask, 1.0 - smoothstep(inner, outer, dist));
  }
  return mask;
}

float proceduralNoiseField(vec2 px) {
  if (u_noiseAmount <= 0.0) return 0.0;

  float mask = noiseMaskAroundBalls(px);
  if (mask <= 0.001) return 0.0;

  float field = 0.0;
  vec2 origin = floor(px / 8.0);

  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cell = origin + vec2(float(ox), float(oy));
      field += cellNoiseMetaball(px, cell);
    }
  }

  return field * u_noiseAmount * mask;
}

float metaballContribution(float dist, float radius) {
  if (dist * dist <= u_minDistanceSq) return 0.0;
  return u_fieldStrength * (radius * radius) / pow(dist, u_falloffExponent);
}

float clickMetaballField(vec2 px) {
  float field = 0.0;
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    if (i >= u_ballCount) break;
    vec3 b = u_balls[i];
    float dist = length(px - b.xy);
    field += metaballContribution(dist, b.z);
  }
  return field;
}

float segmentLinkField(vec2 px, vec2 a, vec2 b, float tubeR) {
  if (tubeR <= 0.0) return 0.0;
  vec2 ab = b - a;
  float len2 = dot(ab, ab);
  if (len2 < 1.0) return 0.0;
  vec2 ap = px - a;
  float t = clamp(dot(ap, ab) / len2, 0.0, 1.0);
  vec2 closest = a + ab * t;
  float dist = length(px - closest);
  return metaballContribution(dist, tubeR);
}

float linkFields(vec2 px) {
  float field = 0.0;
  for (int i = 0; i < ${MAX_LINKS}; i++) {
    if (i >= u_linkCount) break;
    vec4 seg = u_links[i];
    field += segmentLinkField(px, seg.xy, seg.zw, u_linkTubeR[i]);
  }
  return field;
}

void main() {
  vec2 px = v_uv * u_resolution;
  px.y = u_resolution.y - px.y;

  float field = clickMetaballField(px) + linkFields(px) + proceduralNoiseField(px);
  float alpha = step(u_threshold, field);
  fragColor = vec4(u_fillColor, alpha);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown";
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

export type MetaballRenderer = {
  draw: (
    balls: Metaball[],
    noise: MetaballNoise,
    field: MetaballFieldParams,
    links: BallLinkSegment[],
    fillColor?: MetaballFillColor,
  ) => void;
  dispose: () => void;
};

export function createMetaballRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): MetaballRenderer {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
  if (!gl) throw new Error("WebGL2 is required for the logo metaball canvas");

  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);

  const program = createProgram(gl);
  gl.useProgram(program);

  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, "u_resolution");
  const uBallCount = gl.getUniformLocation(program, "u_ballCount");
  const uBalls = gl.getUniformLocation(program, "u_balls[0]");
  const uThreshold = gl.getUniformLocation(program, "u_threshold");
  const uFieldStrength = gl.getUniformLocation(program, "u_fieldStrength");
  const uFalloffExponent = gl.getUniformLocation(program, "u_falloffExponent");
  const uMinDistanceSq = gl.getUniformLocation(program, "u_minDistanceSq");
  const uNoiseMaskOuter = gl.getUniformLocation(program, "u_noiseMaskOuter");
  const uNoiseMaskInner = gl.getUniformLocation(program, "u_noiseMaskInner");
  const uNoiseAmount = gl.getUniformLocation(program, "u_noiseAmount");
  const uNoiseSeed = gl.getUniformLocation(program, "u_noiseSeed");
  const uLinkCount = gl.getUniformLocation(program, "u_linkCount");
  const uLinks = gl.getUniformLocation(program, "u_links[0]");
  const uLinkTubeR = gl.getUniformLocation(program, "u_linkTubeR[0]");
  const uFillColor = gl.getUniformLocation(program, "u_fillColor");

  const ballBuffer = new Float32Array(MAX_BALLS * 3);
  const linkBuffer = new Float32Array(MAX_LINKS * 4);
  const linkTubeBuffer = new Float32Array(MAX_LINKS);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  return {
    draw(balls, noise, field, links, fillColor = DEFAULT_METABALL_FILL_COLOR) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const count = Math.min(balls.length, MAX_BALLS);
      for (let i = 0; i < count; i++) {
        ballBuffer[i * 3] = balls[i].x;
        ballBuffer[i * 3 + 1] = balls[i].y;
        ballBuffer[i * 3 + 2] = balls[i].r;
      }

      gl.uniform2f(uResolution, width, height);
      gl.uniform1i(uBallCount, count);
      if (uBalls) gl.uniform3fv(uBalls, ballBuffer);
      gl.uniform1f(uThreshold, field.threshold);
      gl.uniform1f(uFieldStrength, field.fieldStrength);
      gl.uniform1f(uFalloffExponent, field.falloffExponent);
      gl.uniform1f(uMinDistanceSq, field.minDistance * field.minDistance);
      gl.uniform1f(uNoiseMaskOuter, field.noiseMaskOuter);
      gl.uniform1f(uNoiseMaskInner, field.noiseMaskInner);
      gl.uniform1f(uNoiseAmount, noise.amount);
      gl.uniform1f(uNoiseSeed, noise.seed);
      gl.uniform3f(uFillColor, fillColor[0], fillColor[1], fillColor[2]);

      const linkCount = Math.min(links.length, MAX_LINKS);
      for (let i = 0; i < linkCount; i++) {
        const L = links[i];
        linkBuffer[i * 4] = L.x1;
        linkBuffer[i * 4 + 1] = L.y1;
        linkBuffer[i * 4 + 2] = L.x2;
        linkBuffer[i * 4 + 3] = L.y2;
        linkTubeBuffer[i] = L.tubeRadius;
      }
      gl.uniform1i(uLinkCount, linkCount);
      if (uLinks) gl.uniform4fv(uLinks, linkBuffer);
      if (uLinkTubeR) gl.uniform1fv(uLinkTubeR, linkTubeBuffer);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

export const METABALL_MAX_CLICK_BALLS = MAX_BALLS;
