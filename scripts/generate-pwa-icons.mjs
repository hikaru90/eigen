/**
 * Generates minimal solid-color PNG icons for the PWA manifest (no external deps).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'static');

/** @param {number} size */
function pngSolid(size, r, g, b) {
	const row = Buffer.alloc(1 + size * 3);
	row[0] = 0;
	for (let x = 0; x < size; x++) {
		const i = 1 + x * 3;
		row[i] = r;
		row[i + 1] = g;
		row[i + 2] = b;
	}
	const raw = Buffer.alloc((1 + size * 3) * size);
	for (let y = 0; y < size; y++) raw.set(row, y * row.length);
	const compressed = deflateSync(raw);

	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length, 0);
		const t = Buffer.from(type);
		const crcBuf = Buffer.concat([t, data]);
		const crc = crc32(crcBuf);
		const crcOut = Buffer.alloc(4);
		crcOut.writeUInt32BE(crc >>> 0, 0);
		return Buffer.concat([len, t, data, crcOut]);
	};

	const ihdrChunk = chunk('IHDR', ihdr);
	const idatChunk = chunk('IDAT', compressed);
	const iendChunk = chunk('IEND', Buffer.alloc(0));
	return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
	}
	return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(outDir, { recursive: true });
const brand = [255, 62, 0];
for (const size of [180, 192, 512]) {
	const name = size === 180 ? 'apple-touch-icon.png' : `pwa-${size}.png`;
	writeFileSync(join(outDir, name), pngSolid(size, ...brand));
}
console.log('Wrote PWA icons to static/');
