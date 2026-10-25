/**
 * A kept thought's type and thread, changed after the fact — shared by the thought page
 * and Capture's "Kept as …" strip. Native fetch against the explicit endpoints:
 * the type is `PATCH /api/thoughts/[id]` (the user's pick, never re-read from the words),
 * the thread is the project-assign endpoint. Failures throw with the server's message.
 */
export type ThreadRef = { entityId: string; label: string }
export type ThreadPick = { entityId: string } | { label: string }

async function failure(res: Response, what: string): Promise<Error> {
  const payload = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null
  const reason =
    typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.message === 'string'
        ? payload.message
        : `${what} failed (${res.status})`
  return new Error(reason)
}

export async function setThoughtType(thoughtId: string, key: string): Promise<void> {
  const res = await fetch(`/api/thoughts/${encodeURIComponent(thoughtId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: key }),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await failure(res, 'Type change')
}

/** Put the thought on a thread (an existing one, or a new one by name); returns where it landed. */
export async function assignThoughtThread(thoughtId: string, pick: ThreadPick): Promise<ThreadRef> {
  const res = await fetch('/api/timeline/projects/assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      'entityId' in pick
        ? { thoughtId, projectEntityId: pick.entityId }
        : { thoughtId, projectLabel: pick.label },
    ),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await failure(res, 'Thread assign')
  const result = (await res.json()) as { projectEntityId?: unknown; projectLabel?: unknown }
  if (typeof result.projectEntityId !== 'string' || typeof result.projectLabel !== 'string') {
    throw new Error('Thread assign returned no thread')
  }
  return { entityId: result.projectEntityId, label: result.projectLabel }
}

/** Take the thought off its thread. */
export async function unassignThoughtThread(thoughtId: string): Promise<void> {
  const res = await fetch('/api/timeline/projects/assign', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thoughtId }),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await failure(res, 'Thread unassign')
}

/** The user's threads for the picker. */
export async function fetchThreadOptions(): Promise<ThreadRef[]> {
  const res = await fetch('/api/timeline/projects', { credentials: 'same-origin' })
  if (!res.ok) throw await failure(res, 'Loading threads')
  const body = (await res.json()) as { projects?: unknown }
  if (!body || !Array.isArray(body.projects)) return []
  const options: ThreadRef[] = []
  for (const p of body.projects) {
    if (!p || typeof p !== 'object') continue
    const entityId = (p as { entityId?: unknown }).entityId
    const label = (p as { label?: unknown }).label
    if (typeof entityId === 'string' && entityId && typeof label === 'string' && label.trim()) {
      options.push({ entityId, label })
    }
  }
  return options
}
