import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const uiDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(uiDir, '../../../..')

function readUi(relativeFromUi: string): string {
  return readFileSync(path.join(uiDir, relativeFromUi), 'utf-8')
}

function readRepo(relativeFromRoot: string): string {
  return readFileSync(path.join(repoRoot, relativeFromRoot), 'utf-8')
}

/** Default class strings only — ignore optional className / overlayClass passthrough. */
function defaultClassLiteral(source: string): string {
	const cnMatch = source.match(/class=\{cn\(\s*['"]([^'"]+)['"]/)
	if (cnMatch?.[1]) return cnMatch[1]
	throw new Error('Could not find cn(\'...\') / cn("...") default class literal')
}

describe('overlay stacking contract', () => {
  it('keeps drawer primitives at z-50 so nested dialogs can sit above', () => {
    const overlay = defaultClassLiteral(readUi('drawer/drawer-overlay.svelte'))
    const content = defaultClassLiteral(readUi('drawer/drawer-content.svelte'))

    expect(overlay).toContain('z-50')
    expect(overlay).not.toContain('z-[60]')
    expect(content).toContain('z-50')
    expect(content).not.toContain('z-[60]')
  })

  it('stacks Dialog above drawer at z-[60]', () => {
    const overlay = defaultClassLiteral(readUi('dialog/dialog-overlay.svelte'))
    const content = defaultClassLiteral(readUi('dialog/dialog-content.svelte'))

    expect(overlay).toContain('z-[60]')
    expect(content).toContain('z-[60]')
  })

  it('stacks AlertDialog above drawer at z-[60] (confirm-over-drawer)', () => {
    const overlay = defaultClassLiteral(readUi('alert-dialog/alert-dialog-overlay.svelte'))
    const content = defaultClassLiteral(readUi('alert-dialog/alert-dialog-content.svelte'))

    expect(overlay).toContain('z-[60]')
    expect(content).toContain('z-[60]')
  })

  it('keeps project delete confirm test id for release smoke', () => {
    const projectsView = readRepo('src/routes/timeline/timeline-projects-view.svelte')
    expect(projectsView).toContain('data-testid="project-delete-confirm"')
  })
})
