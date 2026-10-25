import { consumeCaptureNdjsonStream } from '$lib/capture/consume-capture-ndjson'

/**
 * Changing a kept thought — its words, type and thread — shared by the thought page,
 * Capture's "Kept as …" strip and the unfolded rows in Yarn and Threads. Native fetch
 * against the explicit endpoints: the words go through the natural-language edit
 * endpoint (POST /api/capture/edit), the type is `PATCH /api/thoughts/[id]` (the user's
 * pick, never re-read from the words), the thread is the project-assign endpoint.
 * Failures throw with the server's message.
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

/** The thought as the server now has it — read back after an edit, never guessed. */
export async function readThought(thoughtId: string): Promise<{ text: string; category: string }> {
  const res = await fetch(`/api/thoughts/${encodeURIComponent(thoughtId)}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) throw await failure(res, 'Thought re-read')
  const body = (await res.json()) as { normalizedText?: unknown; category?: unknown }
  if (typeof body.normalizedText !== 'string' || typeof body.category !== 'string') {
    throw new Error('Thought re-read returned no text or type')
  }
  return { text: body.normalizedText, category: body.category }
}

/** Run a natural-language edit on the thought, then read back what the server kept. */
export async function applyThoughtEdit(
  thoughtId: string,
  editRequest: string,
): Promise<{ text: string; category: string }> {
  const res = await fetch('/api/capture/edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson, application/json',
    },
    body: JSON.stringify({ thoughtId, editRequest }),
    credentials: 'same-origin',
  })
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-ndjson')) {
    await consumeCaptureNdjsonStream<unknown>(res, () => {})
  } else if (!res.ok) {
    throw new Error((await res.text()) || `Edit failed (${res.status})`)
  }
  return readThought(thoughtId)
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
