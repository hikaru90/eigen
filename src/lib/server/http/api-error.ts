import { json } from '@sveltejs/kit'

/**
 * Canonical JSON error body for `/api/*` handlers consumed via `fetch`.
 * Prefer this over ad-hoc `json({ error }, { status })` so clients and specs share one shape.
 *
 * Use SvelteKit `error(status, message)` only when the caller is not parsing a JSON
 * `{ error }` body (e.g. some timeline handlers already throw HttpError).
 */
export type ApiErrorBody = {
  error: string
  details?: string[]
  code?: string
}

export type ApiErrorResponse = ApiErrorBody

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  )
}

export function jsonError(
  message: string,
  status: number,
  extra?: Omit<ApiErrorBody, 'error'>,
): Response {
  const body = { error: message, ...extra } satisfies ApiErrorBody
  return json(body, { status })
}
