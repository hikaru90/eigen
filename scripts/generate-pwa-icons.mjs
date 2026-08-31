/**
 * Derives favicon PNG/ICO, apple-touch, PWA, and notification icons from
 * static/favicon.svg (source of truth).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'static')
const faviconDir = join(__dirname, '..', 'src/lib/assets')

/** DESIGN.md / layout.css light `--background` */
const BG_LIGHT = '#e8ede5'
/** layout.css `.dark` `--background` */
const BG_DARK = '#141c16'
const MARK_LIGHT = '#111111'
const MARK_DARK = '#f5f7f4'

/**
 * @param {string} svg
 * @param {{ bg: string; mark: string }} colors
 */
function recolorSvg(svg, colors) {
  return svg
    .replace(/#e8ede5/gi, colors.bg)
    .replace(/style="fill-rule:nonzero;"/g, `style="fill:${colors.mark};fill-rule:nonzero;"`)
}

/**
 * Mark-only SVG (no tile background) for transparent / badge uses.
 * @param {string} svg
 * @param {string} markFill
 */
function markOnlySvg(svg, markFill) {
  return svg
    .replace(
      /<path d="M160,36l0,88c0,19\.869[^"]*" style="fill:[^"]*;"\/>/,
      '',
    )
    .replace(/style="fill-rule:nonzero;"/g, `style="fill:${markFill};fill-rule:nonzero;"`)
    .replace(/style="fill:[^"]*;fill-rule:nonzero;"/g, `style="fill:${markFill};fill-rule:nonzero;"`)
}

/**
 * @param {string} svg
 * @param {number} size
 * @param {{ flatten?: string } | undefined} opts
 */
async function rasterize(svg, size, opts = {}) {
  let pipeline = sharp(Buffer.from(svg)).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  if (opts.flatten) {
    pipeline = pipeline.flatten({ background: opts.flatten })
  }
  return pipeline.png().toBuffer()
}

/**
 * Multi-size ICO with embedded PNG images (Vista+ format).
 * @param {Array<{ size: number; png: Buffer }>} entries
 */
function encodeIco(entries) {
  const count = entries.length
  const headerSize = 6
  const dirEntrySize = 16
  const dirSize = headerSize + dirEntrySize * count
  let offset = dirSize
  const withOffsets = entries.map((entry) => {
    const record = { ...entry, offset }
    offset += entry.png.length
    return record
  })

  const out = Buffer.alloc(offset)
  out.writeUInt16LE(0, 0) // reserved
  out.writeUInt16LE(1, 2) // type = icon
  out.writeUInt16LE(count, 4)

  withOffsets.forEach((entry, i) => {
    const base = headerSize + i * dirEntrySize
    out.writeUInt8(entry.size >= 256 ? 0 : entry.size, base) // width
    out.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1) // height
    out.writeUInt8(0, base + 2) // color palette
    out.writeUInt8(0, base + 3) // reserved
    out.writeUInt16LE(1, base + 4) // color planes
    out.writeUInt16LE(32, base + 6) // bits per pixel
    out.writeUInt32LE(entry.png.length, base + 8)
    out.writeUInt32LE(entry.offset, base + 12)
    entry.png.copy(out, entry.offset)
  })
  return out
}

mkdirSync(outDir, { recursive: true })
mkdirSync(faviconDir, { recursive: true })

const svgLight = readFileSync(join(outDir, 'favicon.svg'), 'utf8')
if (!svgLight.includes('<svg') || !svgLight.includes('#e8ede5')) {
  throw new Error('static/favicon.svg must include an <svg> root and light tile fill #e8ede5')
}

const svgDark = recolorSvg(svgLight, { bg: BG_DARK, mark: MARK_DARK })
const svgMarkBlack = markOnlySvg(svgLight, MARK_LIGHT)
const svgMarkWhite = markOnlySvg(svgLight, '#ffffff')

const [
  favicon16,
  favicon32,
  favicon48,
  faviconPng,
  faviconTransparent,
  appleLight,
  appleDark,
  pwa192,
  pwa512,
  pwaMaskable,
  notificationIcon,
  notificationBadge,
] = await Promise.all([
  rasterize(svgLight, 16),
  rasterize(svgLight, 32),
  rasterize(svgLight, 48),
  rasterize(svgLight, 32),
  rasterize(svgMarkBlack, 32),
  rasterize(svgLight, 180, { flatten: BG_LIGHT }),
  rasterize(svgDark, 180, { flatten: BG_DARK }),
  rasterize(svgLight, 192, { flatten: BG_LIGHT }),
  rasterize(svgLight, 512, { flatten: BG_LIGHT }),
  // Maskable: full-bleed opaque tile (safe zone already in SVG mark padding)
  rasterize(svgLight, 512, { flatten: BG_LIGHT }),
  rasterize(svgDark, 192, { flatten: BG_DARK }),
  rasterize(svgMarkWhite, 96),
])

writeFileSync(join(outDir, 'favicon.png'), faviconPng)
writeFileSync(join(faviconDir, 'favicon.png'), faviconPng)
writeFileSync(join(outDir, 'favicon-transparent.png'), faviconTransparent)
writeFileSync(
  join(outDir, 'favicon.ico'),
  encodeIco([
    { size: 16, png: favicon16 },
    { size: 32, png: favicon32 },
    { size: 48, png: favicon48 },
  ]),
)
writeFileSync(join(outDir, 'apple-touch-icon.png'), appleLight)
writeFileSync(join(outDir, 'apple-touch-icon-dark.png'), appleDark)
writeFileSync(join(outDir, 'pwa-192.png'), pwa192)
writeFileSync(join(outDir, 'pwa-512.png'), pwa512)
writeFileSync(join(outDir, 'pwa-512-maskable.png'), pwaMaskable)
writeFileSync(join(outDir, 'notification-icon.png'), notificationIcon)
writeFileSync(join(outDir, 'notification-badge.png'), notificationBadge)

console.log(
  'Wrote favicon / PWA / notification assets from static/favicon.svg → static/ (+ src/lib/assets/favicon.png)',
)
