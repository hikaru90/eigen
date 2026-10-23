import type {
  BoardArea,
  BoardCheckResult,
  BoardIdea,
  BoardKind,
  BoardShareResult,
  BoardVoteResult,
  MyVote,
} from './board-types'

/**
 * The board's only network layer: native fetch against the explicit `+server`
 * endpoints under `/api/board`. Every failure throws with the server's own message
 * and status — no retries, no fallbacks; the page shows the message in its note.
 */
export class BoardRequestError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'BoardRequestError'
    this.status = status
    this.code = code
  }
}

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload: unknown = await res.json().catch(() => null)
  const rec = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!res.ok) {
    const message = typeof rec?.error === 'string' ? rec.error : `Request failed (${res.status})`
    throw new BoardRequestError(
      message,
      res.status,
      typeof rec?.code === 'string' ? rec.code : undefined,
    )
  }
  return payload as T
}

export async function fetchBoard(): Promise<BoardIdea[]> {
  return (await call<{ ideas: BoardIdea[] }>('/api/board', 'GET')).ideas
}

export function checkIdea(title: string): Promise<BoardCheckResult> {
  return call('/api/board/ideas/check', 'POST', { title })
}

export function shareIdea(draft: {
  title: string
  kind: BoardKind
  area: BoardArea
}): Promise<BoardShareResult> {
  return call('/api/board/ideas', 'POST', draft)
}

export function voteOnIdea(id: string, direction: MyVote): Promise<BoardVoteResult> {
  return call(`/api/board/ideas/${encodeURIComponent(id)}/vote`, 'PUT', { direction })
}

export function correctIdea(
  id: string,
  patch: { kind?: BoardKind; area?: BoardArea },
): Promise<{ idea: BoardIdea }> {
  return call(`/api/board/ideas/${encodeURIComponent(id)}`, 'PATCH', patch)
}

export function forgetIdea(id: string): Promise<{ ok: true }> {
  return call(`/api/board/ideas/${encodeURIComponent(id)}`, 'DELETE')
}
