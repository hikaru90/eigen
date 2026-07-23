import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  TIMELINE_QUICK_ACTION_SURFACES,
  postTimelineQuickAction,
  timelineQuickActionRequestBody,
  timelineQuickActionRequestUrl,
} from './timeline-item-actions'

const here = path.dirname(fileURLToPath(import.meta.url))

function readTimeline(relative: string): string {
  return readFileSync(path.join(here, relative), 'utf-8')
}

describe('timeline quick action contract', () => {
  it('documents the three UI surfaces that must share one client', () => {
    expect(TIMELINE_QUICK_ACTION_SURFACES).toEqual([
      'tasks_today',
      'projects_unassigned',
      'projects_detail',
    ])
  })

  it('builds the same action URL for task ids and event uuids', () => {
    expect(timelineQuickActionRequestUrl('task:abc-123')).toBe(
      '/api/temporal-events/task%3Aabc-123/action',
    )
    expect(timelineQuickActionRequestUrl('12257a00-0e1f-4672-8b74-6f359f053c43')).toBe(
      '/api/temporal-events/12257a00-0e1f-4672-8b74-6f359f053c43/action',
    )
  })

  it('rejects empty item ids', () => {
    expect(() => timelineQuickActionRequestUrl('  ')).toThrow(/required/i)
  })

  it('posts mark_done with the same body regardless of surface', () => {
    expect(timelineQuickActionRequestBody('mark_done')).toEqual({ action: 'mark_done' })
    expect(timelineQuickActionRequestBody('reopen')).toEqual({ action: 'reopen' })
    expect(timelineQuickActionRequestBody('archive')).toEqual({ action: 'archive' })
  })

  it('postTimelineQuickAction hits temporal-events action for a task id', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        item: { id: 'task:t1', thoughtId: 't1', lifecycleStatus: 'completed' },
        summary: 'Marked done.',
      }),
    }))

    const result = await postTimelineQuickAction(
      'task:t1',
      'mark_done',
      fetchImpl as unknown as typeof fetch,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/temporal-events/task%3At1/action')
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ action: 'mark_done' }),
    })
    expect(result.item.id).toBe('task:t1')
  })

  it('postTimelineQuickAction uses the same endpoint for an event uuid (projects grouping)', async () => {
    const eventId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        item: { id: eventId, thoughtId: 't2', lifecycleStatus: 'completed' },
        summary: 'Marked done.',
      }),
    }))

    await postTimelineQuickAction(eventId, 'mark_done', fetchImpl as unknown as typeof fetch)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`/api/temporal-events/${eventId}/action`)
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({ action: 'mark_done' })
  })

  it('surfaces throw when the server rejects the action', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'not found',
    }))

    await expect(
      postTimelineQuickAction('task:missing', 'mark_done', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/not found/)
  })
})

describe('timeline quick action wiring (no forked mark-done clients)', () => {
  it('TemporalEvents owns postTimelineQuickAction; ProjectsView uses onQuickAction prop', () => {
    const tasks = readTimeline('timeline-shell.svelte')
    const projects = readTimeline('timeline-projects-view.svelte')
    expect(tasks).toContain("from './timeline-item-actions'")
    expect(tasks).toContain('postTimelineQuickAction')
    expect(projects).toContain('onQuickAction')
    expect(projects).not.toContain('postTimelineQuickAction')
    expect(
      tasks.includes('onQuickAction={onQuickAction}') || tasks.includes('{onQuickAction}'),
    ).toBe(true)
  })

  it('ProjectsView does not fork a thoughts PATCH mark-done path', () => {
    const projects = readTimeline('timeline-projects-view.svelte')
    expect(projects).not.toMatch(/fetch\(`\/api\/thoughts\/\$\{/)
    expect(projects).not.toContain('async function postTaskStatus')
  })

  it('TemporalEvents does not keep a separate postTaskStatus PATCH path', () => {
    const tasks = readTimeline('timeline-shell.svelte')
    expect(tasks).not.toContain('async function postTaskStatus')
    expect(tasks).not.toMatch(/fetch\(`\/api\/thoughts\/\$\{/)
  })
})
