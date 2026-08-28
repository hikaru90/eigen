import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const staticDir = path.resolve(here, '../../../static')

describe('favicon brand assets', () => {
	it('static/favicon.ico exists, is non-empty, and is a valid multi-size ICO', () => {
		const file = path.join(staticDir, 'favicon.ico')
		const buf = readFileSync(file)
		expect(buf.length).toBeGreaterThan(0)
		// ICO header: reserved=0, type=1, count>=2 (16/32/48)
		expect(buf.readUInt16LE(0)).toBe(0)
		expect(buf.readUInt16LE(2)).toBe(1)
		expect(buf.readUInt16LE(4)).toBeGreaterThanOrEqual(2)
	})

	it('static/favicon.svg exists, is non-empty, and parses as SVG', () => {
		const file = path.join(staticDir, 'favicon.svg')
		const buf = readFileSync(file)
		expect(buf.length).toBeGreaterThan(0)
		expect(buf.length).toBeLessThan(2048)
		const text = buf.toString('utf-8')
		expect(text).toContain('<svg')
		expect(text).toContain('xmlns="http://www.w3.org/2000/svg"')
		expect(text.trim().endsWith('</svg>')).toBe(true)
	})

	it('app.html references favicon.svg and favicon.ico as fallback links', () => {
		const html = readFileSync(path.resolve(staticDir, '../src/app.html'), 'utf-8')
		expect(html).toContain('rel="icon"')
		expect(html).toContain('href="/favicon.svg"')
		expect(html).toContain('href="/favicon.ico"')
	})
})
