export type ProjectGanttTask = {
  id: string
  startAt: string | null
  endAt: string | null
}

export type ProjectGanttRange = {
  startMs: number
  endMs: number
}

export type ProjectGanttBar = {
  leftPct: number
  widthPct: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 14

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

export function buildProjectGanttRange(input: {
  tasks: ProjectGanttTask[]
  milestones: Array<{ targetDate: string | null }>
  deadline: string | null
  now: Date
}): ProjectGanttRange {
  const points: number[] = []
  for (const task of input.tasks) {
    const start = parseMs(task.startAt)
    const end = parseMs(task.endAt)
    if (start != null) points.push(start)
    if (end != null) points.push(end)
  }
  for (const milestone of input.milestones) {
    const ms = parseMs(milestone.targetDate)
    if (ms != null) points.push(ms)
  }
  const deadlineMs = parseMs(input.deadline)
  if (deadlineMs != null) points.push(deadlineMs)

  if (points.length === 0) {
    const startMs = input.now.getTime()
    return { startMs, endMs: startMs + DEFAULT_WINDOW_DAYS * DAY_MS }
  }

  const startMs = Math.min(...points)
  const endMs = Math.max(...points)
  if (endMs <= startMs) {
    return { startMs, endMs: startMs + DAY_MS }
  }
  return { startMs, endMs }
}

export function placeGanttBar(
  task: { startAt: string | null; endAt: string | null },
  range: ProjectGanttRange,
): ProjectGanttBar | null {
  const start = parseMs(task.startAt)
  if (start == null) return null
  const end = parseMs(task.endAt) ?? start + DAY_MS
  const span = range.endMs - range.startMs
  if (span <= 0) return null

  const leftPct = ((start - range.startMs) / span) * 100
  const widthPct = (Math.max(end - start, DAY_MS / 24) / span) * 100
  return {
    leftPct: Math.max(0, Math.min(100, leftPct)),
    widthPct: Math.max(0.5, Math.min(100 - Math.max(0, leftPct), widthPct)),
  }
}

export function placeGanttMarker(
  iso: string | null | undefined,
  range: ProjectGanttRange,
): number | null {
  const ms = parseMs(iso)
  if (ms == null) return null
  const span = range.endMs - range.startMs
  if (span <= 0) return null
  return ((ms - range.startMs) / span) * 100
}
