import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { editStoredThought } from '$lib/server/capture/service'
import type { CaptureProgressEvent } from '$lib/server/capture/service'
import {
  appSql,
  appDbAsyncLocal,
  createScopedDrizzle,
  activateTenantDbSession,
  deactivateTenantDbSession,
} from '$lib/server/db'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  const b =
    typeof body === 'object' && body ? (body as { thoughtId?: unknown; editRequest?: unknown }) : {}
  const thoughtId = typeof b.thoughtId === 'string' ? b.thoughtId : ''
  const editRequest = typeof b.editRequest === 'string' ? b.editRequest : ''
  if (!thoughtId) error(400, 'thoughtId is required')
  if (!editRequest.trim()) error(400, 'editRequest is required')

  const accept = event.request.headers?.get('accept') ?? ''
  const streamNdjson = accept.includes('application/x-ndjson')

  if (!streamNdjson) {
    try {
      const result = await runWithTrace(crypto.randomUUID(), () =>
        editStoredThought(user.id, thoughtId, editRequest),
      )
      if (!result.ok) error(404, 'Thought not found')
      return json({ thought: result.thought })
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
        throw err
      }
      const message = err instanceof Error ? err.message : 'Failed to update thought'
      console.error('[capture.edit.api] failed', {
        userId: user.id,
        thoughtId,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      })
      error(500, message)
    }
  }

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(
    {},
    { highWaterMark: 64 },
  )
  const writer = writable.getWriter()

  const writeRaw = (payload: unknown) => {
    writer.write(encoder.encode(`${JSON.stringify(payload)}\n`)).catch(() => {})
  }

  const onProgress = async (ev: CaptureProgressEvent) => {
    if (ev.parallel) {
      writeRaw({ type: 'progress_parallel', phases: ev.phases })
    } else {
      writeRaw({ type: 'progress', phase: ev.phase })
    }
  }

  const editWork = (async () => {
    let reserved: Awaited<ReturnType<typeof appSql.reserve>> | null = null
    try {
      reserved = await appSql.reserve()
      await activateTenantDbSession(reserved, user.id)
      const scopedDb = createScopedDrizzle(reserved)
      const result = await appDbAsyncLocal.run(scopedDb, () =>
        runWithTrace(crypto.randomUUID(), () =>
          editStoredThought(user.id, thoughtId, editRequest, { onProgress }),
        ),
      )
      if (!result.ok) {
        writeRaw({ type: 'error', error: 'Thought not found', details: [] })
      } else {
        writeRaw({ type: 'done', thought: result.thought })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update thought'
      console.error('[capture.edit.api] stream failed', {
        userId: user.id,
        thoughtId,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      })
      writeRaw({ type: 'error', error: message, details: [] })
    } finally {
      if (reserved) {
        await deactivateTenantDbSession(reserved).catch(() => {})
        await reserved.release()
      }
      await writer.close().catch(() => {})
    }
  })()

  editWork.catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[capture.edit.api] editWork rejected', {
      userId: user.id,
      thoughtId,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
    writer.close().catch(() => {})
  })

  event.request.signal.addEventListener('abort', () => {
    writer.abort(new Error('client disconnected')).catch(() => {})
  })

  return new Response(readable, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
}
