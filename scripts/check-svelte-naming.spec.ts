import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { checkSvelteNaming, findPascalCaseSvelteFiles } from './check-svelte-naming.mjs'

describe('check-svelte-naming', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    roots.length = 0
  })

  function makeRoot(files: Record<string, string>): string {
    const root = join(
      tmpdir(),
      `eigen-svelte-naming-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    roots.push(root)
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, body)
    }
    return root
  }

  it('passes when all app components are kebab-case', () => {
    const root = makeRoot({
      'src/lib/components/app-header.svelte': '<div />',
      'src/routes/timeline/temporal-events.svelte': '<div />',
      'src/lib/components/ui/button/Button.svelte': '<button />',
    })
    expect(checkSvelteNaming(root)).toEqual({ ok: true })
    expect(findPascalCaseSvelteFiles(root)).toEqual([])
  })

  it('fails on PascalCase route/lib components outside ui/', () => {
    // Intentionally PascalCase fixture paths — these are the violation shape under test.
    const root = makeRoot({
      'src/routes/timeline/TemporalEvents.svelte': '<div />',
      'src/lib/components/graph/ForceGraph.svelte': '<div />',
      'src/lib/components/ui/card/Card.svelte': '<div />',
    })
    const result = checkSvelteNaming(root)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations).toEqual([
        'src/lib/components/graph/ForceGraph.svelte',
        'src/routes/timeline/TemporalEvents.svelte',
      ])
    }
  })

  it('allows PascalCase only under src/lib/components/ui/', () => {
    const root = makeRoot({
      'src/lib/components/ui/dialog/DialogContent.svelte': '<div />',
    })
    expect(checkSvelteNaming(root)).toEqual({ ok: true })
  })
})
