/* Approved Eigenmesh logo engine — ported one-for-one from ~/+Code/ei/assets/logo.js.
   Six source squares, seven links, three reversible effects (spin, colour-tile gallery,
   whole-logo pixel-dither screen), shuffled as a bag so every effect appears each cycle.
   Hover on the wrapping .brand starts the effect and reverses it on leave; work events
   drive start()/stop() and pulse(ms) exactly like ei's LogoMark. Under reduced motion
   the engine shows the still path and never animates (ei motion-still/motion-live). */

const N = 8;
const f = (n: number): number => +n.toFixed(3);
const squareCorner = (p: Tile): number => Math.min(p[2] * 0.28, 0.14);
const circle = (cx: number, cy: number, r: number): string =>
  `M${f(cx - r)} ${cy}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;

type Tile = [number, number, number, ...boolean[]];
type Glyph = { d: string; rule?: string };
type Shape = Glyph & { id: string; name: string };
type Point = [number, number];

const ALL: Shape[] = [
  { id: 'b-tile', name: 'Square', d: 'M.06 .06H.94V.94H.06Z' },
  { id: 'b-disc', name: 'Circle', d: circle(0.5, 0.5, 0.44) },
  { id: 'b-ring', name: 'Ring', d: circle(0.5, 0.5, 0.42) + circle(0.5, 0.5, 0.24), rule: 'evenodd' },
  { id: 'b-plus', name: 'Plus', d: 'M.4 .08H.6V.4H.92V.6H.6V.92H.4V.6H.08V.4H.4Z' },
  { id: 'b-cross', name: 'Cross', d: 'M.08 .2L.2 .08L.5 .38L.8 .08L.92 .2L.62 .5L.92 .8L.8 .92L.5 .62L.2 .92L.08 .8L.38 .5Z' },
  { id: 'b-diag', name: 'Diagonal', d: 'M.06 .2L.2 .06L.94 .8L.8 .94Z' },
  { id: 'b-h', name: 'Bar', d: 'M.06 .38H.94V.62H.06Z' },
  { id: 'b-v', name: 'Column', d: 'M.38 .06H.62V.94H.38Z' },
  { id: 'b-tri', name: 'Triangle', d: 'M.5 .1L.92 .88H.08Z' },
  { id: 'b-small', name: 'Small square', d: 'M.3 .3H.7V.7H.3Z' },
  { id: 'b-dot', name: 'Dot', d: circle(0.5, 0.5, 0.18) },
];

function logoHexagonTargets(tiles: Tile[]): Point[] {
  // Preserve the clockwise ordering, so the squares keep their identities and
  // the same seven links throughout the move to a regular hexagon.
  const order = tiles
    .map((p, i) => ({ i, angle: Math.atan2(p[1] - N / 2, p[0] - N / 2) }))
    .sort((a, b) => a.angle - b.angle);
  const top = order.reduce((best, p, i) => (tiles[p.i]![1] < tiles[order[best]!.i]![1] ? i : best), 0);
  const targets: Point[] = [];
  for (let k = 0; k < order.length; k++) {
    const angle = -Math.PI / 2 + (k * Math.PI) / 3;
    targets[order[(top + k) % order.length]!.i] = [
      N / 2 + 2.7 * Math.cos(angle),
      N / 2 + 2.7 * Math.sin(angle),
    ];
  }
  return targets;
}

function ditherTilePNG(seed: number, theme: number): string {
  const palettes = [
    ['#210e17', '#d63831', '#ff9971'],
    ['#251713', '#94633b', '#e5b96e'],
    ['#10210d', '#548717', '#c7e456'],
    ['#29150d', '#e96a16', '#ffd35c'],
    ['#101d54', '#2549d9', '#9caeff'],
    ['#152d43', '#76b6df', '#e1f5ff'],
    ['#270e18', '#bd203f', '#ff7663'],
    ['#24220b', '#c6c914', '#fff68a'],
  ];
  const colours = (palettes[theme % 8] ?? palettes[0])!.map((hex) =>
    (hex.match(/\w\w/g) ?? []).map((v) => parseInt(v, 16)),
  );
  // Different pixel scales and subjects, with visibly coarse pixels in every tile.
  const sizes: Point[] = [
    [10, 12],
    [12, 10],
    [8, 12],
    [12, 8],
    [10, 14],
    [8, 10],
    [10, 12],
    [8, 10],
  ];
  const [W, H] = sizes[theme % 8]!;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const pixels = ctx.createImageData(W, H);
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const seeds = Array.from({ length: 12 }, () => [random(), random(), 0.08 + random() * 0.19]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W,
        v = (y + 0.5) / H;
      let tone: number;
      if (theme % 8 === 1) {
        // overlapping pebbles, with a lit edge and dark seams
        const nearest = seeds
          .map(([a, b, r]) => Math.hypot((u - a!) * 0.8, v - b!) / r!)
          .sort((a, b) => a - b);
        tone = 0.25 + Math.max(0, 1 - nearest[0]!) * 0.7 + (nearest[1]! - nearest[0]! > 0.3 ? 0.08 : 0);
      } else if (theme % 8 === 2) {
        // angular leaves against deep green
        tone = 0.13;
        for (const [a, b, r] of seeds) {
          const dx = u - a!,
            dy = v - b!;
          if (Math.abs(dx + dy * 0.6) / r! + Math.abs(dy - dx * 0.4) / (r! * 1.8) < 1)
            tone = Math.max(tone, 0.48 + (dx + dy) / (r! * 6));
        }
      } else if (theme % 8 === 3) {
        // jagged orange mineral planes
        tone = u > v * 0.55 + 0.15 ? 0.78 : 0.12;
        if (u + v > 1.12) tone = 0.4;
        if (u < 0.18 + v * 0.2 && v > 0.35) tone = 0.95;
      } else if (theme % 8 === 4) {
        // blue celestial disc and scattered fragments
        tone = 0.2 + v * 0.16;
        const r = Math.hypot(u - 0.62, v - 0.35);
        if (r < 0.28) tone = 0.88 - r * 0.8;
        if (seeds.some(([a, b]) => Math.abs(u - a!) < 0.035 && Math.abs(v - b!) < 0.035)) tone = 1;
      } else if (theme % 8 === 5) {
        // broad pale cloud clusters
        tone = 0.22 + u * 0.13;
        for (const [a, b, r] of seeds) tone = Math.max(tone, 0.95 - Math.hypot((u - a!) * 0.7, v - b!) / (r! * 3));
      } else {
        // red blooms with dark centers
        tone = 0.13;
        for (const [a, b, r] of seeds.slice(0, 5)) {
          const dx = u - a!,
            dy = v - b!,
            d = Math.hypot(dx, dy),
            petal = r! * (0.85 + 0.22 * Math.cos(Math.atan2(dy, dx) * 5));
          if (d < petal) tone = Math.max(tone, d < r! * 0.24 ? 0.23 : 0.6 + d / r! * 0.23);
        }
      }
      const value = Math.max(0, Math.min(1, tone + (random() - 0.5) * 0.12)) * 2;
      const low = Math.floor(value);
      const threshold = theme % 8 === 3 ? 0.5 : random();
      const colour = colours[Math.min(2, low + (value - low > threshold ? 1 : 0))] ?? colours[0]!;
      pixels.data.set([...colour, 255], (y * W + x) * 4);
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

type LogoScene = {
  tiles: Tile[];
  links: Point[];
  targets: Point[];
  fusion: number;
  glyphs: Glyph[];
}

type LogoMode = 'spin' | 'images' | 'dither';

type LogoHost = {
  _logoCleanup?: () => void;
  dataset: DOMStringMap & { logoState?: string; logoAnimation?: LogoMode };
} & SVGElement

function attachLogoHover(el: LogoHost, scene: LogoScene, { interactive = true } = {}) {
  el._logoCleanup?.();
  try {
    CSS.registerProperty({ name: '--logo-morph', syntax: '<number>', inherits: false, initialValue: '0' });
  } catch {
    /* already registered */
  }
  const nodes = [...el.querySelectorAll<SVGGElement>('.logo-node')];
  const lines = [...el.querySelectorAll<SVGPathElement>('.logo-link')];
  const orbit = el.querySelector<SVGGElement>('.logo-orbit');
  const screen = el.querySelector<SVGGElement>('.logo-dither');
  if (!orbit || !screen) return { start() {}, stop() {}, destroy() {} };
  const D = 8,
    cell = 8 / D,
    screenPaths: SVGPathElement[] = [];
  const screenColours = ['#315e52', '#4c916b', '#69c97c', '#98e384', '#132f40'];
  for (let y = 0; y < D; y++)
    for (let x = 0; x < D; x++) {
      const glyph = scene.glyphs[(x * 17 + y * 31 + ((x * y) % 7)) % scene.glyphs.length]!;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', glyph.d);
      path.setAttribute('fill-rule', glyph.rule || 'nonzero');
      path.setAttribute('fill', screenColours[(x * 13 + y * 7) % screenColours.length]!);
      screen.appendChild(path);
      screenPaths.push(path);
    }
  const drawScreen = (points: Point[], angle: number) => {
    const radians = (-angle * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    const covered = (x: number, y: number) => {
      const dx = x - 4,
        dy = y - 4;
      x = 4 + dx * cos - dy * sin;
      y = 4 + dx * sin + dy * cos;
      if (scene.tiles.some((p, i) => Math.abs(x - points[i]![0]) < p[2] && Math.abs(y - points[i]![1]) < p[2]))
        return true;
      return scene.links.some(([i, j]) => {
        const a = points[i]!,
          b = points[j]!,
          vx = b[0] - a[0],
          vy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy || 1)));
        return Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy) < 0.085 * scene.fusion;
      });
    };
    for (let y = 0; y < D; y++)
      for (let x = 0; x < D; x++) {
        let n = 0;
        for (let sy = 0; sy < 6; sy++)
          for (let sx = 0; sx < 6; sx++) n += covered((x + (sx + 0.5) / 6) * cell, (y + (sy + 0.5) / 6) * cell) ? 1 : 0;
        const path = screenPaths[y * D + x]!,
          size = n ? Math.min(1, 0.35 + Math.sqrt(n / 36) * 0.65) : 0;
        path.style.opacity = n ? '1' : '0';
        path.style.transform = `translate(${(x + 0.5 - size / 2) * cell}px,${(y + 0.5 - size / 2) * cell}px) scale(${cell * size})`;
      }
  };
  const targets = scene.targets;
  // One intentionally irregular composition, reused on every hover and reload.
  // Entries are center x/y and final width/height for the six source masses.
  const gallery: [number, number, number, number][] = [
    [5.25, 6.6, 2.65, 1.1],
    [6.25, 3.1, 1.6, 2.75],
    [4.5, 1.1, 0.95, 1.25],
    [3.55, 4.3, 1.4, 1.65],
    [1.75, 2.2, 2.2, 1.65],
    [0.95, 5.2, 0.7, 1.15],
  ];
  const themes = [3, 4, 6, 1, 2, 5];
  nodes.forEach((node, i) => node.querySelector('image')?.setAttribute('href', ditherTilePNG(4317 + i * 7919, themes[i]!)));
  let mode: LogoMode = 'spin',
    raf = 0,
    disposed = false,
    loopStart = 0,
    currentMorph = 0,
    currentAngle = 0,
    exitPose: { morph: number; angle: number; q: number } | null = null;
  const choices: LogoMode[] = [];
  el.style.setProperty('--logo-morph', '0');
  el.style.transition = '--logo-morph 820ms cubic-bezier(.25,.65,.25,1)';
  const draw = () => {
    if (disposed || !el.isConnected) return;
    const raw = Math.max(0, Math.min(1, parseFloat(getComputedStyle(el).getPropertyValue('--logo-morph')) || 0));
    const q = raw < 0.00001 ? 0 : raw > 0.99999 ? 1 : raw;
    let morph = q,
      angle = mode === 'spin' ? 360 * q : 0;
    if (mode === 'dither') {
      const elapsed = (performance.now() - loopStart) / 1000;
      morph = el.dataset.logoState === 'leaving' ? (exitPose?.morph ?? 0) * (q / (exitPose?.q ?? 1)) : (0.5 - 0.5 * Math.cos((elapsed * Math.PI) / 1.6)) * q;
      angle = el.dataset.logoState === 'leaving' ? (exitPose?.angle ?? 0) * (q / (exitPose?.q ?? 1)) : elapsed * 112.5 * q;
    }
    currentMorph = morph;
    currentAngle = angle;
    const points = scene.tiles.map((p, i) => {
      const destination = mode === 'images' ? gallery[i]! : targets[i]!;
      return [p[0] + (destination[0] - p[0]) * morph, p[1] + (destination[1] - p[1]) * morph] as Point;
    });
    orbit.style.transform = `rotate(${angle}deg)`;
    orbit.style.opacity = mode === 'dither' ? String(1 - q) : '1';
    screen.style.opacity = mode === 'dither' ? String(q) : '0';
    if (mode === 'dither' && q > 0) drawScreen(points, angle);
    nodes.forEach((node, i) => {
      const p = scene.tiles[i]!,
        sx = mode === 'images' ? 1 + (gallery[i]![2] / (p[2] * 2) - 1) * q : 1,
        sy = mode === 'images' ? 1 + (gallery[i]![3] / (p[2] * 2) - 1) * q : 1;
      node.style.transform = `translate(${points[i]![0]}px,${points[i]![1]}px) scale(${sx},${sy})`;
      const image = node.querySelector('image');
      if (image) image.style.opacity = mode === 'images' ? String(q) : '0';
    });
    lines.forEach((line, k) => {
      const [i, j] = scene.links[k]!,
        a = points[i]!,
        b = points[j]!;
      line.style.transform = `translate(${a[0]}px,${a[1]}px) rotate(${(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI}deg) scaleX(${Math.hypot(b[0] - a[0], b[1] - a[1])})`;
    });
    if (q === 1 && el.dataset.logoState === 'entering') el.dataset.logoState = 'active';
    if (
      (el.dataset.logoState === 'entering' && q < 1) ||
      (el.dataset.logoState === 'leaving' && q > 0) ||
      (mode === 'dither' && q > 0 && el.dataset.logoState === 'active')
    )
      raf = requestAnimationFrame(draw);
    else {
      el.dataset.logoState = q > 0.5 ? 'active' : 'idle';
      raf = 0;
    }
  };
  const start = () => {
    if (el.dataset.logoState === 'entering' || el.dataset.logoState === 'active') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const q = parseFloat(getComputedStyle(el).getPropertyValue('--logo-morph')) || 0;
    if (q < 0.00001) {
      // Shuffle all three effects as a bag, so every effect appears each cycle.
      if (!choices.length) {
        choices.push('spin', 'images', 'dither');
        for (let i = choices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [choices[i], choices[j]] = [choices[j]!, choices[i]!];
        }
      }
      mode = choices.pop()!;
      el.dataset.logoAnimation = mode;
      loopStart = performance.now();
    }
    el.dataset.logoState = 'entering';
    el.style.setProperty('--logo-morph', '1');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };
  const stop = () => {
    exitPose = {
      morph: currentMorph,
      angle: currentAngle,
      q: Math.max(0.00001, parseFloat(getComputedStyle(el).getPropertyValue('--logo-morph')) || 0),
    };
    el.dataset.logoState = 'leaving';
    el.style.setProperty('--logo-morph', '0');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };
  el.dataset.logoState = 'idle';
  draw();
  if (interactive) {
    el.addEventListener('mouseenter', start);
    el.addEventListener('mouseleave', stop);
  }
  el._logoCleanup = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    el.removeEventListener('mouseenter', start);
    el.removeEventListener('mouseleave', stop);
  };
  return { start, stop, destroy: () => el._logoCleanup?.() };
}

/* The approved scene: six source squares, seven centre-to-centre links, the still path. */
const SCENE = {
  D: 8,
  fusion: 1,
  links: [[0,1],[0,3],[1,2],[2,4],[3,4],[3,5],[4,5]] as Point[],
  path: "M3.969 0.402L3.938 0.423L3.923 0.438L3.902 0.469L3.892 0.5L3.889 0.531L3.889 1.375L3.886 1.406L3.872 1.438L3.838 1.469L2.531 2.43L2.5 2.444L2.469 2.426L2.438 2.403L2.406 2.392L2.375 2.387L1.438 2.387L1.406 2.389L1.375 2.398L1.344 2.415L1.32 2.438L1.3 2.469L1.29 2.5L1.287 2.531L1.287 3.469L1.29 3.5L1.3 3.531L1.313 3.552L1.344 3.585L1.375 3.602L1.406 3.611L1.438 3.614L1.464 3.625L1.457 3.656L1.194 4.156L1.188 4.166L1.156 4.193L1.125 4.199L0.469 4.2L0.438 4.209L0.418 4.219L0.406 4.226L0.375 4.258L0.362 4.281L0.352 4.313L0.349 4.344L0.35 5.281L0.359 5.313L0.375 5.342L0.406 5.374L0.438 5.391L0.469 5.4L1.406 5.401L1.438 5.398L1.469 5.388L1.5 5.369L1.524 5.344L1.531 5.332L1.541 5.313L1.55 5.281L1.552 4.938L1.563 4.913L1.576 4.906L1.594 4.903L2.063 4.917L2.094 4.927L2.102 4.938L2.106 4.969L2.108 5.375L2.117 5.406L2.135 5.438L2.156 5.46L2.188 5.48L2.219 5.491L2.25 5.494L3.25 5.494L3.281 5.491L3.313 5.48L3.344 5.46L3.375 5.433L3.406 5.435L4.594 6.304L4.603 6.313L4.622 6.344L4.627 6.375L4.628 7.344L4.634 7.375L4.649 7.406L4.676 7.438L4.688 7.447L4.719 7.464L4.75 7.471L4.781 7.472L5.938 7.472L5.969 7.468L6 7.455L6.031 7.431L6.051 7.406L6.066 7.375L6.072 7.344L6.072 7.313L6.072 6.188L6.072 6.156L6.066 6.125L6.051 6.094L6.031 6.069L6 6.045L5.969 6.032L5.938 6.028L5.75 6.026L5.723 6L6.561 3.75L6.581 3.719L6.594 3.709L6.625 3.704L7.313 3.704L7.344 3.7L7.375 3.689L7.406 3.668L7.418 3.656L7.439 3.625L7.45 3.594L7.454 3.563L7.454 2.438L7.45 2.406L7.439 2.375L7.418 2.344L7.406 2.332L7.378 2.313L7.344 2.3L7.313 2.296L6.188 2.296L6.125 2.306L6.094 2.302L6.063 2.277L5.256 1.563L5.228 1.531L5.215 1.5L5.211 1.469L5.211 0.531L5.208 0.5L5.197 0.469L5.177 0.438L5.156 0.418L5.137 0.406L5.125 0.4L5.094 0.391L5.063 0.389L4.031 0.389L4 0.392ZM3.875 1.653L2.563 2.618L2.531 2.647L2.525 2.656L2.514 2.688L2.513 2.719L2.513 3.469L2.51 3.5L2.5 3.531L2.48 3.563L2.442 3.594L2.406 3.608L2.313 3.615L2.292 3.625L2.296 3.656L2.525 4.156L2.545 4.188L2.563 4.2L2.594 4.206L3.25 4.206L3.281 4.209L3.313 4.219L3.344 4.24L3.375 4.277L3.389 4.313L3.394 4.344L3.394 5.156L3.396 5.188L3.406 5.214L3.438 5.247L4.594 6.092L4.625 6.107L4.656 6.083L4.688 6.053L4.719 6.036L4.739 6.031L4.781 6.028L5.469 6.027L5.5 6.026L5.531 6.008L5.551 5.969L6.379 3.75L6.383 3.719L6.375 3.711L6.344 3.704L6.188 3.704L6.156 3.7L6.125 3.689L6.094 3.668L6.082 3.656L6.061 3.625L6.05 3.594L6.046 3.563L6.046 2.563L6.046 2.531L6.039 2.5L6.031 2.486L6.02 2.469L5.987 2.438L5.188 1.729L5.156 1.706L5.125 1.703L5.094 1.709L5.063 1.711L4.031 1.711L4 1.708L3.969 1.697L3.938 1.677L3.906 1.649ZM1.688 3.619L1.656 3.646L1.65 3.656L1.386 4.156L1.381 4.188L1.406 4.197L1.438 4.202L1.469 4.212L1.482 4.219L1.5 4.231L1.519 4.25L1.538 4.281L1.548 4.313L1.551 4.344L1.551 4.688L1.559 4.719L1.563 4.722L1.594 4.732L2.063 4.745L2.094 4.736L2.104 4.719L2.106 4.688L2.106 4.344L2.111 4.313L2.123 4.281L2.145 4.25L2.188 4.219L2.219 4.209L2.313 4.205L2.344 4.193L2.347 4.188L2.337 4.156L2.122 3.688L2.094 3.634L2.063 3.615L2.031 3.613L1.719 3.613Z",
  tiles: [
    [5.35, 6.75, 0.7224999999999999],
    [6.75, 3, 0.7036447429656982],
    [4.55, 1.05, 0.6611447429656983],
    [2.75, 4.85, 0.6435406827926635],
    [1.9, 3, 0.6126040601730347],
    [0.95, 4.8, 0.6010406827926635],
  ] as Tile[],
};

let nextId = 0;

export class LogoMark {
  private svg: LogoHost;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private working = false;
  private hovered = false;
  readonly controller: { start(): void; stop(): void; destroy(): void };

  constructor(svg: LogoHost) {
    this.svg = svg;
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.innerHTML = this.buildMarkup();
    const glyphs: Glyph[] = ALL.filter((s) =>
      ['b-tile', 'b-disc', 'b-ring', 'b-plus', 'b-small', 'b-dot'].includes(s.id ?? ''),
    ).map(({ d, rule }) => ({ d: d!, rule }));
    glyphs.push(
      { d: 'M.12 .08H.25V.92H.12ZM.43 .08H.56V.92H.43ZM.74 .08H.87V.92H.74Z' },
      {
        d:
          circle(0.27, 0.27, 0.14) +
          circle(0.73, 0.27, 0.14) +
          circle(0.27, 0.73, 0.14) +
          circle(0.73, 0.73, 0.14),
      },
    );
    this.controller = attachLogoHover(
      svg,
      { ...SCENE, targets: logoHexagonTargets(SCENE.tiles), glyphs },
      { interactive: false },
    );
    const target = svg.closest('.brand') ?? svg;
    target.addEventListener('mouseenter', () => {
      this.hovered = true;
      this.controller.start();
    });
    target.addEventListener('mouseleave', () => {
      this.hovered = false;
      if (!this.working) this.controller.stop();
    });
  }

  /* ei movingLogo(): the live orbit (links + squares + hidden dither images + screen),
     plus the reduced-motion still path; the standalone-file <script> is not needed here. */
  private buildMarkup(): string {
    const ink = 'currentColor';
    const ids = `app-logo-${nextId++}`;
    const lines = SCENE.links
      .map(
        () =>
          `<path class="logo-link" d="M0 0H1" fill="none" stroke="${ink}" stroke-width="${f(0.17 * SCENE.fusion)}"/>`,
      )
      .join('');
    const squares = SCENE.tiles
      .map((p, i) => {
        const r = p[2],
          corner = squareCorner(p),
          clip = `${ids}-tile-${i}`;
        return `<g class="logo-node"><defs><clipPath id="${clip}"><rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${corner}"/></clipPath></defs><rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${corner}" fill="${ink}"/><image x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" style="opacity:0;image-rendering:pixelated"/></g>`;
      })
      .join('');
    return `<style>.motion-still{display:none}.logo-orbit{transform-origin:4px 4px}.logo-node,.logo-link{transform-origin:0 0}.logo-node image{image-rendering:pixelated}@media(prefers-reduced-motion:reduce){.motion-live{display:none}.motion-still{display:inline}}</style><path class="motion-still" d="${SCENE.path}" fill="${ink}" fill-rule="evenodd"/><g class="motion-live"><g class="logo-orbit">${lines}<g>${squares}</g></g><g class="logo-dither" style="opacity:0;pointer-events:none"/></g>`;
  }

  start(): void {
    clearTimeout(this.timer);
    this.working = true;
    this.svg.classList.add('is-working');
    this.controller.start();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.working = false;
    this.svg.classList.remove('is-working');
    if (!this.hovered) this.controller.stop();
  }

  pulse(ms = 1200): void {
    this.start();
    this.timer = setTimeout(() => this.stop(), Math.max(ms, 1100));
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.svg._logoCleanup?.();
  }
}
