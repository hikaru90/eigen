/**
 * Composites Eigen mark PNGs onto app background colors for PWA / home-screen icons.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'static');
const assetsDir = join(__dirname, '..', 'src/lib/assets/images');

/** DESIGN.md / layout.css light `--background` */
const BG_LIGHT = { r: 0xe8, g: 0xed, b: 0xe5 };
/** @param {PNG} source @param {number} sx @param {number} sy */
function sampleBilinear(source, sx, sy) {
	const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sx)));
	const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sy)));
	const x1 = Math.min(source.width - 1, x0 + 1);
	const y1 = Math.min(source.height - 1, y0 + 1);
	const tx = sx - x0;
	const ty = sy - y0;

	const px = (x, y) => {
		const i = (source.width * y + x) << 2;
		return [source.data[i], source.data[i + 1], source.data[i + 2], source.data[i + 3]];
	};

	const c00 = px(x0, y0);
	const c10 = px(x1, y0);
	const c01 = px(x0, y1);
	const c11 = px(x1, y1);
	const out = [0, 0, 0, 0];
	for (let c = 0; c < 4; c++) {
		const top = c00[c] * (1 - tx) + c10[c] * tx;
		const bot = c01[c] * (1 - tx) + c11[c] * tx;
		out[c] = top * (1 - ty) + bot * ty;
	}
	return out;
}

/**
 * @param {number} size
 * @param {PNG} source
 * @param {{ r: number; g: number; b: number }} bg
 * @param {number} iconScale fraction of canvas used for icon bounding box
 */
function compositeIcon(size, source, bg, iconScale) {
	const out = new PNG({ width: size, height: size, fill: true });
	out.data.fill(0);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const idx = (size * y + x) << 2;
			out.data[idx] = bg.r;
			out.data[idx + 1] = bg.g;
			out.data[idx + 2] = bg.b;
			out.data[idx + 3] = 255;
		}
	}

	const iconSize = Math.round(size * iconScale);
	const aspect = source.width / source.height;
	let w = iconSize;
	let h = Math.round(iconSize / aspect);
	if (h > iconSize) {
		h = iconSize;
		w = Math.round(iconSize * aspect);
	}
	const offsetX = Math.round((size - w) / 2);
	const offsetY = Math.round((size - h) / 2);

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const sx = ((x + 0.5) / w) * source.width - 0.5;
			const sy = ((y + 0.5) / h) * source.height - 0.5;
			const [sr, sg, sb, sa] = sampleBilinear(source, sx, sy);
			const ox = offsetX + x;
			const oy = offsetY + y;
			if (ox < 0 || oy < 0 || ox >= size || oy >= size) continue;
			const idx = (size * oy + ox) << 2;
			const a = sa / 255;
			out.data[idx] = Math.round(sr * a + out.data[idx] * (1 - a));
			out.data[idx + 1] = Math.round(sg * a + out.data[idx + 1] * (1 - a));
			out.data[idx + 2] = Math.round(sb * a + out.data[idx + 2] * (1 - a));
			out.data[idx + 3] = 255;
		}
	}
	return PNG.sync.write(out);
}

mkdirSync(outDir, { recursive: true });

const iconLight = PNG.sync.read(readFileSync(join(assetsDir, 'icon.png')));
const iconDark = PNG.sync.read(readFileSync(join(assetsDir, 'icon-dark.png')));

/** layout.css `.dark` `--background` (oklch(0.141 0.005 285.823)) */
const BG_DARK = { r: 0x1c, g: 0x1c, b: 0x1f };

/** Standard launcher icon — mark ~52% of canvas */
const standardScale = 0.52;
/** Maskable safe zone — mark ~40% of canvas */
const maskableScale = 0.4;

writeFileSync(
	join(outDir, 'apple-touch-icon.png'),
	compositeIcon(180, iconLight, BG_LIGHT, standardScale)
);
writeFileSync(
	join(outDir, 'apple-touch-icon-dark.png'),
	compositeIcon(180, iconDark, BG_DARK, standardScale)
);
writeFileSync(
	join(outDir, 'pwa-192.png'),
	compositeIcon(192, iconLight, BG_LIGHT, standardScale)
);
writeFileSync(
	join(outDir, 'pwa-512.png'),
	compositeIcon(512, iconLight, BG_LIGHT, standardScale)
);
writeFileSync(
	join(outDir, 'pwa-512-maskable.png'),
	compositeIcon(512, iconLight, BG_LIGHT, maskableScale)
);
console.log('Wrote PWA icons to static/');
