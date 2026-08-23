import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))

function readTimeline(relative: string): string {
  return readFileSync(path.join(here, relative), 'utf-8')
}

describe('timeline single-source-of-truth wiring', () => {
  it('shell + task view + project board use onMount / handlers — no $effect', () => {
    const shell = readTimeline('timeline-shell.svelte')
    const tasks = readTimeline('timeline-tasks-view.svelte')
    const projects = readTimeline('timeline-projects-view.svelte')
    const dataStore = readTimeline('timeline-data.svelte.ts')

    for (const [name, source] of [
      ['timeline-shell.svelte', shell],
      ['timeline-tasks-view.svelte', tasks],
      ['timeline-projects-view.svelte', projects],
      ['timeline-data.svelte.ts', dataStore],
    ] as const) {
      expect(source, name).not.toMatch(/\$effect/)
    }
    expect(shell).toContain('onMount(')
    expect(shell).toContain('.load(')
  })

  it('shell has exactly one timeline fetch path via createTimelineData load', () => {
    const shell = readTimeline('timeline-shell.svelte')
    const dataStore = readTimeline('timeline-data.svelte.ts')
    expect(dataStore).toContain('async function load(')
    expect(dataStore).toContain('buildTimelineApiUrl')
    expect(dataStore).toContain('await fetch(')
    expect(dataStore).not.toContain('/api/temporal-events')
    expect(dataStore).not.toContain('/api/timeline/stats')
    expect(shell).not.toContain("fetch('/api/temporal-events")
    expect(shell).not.toContain("fetch('/api/timeline/stats")
    expect(shell).not.toContain('loadOverdueItems')
    expect(shell).not.toContain('loadStats')
  })

  it('task view and project board do not fetch — they receive derived props', () => {
    const tasks = readTimeline('timeline-tasks-view.svelte')
    const projects = readTimeline('timeline-projects-view.svelte')
    expect(tasks).not.toContain('fetch(')
    expect(projects).not.toContain("fetch('/api/timeline/projects")
    expect(projects).not.toContain('loadProjects')
  })

  it('tab counts come from the same arrays each tab renders', () => {
    const shell = readTimeline('timeline-shell.svelte')
    expect(shell).toContain('todo: filteredTodoItems.length')
    expect(shell).toContain('done: filteredDoneItems.length')
    expect(shell).toContain('overdue: filteredOverdueItems.length')
    expect(shell).toContain('items={filteredTodoItems}')
    expect(shell).toMatch(/TimelineTasksView[\s\S]*?items=\{filteredTodoItems\}/)
    expect(shell).toContain('filterTimelineItemsBySearch')
    expect(shell).toContain('MorphSearchControl')
    expect(shell).toContain('bind:search={searchQuery}')
    expect(shell).not.toMatch(/shrink-0 px-3 pb-2 pt-1/)
    expect(shell).not.toMatch(/let data = \$state/)
  })

  it('mounts project assign dialog only when open', () => {
    const shell = readTimeline('timeline-shell.svelte')
    const projects = readTimeline('timeline-projects-view.svelte')
    expect(shell).toMatch(/\{#if\s+assignProjectOpen\}[\s\S]*TimelineProjectAssignDialog/)
    expect(projects).toMatch(/\{#if\s+assignProjectOpen\}[\s\S]*TimelineProjectAssignDialog/)
  })
})
