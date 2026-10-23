import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ei redesign, wave 1 — token layer contract (docs/planning/ei-redesign.md).
 *
 * The ei tokens in layout.css are the design-system contract every later wave
 * consumes, and the shadcn variable NAMES must survive the mapping (tailwind
 * utilities like bg-background / text-muted-foreground depend on them). The
 * dark palette must stay under the existing `.dark` class + theme-preference
 * system (no data-theme switch), and --theme-color must stay hex because the
 * Android PWA title bar rejects oklch() and the meta sync reads it raw.
 *
 * Like auth-chrome.spec.ts, this asserts on the source text — CSS is not
 * unit-importable. It fails if the token layer is renamed, dropped, or the
 * dark mapping drifts away from the ei palette.
 */

function readLayoutCss(): string {
  return readFileSync(join(process.cwd(), 'src/routes/layout.css'), 'utf8')
}

function readAppHtml(): string {
  return readFileSync(join(process.cwd(), 'src/app.html'), 'utf8')
}

/** Light tokens live in the (single) `:root { … }` block inside @layer base. */
function rootBlock(css: string): string {
  const match = css.match(/(?:^|\n)\s*:root\s*\{([^{}]*)\}/)
  expect(match, ':root block not found in layout.css').not.toBeNull()
  return match?.[1] ?? ''
}

/** Dark tokens live in the unlayered `.dark { … }` class block (existing theme system). */
function darkBlock(css: string): string {
  const match = css.match(/(?:^|\n)\.dark\s*\{([^{}]*)\}/)
  expect(match, 'unlayered .dark block not found in layout.css').not.toBeNull()
  return match?.[1] ?? ''
}

function decl(block: string, name: string): string {
  const match = block.match(new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm'))
  expect(match, `${name} not declared in block`).not.toBeNull()
  return (match?.[1] ?? '').trim()
}

describe('ei tokens in layout.css :root', () => {
  const css = readLayoutCss()
  const root = rootBlock(css)

  it('declares the ei surface/ink palette verbatim', () => {
    expect(decl(root, '--paper')).toBe('#e8ede5')
    expect(decl(root, '--paper-2')).toBe('#dee4db')
    expect(decl(root, '--raised')).toBe('#f7f9f4')
    expect(decl(root, '--ink')).toBe('#141413')
    expect(decl(root, '--ink-2')).toBe('rgba(20, 20, 19, 0.74)')
    expect(decl(root, '--ink-3')).toBe('rgba(20, 20, 19, 0.62)')
    expect(decl(root, '--ink-4')).toBe('rgba(20, 20, 19, 0.2)')
    expect(decl(root, '--line')).toBe('rgba(20, 20, 19, 0.085)')
  })

  it('declares signal, clay, warn and the yarn colours', () => {
    expect(decl(root, '--signal')).toBe('#3a52e6')
    expect(decl(root, '--signal-2')).toBe('rgba(58, 82, 230, 0.13)')
    expect(decl(root, '--clay')).toBe('#9e4c2a')
    expect(decl(root, '--clay-2')).toBe('rgba(158, 76, 42, 0.12)')
    expect(decl(root, '--warn')).toBe('#b8432c')
    expect(decl(root, '--yarn-capture')).toBe('#9a6a0c')
    expect(decl(root, '--yarn-mesh')).toBe('#4f8a1a')
    expect(decl(root, '--yarn-ask')).toBe('var(--signal)')
  })

  it('declares shadow, grain, motion and the two voices', () => {
    expect(decl(root, '--shadow')).toContain('0 28px 56px -20px')
    expect(decl(root, '--grain')).toBe('0.035')
    expect(decl(root, '--ease')).toBe('cubic-bezier(0.22, 1, 0.36, 1)')
    expect(decl(root, '--ease-io')).toBe('cubic-bezier(0.65, 0, 0.35, 1)')
    expect(decl(root, '--font-you')).toContain("'Geist Mono'")
    expect(decl(root, '--font-mesh')).toContain("'Inter'")
  })

  it('declares the floating-chrome placement tokens', () => {
    expect(decl(root, '--head')).toBe('68px')
    expect(decl(root, '--bottom-nav')).toContain('env(safe-area-inset-bottom')
  })

  it('keeps --radius small (paper, not bubbly)', () => {
    expect(decl(root, '--radius')).toBe('0.25rem')
  })
})

describe('shadcn variables mapped onto the ei tokens', () => {
  const css = readLayoutCss()

  it('maps the light :root onto paper/ink tokens, keeping the shadcn names', () => {
    const root = rootBlock(css)
    expect(decl(root, '--background')).toBe('var(--paper)')
    expect(decl(root, '--foreground')).toBe('var(--ink)')
    expect(decl(root, '--card')).toBe('var(--raised)')
    expect(decl(root, '--popover')).toBe('var(--raised)')
    expect(decl(root, '--primary')).toBe('var(--ink)')
    expect(decl(root, '--primary-foreground')).toBe('var(--paper)')
    expect(decl(root, '--secondary')).toBe('var(--paper-2)')
    expect(decl(root, '--muted')).toBe('var(--paper-2)')
    expect(decl(root, '--muted-foreground')).toBe('var(--ink-3)')
    expect(decl(root, '--accent')).toBe('var(--paper-2)')
    expect(decl(root, '--border')).toBe('var(--line)')
    expect(decl(root, '--input')).toBe('var(--ink-4)')
    expect(decl(root, '--ring')).toBe('var(--signal)')
    expect(decl(root, '--destructive')).toBe('var(--warn)')
  })

  it('maps the .dark block onto the ei dark palette', () => {
    const dark = darkBlock(css)
    expect(decl(dark, '--paper')).toBe('#0e0e0d')
    expect(decl(dark, '--paper-2')).toBe('#1a1a18')
    // one step above the ei value (#1d1d1b): the selected pill was unreadable on
    // --paper-2 tracks in dark (operator report); the pill ring carries the rest
    expect(decl(dark, '--raised')).toBe('#232320')
    expect(decl(dark, '--ink')).toBe('#eceae3')
    expect(decl(dark, '--signal')).toBe('#8e9dff')
    expect(decl(dark, '--clay')).toBe('#e89270')
    expect(decl(dark, '--warn')).toBe('#f08a72')
    expect(decl(dark, '--yarn-capture')).toBe('#eab54a')
    expect(decl(dark, '--yarn-mesh')).toBe('#92c255')

    expect(decl(dark, '--background')).toBe('var(--paper)')
    expect(decl(dark, '--foreground')).toBe('var(--ink)')
    expect(decl(dark, '--card')).toBe('var(--raised)')
    expect(decl(dark, '--popover')).toBe('var(--raised)')
    expect(decl(dark, '--primary')).toBe('var(--ink)')
    expect(decl(dark, '--primary-foreground')).toBe('var(--paper)')
    expect(decl(dark, '--secondary')).toBe('var(--paper-2)')
    expect(decl(dark, '--muted')).toBe('var(--paper-2)')
    expect(decl(dark, '--muted-foreground')).toBe('var(--ink-3)')
    expect(decl(dark, '--accent')).toBe('var(--paper-2)')
    expect(decl(dark, '--border')).toBe('var(--line)')
    expect(decl(dark, '--input')).toBe('var(--ink-4)')
    expect(decl(dark, '--ring')).toBe('var(--signal)')
    expect(decl(dark, '--destructive')).toBe('var(--warn)')
  })

  it('gives the selected pill a visible ring in both themes (WCAG 1.4.11 in dark)', () => {
    expect(decl(rootBlock(css), '--pill-ring')).toContain('var(--line)')
    const darkRing = decl(darkBlock(css), '--pill-ring')
    expect(darkRing).toContain('rgba(236, 234, 227, 0.4)')
  })

  it('keeps --theme-color hex in both themes (Android PWA title bar)', () => {
    expect(decl(rootBlock(css), '--theme-color')).toBe('#e8ede5')
    expect(decl(darkBlock(css), '--theme-color')).toBe('#0e0e0d')
    for (const block of [rootBlock(css), darkBlock(css)]) {
      expect(decl(block, '--theme-color')).not.toMatch(/oklch|var\(/)
    }
  })
})

describe('paper and motion base layer', () => {
  const css = readLayoutCss()

  it('carries the paper-grain body::after overlay', () => {
    const grain = css.match(/body::after\s*\{([^{}]*)\}/)
    expect(grain, 'body::after grain overlay not found').not.toBeNull()
    const rule = grain?.[1] ?? ''
    expect(rule).toContain('opacity: var(--grain)')
    expect(rule).toContain('pointer-events: none')
    expect(rule).toContain('feTurbulence')
  })

  it('defines the settle keyframes (rise / fade / enter)', () => {
    for (const name of ['rise', 'fade', 'enter']) {
      expect(css).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`))
    }
  })

  it('snaps under prefers-reduced-motion', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/)
    expect(reduced, 'prefers-reduced-motion block not found').not.toBeNull()
    expect(reduced?.[1] ?? '').toContain('animation-duration')
    expect(reduced?.[1] ?? '').toContain('transition-duration')
  })
})

describe('existing mechanisms preserved', () => {
  const css = readLayoutCss()
  const html = readAppHtml()

  it('stays on the .dark class + theme-preference system (no data-theme switch)', () => {
    expect(css).not.toContain('data-theme')
    expect(html).toContain("localStorage.getItem('theme-preference')")
    expect(html).toContain("classList.add('dark')")
  })

  it('leaves safe-area paddings to inline utilities (the old .pt-safe/.pb-safe are gone)', () => {
    expect(css).not.toContain('pt-safe')
    expect(css).not.toContain('pb-safe')
    // Ask never renders thought-id citation chips, so their global classes are gone
    expect(css).not.toMatch(/\.chat-citation\s*\{/)
  })

  it('keeps the PWA theme-color meta wired to paper', () => {
    expect(html).toMatch(/<meta name="theme-color" content="#e8ede5"/)
    expect(html).toContain("'#0e0e0d'")
  })
})
