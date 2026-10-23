/**
 * The exactly-one-row guard around POST /api/capture/keep.
 *
 * Once the server answered 2xx the thought row exists and enrichment is scheduled —
 * whatever happens afterwards (an unreadable body, a failing follow-up GET for the
 * settled summary) must never put the words back into the field, because pressing
 * Capture again would keep a second row. Only a non-2xx answer means nothing was kept.
 *
 * (A rejected fetch — no response at all — is decided by the caller: with no answer
 * there is no way to know whether the request landed; the page restores the words as
 * every submit path always has. An idempotency key would close that gap; out of scope.)
 */
export type KeepOutcome =
  | { kind: 'kept'; thoughtId: string | null }
  | { kind: 'not-kept'; status: number; message: string | null }

export function keepOutcomeFromResponse(ok: boolean, status: number, body: unknown): KeepOutcome {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (ok) {
    const id = record?.thoughtId
    return { kind: 'kept', thoughtId: typeof id === 'string' && id.trim() ? id : null }
  }
  const message = record?.message
  const error = record?.error
  return {
    kind: 'not-kept',
    status,
    message:
      typeof message === 'string' && message.trim()
        ? message
        : typeof error === 'string' && error.trim()
          ? error
          : null,
  }
}
