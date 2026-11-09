import { describe, expect, it } from 'vitest'
import type { DailyDigest } from '$lib/server/memory/daily-summary'
import { renderAgentsHtml, renderDigestText, renderProjectsHtml } from './digest-email-html'

const ORIGIN = 'https://eigen.example'

function digest(over: Partial<DailyDigest> = {}): DailyDigest {
  return {
    yesterday: { completed: 0, overdue: 0, dueToday: 0 },
    thoughtsFiled: 0,
    tasksDone: 0,
    projects: [],
    projectActivity: {
      mostActive: [],
      changes: [],
      needCleanup: {
        stalled: [],
        noNextAction: [],
        overdueTasks: [],
        unthreaded: { count: 0, recent: [] },
      },
    },
    stalled: [],
    unthreaded: { count: 0, recent: [] },
    agents: [],
    ...over,
  }
}

const busy = digest({
  projectActivity: {
    mostActive: [{ entityId: 'p1', label: 'Eigen <mesh>', newThoughts: 2, tasksDone: 1, score: 3 }],
    changes: [
      {
        entityId: 'p1',
        label: 'Eigen <mesh>',
        items: [
          { kind: 'tasks_done', count: 1 },
          { kind: 'thoughts_linked', count: 2 },
          { kind: 'milestone_added', label: 'Beta "launch"' },
          { kind: 'milestone_changed', label: 'Alpha' },
          { kind: 'next_action_changed', from: null, to: 'Ship <it>' },
        ],
      },
    ],
    needCleanup: {
      stalled: [{ entityId: 'p2', label: 'Stuck', reason: 'deadline_overdue' }],
      noNextAction: [{ entityId: 'p3', label: 'Idle' }],
      overdueTasks: [{ entityId: 'p4', label: 'Late', count: 2 }],
      unthreaded: { count: 4, recent: [{ thoughtId: 't1', snippet: 'call <b>mom</b>' }] },
    },
  },
})

describe('renderProjectsHtml', () => {
  it('renders the three subsections as role=presentation tables with the card styling', () => {
    const html = renderProjectsHtml(busy, ORIGIN)
    expect(html).toContain('Most active')
    expect(html).toContain('Changes')
    expect(html).toContain('Needs cleanup')
    expect(html.match(/<table role="presentation"/g)).toHaveLength(3)
    expect(html).toContain('border:2px solid #000000')
    expect(html).toContain('box-shadow:3px 3px 0 0 #000000')
    expect(html).toContain('padding:16px')
    expect(html).toContain('background:#ffffff')
    expect(html).toContain('color:#262626')
    expect(html).toContain('color:#666666')
    expect(html).toContain("font-family:'Helvetica Neue',Helvetica,Arial,sans-serif")
    expect(html).toContain('text-transform:uppercase')
    expect(html).toContain('letter-spacing:1px')
  })

  it('links projects to their absolute project page', () => {
    const html = renderProjectsHtml(busy, ORIGIN)
    expect(html).toContain('href="https://eigen.example/memory/projects/p1"')
    expect(html).toContain('href="https://eigen.example/memory/projects/p3"')
  })

  it('escapes every user-supplied string', () => {
    const html = renderProjectsHtml(busy, ORIGIN)
    expect(html).not.toContain('<mesh>')
    expect(html).not.toContain('<it>')
    expect(html).not.toContain('<b>mom</b>')
    expect(html).toContain('Eigen &lt;mesh&gt;')
    expect(html).toContain('Beta &quot;launch&quot;')
    expect(html).toContain('Ship &lt;it&gt;')
    expect(html).toContain('call &lt;b&gt;mom&lt;/b&gt;')
  })

  it('omits empty subsections', () => {
    const only = digest({
      projectActivity: {
        ...busy.projectActivity,
        changes: [],
        needCleanup: digest().projectActivity.needCleanup,
      },
    })
    const html = renderProjectsHtml(only, ORIGIN)
    expect(html).toContain('Most active')
    expect(html).not.toContain('Changes')
    expect(html).not.toContain('Needs cleanup')
    expect(html.match(/<table role="presentation"/g)).toHaveLength(1)
  })

  it('renders one muted line when there is no project activity', () => {
    const html = renderProjectsHtml(digest(), ORIGIN)
    expect(html).toContain('No project activity in the last 24 hours.')
    expect(html).not.toContain('<table')
  })
})

describe('renderAgentsHtml', () => {
  it('renders label, count and at most 3 escaped snippets per agent, linked to /summary', () => {
    const html = renderAgentsHtml(
      digest({
        agents: [
          {
            key: 'apikey:a',
            label: 'pi <dev>',
            count: 5,
            recent: ['a', 'b', 'c', 'd'].map((s) => ({ thoughtId: s, snippet: `snip <${s}>` })),
          },
        ],
      }),
      ORIGIN,
    )
    expect(html).toContain('pi &lt;dev&gt;')
    expect(html).toContain('href="https://eigen.example/summary"')
    expect(html).toContain('snip &lt;a&gt;')
    expect(html).toContain('snip &lt;c&gt;')
    expect(html).not.toContain('snip &lt;d&gt;')
    expect(html).not.toContain('<dev>')
    expect(html).toContain('>5<')
  })

  it('renders the muted empty line', () => {
    expect(renderAgentsHtml(digest(), ORIGIN)).toContain('No agent captures in the last 24 hours.')
  })
})

describe('renderDigestText', () => {
  it('carries the same content as plain text, unescaped', () => {
    const text = renderDigestText(busy, ORIGIN)
    expect(text).toContain('Most active')
    expect(text).toContain('Eigen <mesh> — 2 new thoughts, 1 task done')
    expect(text).toContain('Next action: none → Ship <it>')
    expect(text).toContain('Stuck — stalled (deadline overdue)')
    expect(text).toContain('Late — 2 overdue tasks')
    expect(text).toContain('4 open tasks without a project')
    expect(text).toContain('https://eigen.example/memory/projects/p1')
    expect(text).toContain('Agents')
    expect(text).toContain('No agent captures in the last 24 hours.')
  })
})
