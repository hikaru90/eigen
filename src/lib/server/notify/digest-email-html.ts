import type {
  DailyDigest,
  DailyDigestProjectChange,
  DailyDigestSnippet,
} from '$lib/server/memory/daily-summary'

/**
 * Pure renderers for the daily digest email. Owlery substitutes `{{key}}` raw into
 * HTML, so everything user-authored is escaped here.
 */

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif"
const TEXT = '#262626'
const MUTED = '#666666'
const SNIPPET_LIMIT = 3

const CARD_STYLE = `background:#ffffff;border:2px solid #000000;box-shadow:3px 3px 0 0 #000000;padding:16px;font-family:${FONT};color:${TEXT};font-size:14px;line-height:20px`
const HEADING_STYLE = `margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:${MUTED}`
const LINE_STYLE = `margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:20px;color:${TEXT}`
const MUTED_LINE_STYLE = `margin:0;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED}`
const LINK_STYLE = `color:${TEXT};font-weight:600;text-decoration:underline`

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function projectUrl(origin: string, entityId: string): string {
  return `${origin}/memory/projects/${encodeURIComponent(entityId)}`
}

function summaryUrl(origin: string): string {
  return `${origin}/summary`
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="${LINK_STYLE}">${escapeHtml(label)}</a>`
}

function plural(n: number, one: string, other: string): string {
  return `${n} ${n === 1 ? one : other}`
}

function card(heading: string, bodyHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 16px">` +
    `<tr><td style="${CARD_STYLE}"><p style="${HEADING_STYLE}">${escapeHtml(heading)}</p>${bodyHtml}</td></tr></table>`
  )
}

function line(html: string): string {
  return `<p style="${LINE_STYLE}">${html}</p>`
}

function mutedLine(text: string): string {
  return `<p style="${MUTED_LINE_STYLE}">${escapeHtml(text)}</p>`
}

const STALLED_REASON: Record<string, string> = {
  deadline_overdue: 'deadline overdue',
  milestone_overdue: 'milestone overdue',
  no_next_action: 'no next action',
}

function stalledReason(reason: string): string {
  return STALLED_REASON[reason] ?? reason
}

function changePhrase(change: DailyDigestProjectChange): string {
  switch (change.kind) {
    case 'tasks_done':
      return `${plural(change.count, 'task', 'tasks')} done`
    case 'thoughts_linked':
      return `${plural(change.count, 'new thought', 'new thoughts')} linked`
    case 'milestone_added':
      return `Milestone added: ${change.label}`
    case 'milestone_changed':
      return `Milestone changed: ${change.label}`
    case 'next_action_changed':
      return `Next action: ${change.from ?? 'none'} → ${change.to ?? 'none'}`
  }
}

function activityPhrase(newThoughts: number, tasksDone: number): string {
  const parts: string[] = []
  if (newThoughts > 0) parts.push(plural(newThoughts, 'new thought', 'new thoughts'))
  if (tasksDone > 0) parts.push(plural(tasksDone, 'task done', 'tasks done'))
  return parts.join(', ')
}

function unthreadedHeadline(count: number): string {
  return `${plural(count, 'open task', 'open tasks')} without a project`
}

function snippetsOf(recent: DailyDigestSnippet[]): string[] {
  return recent.map((r) => r.snippet)
}

export function hasProjectActivity(digest: DailyDigest): boolean {
  const { mostActive, changes, needCleanup } = digest.projectActivity
  return mostActive.length > 0 || changes.length > 0 || hasCleanup(needCleanup)
}

function hasCleanup(c: DailyDigest['projectActivity']['needCleanup']): boolean {
  return (
    c.stalled.length > 0 ||
    c.noNextAction.length > 0 ||
    c.overdueTasks.length > 0 ||
    c.unthreaded.count > 0
  )
}

export function renderProjectsHtml(digest: DailyDigest, origin: string): string {
  const { mostActive, changes, needCleanup } = digest.projectActivity
  const sections: string[] = []

  if (mostActive.length > 0) {
    sections.push(
      card(
        'Most active',
        mostActive
          .map((p) =>
            line(
              `${link(projectUrl(origin, p.entityId), p.label)} — ${escapeHtml(activityPhrase(p.newThoughts, p.tasksDone))}`,
            ),
          )
          .join(''),
      ),
    )
  }

  if (changes.length > 0) {
    sections.push(
      card(
        'Changes',
        changes
          .map(
            (p) =>
              line(link(projectUrl(origin, p.entityId), p.label)) +
              `<ul style="margin:0 0 10px;padding:0 0 0 18px;font-family:${FONT};font-size:14px;line-height:20px;color:${TEXT}">` +
              p.items.map((item) => `<li>${escapeHtml(changePhrase(item))}</li>`).join('') +
              '</ul>',
          )
          .join(''),
      ),
    )
  }

  if (hasCleanup(needCleanup)) {
    const rows: string[] = []
    for (const p of needCleanup.stalled) {
      rows.push(
        line(
          `${link(projectUrl(origin, p.entityId), p.label)} — stalled (${escapeHtml(stalledReason(p.reason))})`,
        ),
      )
    }
    for (const p of needCleanup.noNextAction) {
      rows.push(line(`${link(projectUrl(origin, p.entityId), p.label)} — no next action`))
    }
    for (const p of needCleanup.overdueTasks) {
      rows.push(
        line(
          `${link(projectUrl(origin, p.entityId), p.label)} — ${escapeHtml(plural(p.count, 'overdue task', 'overdue tasks'))}`,
        ),
      )
    }
    if (needCleanup.unthreaded.count > 0) {
      rows.push(line(escapeHtml(unthreadedHeadline(needCleanup.unthreaded.count))))
      for (const snippet of snippetsOf(needCleanup.unthreaded.recent)) {
        rows.push(`<p style="${MUTED_LINE_STYLE};padding:0 0 4px 12px">${escapeHtml(snippet)}</p>`)
      }
    }
    sections.push(card('Needs cleanup', rows.join('')))
  }

  return sections.length > 0
    ? sections.join('')
    : mutedLine('No project activity in the last 24 hours.')
}

export function renderAgentsHtml(digest: DailyDigest, origin: string): string {
  if (digest.agents.length === 0) return mutedLine('No agent captures in the last 24 hours.')
  const rows = digest.agents
    .map((agent) => {
      const snippets = snippetsOf(agent.recent.slice(0, SNIPPET_LIMIT))
        .map((s) => `<p style="${MUTED_LINE_STYLE};padding:0 0 4px 12px">${escapeHtml(s)}</p>`)
        .join('')
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 8px">` +
        `<tr><td style="font-family:${FONT};font-size:14px;line-height:20px;color:${TEXT}">${link(summaryUrl(origin), agent.label)}</td>` +
        `<td align="right" style="font-family:${FONT};font-size:14px;line-height:20px;color:${TEXT};font-weight:600">${agent.count}</td></tr>` +
        (snippets ? `<tr><td colspan="2">${snippets}</td></tr>` : '') +
        '</table>'
      )
    })
    .join('')
  return card('Agents', rows)
}

/** Plain-text mirror of the projects and agents sections (the email's `text` part). */
export function renderDigestText(digest: DailyDigest, origin: string): string {
  const { mostActive, changes, needCleanup } = digest.projectActivity
  const out: string[] = []

  out.push('Projects')
  if (!hasProjectActivity(digest)) {
    out.push('No project activity in the last 24 hours.')
  }
  if (mostActive.length > 0) {
    out.push('', 'Most active')
    for (const p of mostActive) {
      out.push(
        `${p.label} — ${activityPhrase(p.newThoughts, p.tasksDone)}`,
        `  ${projectUrl(origin, p.entityId)}`,
      )
    }
  }
  if (changes.length > 0) {
    out.push('', 'Changes')
    for (const p of changes) {
      out.push(`${p.label} (${projectUrl(origin, p.entityId)})`)
      for (const item of p.items) out.push(`  - ${changePhrase(item)}`)
    }
  }
  if (hasCleanup(needCleanup)) {
    out.push('', 'Needs cleanup')
    for (const p of needCleanup.stalled) {
      out.push(
        `${p.label} — stalled (${stalledReason(p.reason)}): ${projectUrl(origin, p.entityId)}`,
      )
    }
    for (const p of needCleanup.noNextAction) {
      out.push(`${p.label} — no next action: ${projectUrl(origin, p.entityId)}`)
    }
    for (const p of needCleanup.overdueTasks) {
      out.push(
        `${p.label} — ${plural(p.count, 'overdue task', 'overdue tasks')}: ${projectUrl(origin, p.entityId)}`,
      )
    }
    if (needCleanup.unthreaded.count > 0) {
      out.push(unthreadedHeadline(needCleanup.unthreaded.count))
      for (const s of snippetsOf(needCleanup.unthreaded.recent)) out.push(`  - ${s}`)
    }
  }

  out.push('', 'Agents')
  if (digest.agents.length === 0) {
    out.push('No agent captures in the last 24 hours.')
  } else {
    for (const agent of digest.agents) {
      out.push(`${agent.label} — ${agent.count}`)
      for (const s of snippetsOf(agent.recent.slice(0, SNIPPET_LIMIT))) out.push(`  - ${s}`)
    }
    out.push(summaryUrl(origin))
  }
  return out.join('\n')
}
