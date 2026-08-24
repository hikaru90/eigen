/**
 * POST /api/admin/consolidate
 *
 * Trigger the consolidation pipeline for one user or all users.
 * Authenticated with an admin API key (X-Admin-Key header) or a valid user
 * session — admin key allows running for any/all users, session restricts
 * to the authenticated user only.
 *
 * Request body (JSON, optional):
 *   { userId?: string }  — omit to run for all users (admin key required)
 *
 * Global all-users runs are idempotent per calendar night (CONSOLIDATION_CRON_TZ).
 * Scheduled via pg_cron → pg_net HTTP POST (see scripts/ensure-sleep-cron.mjs).
 */

import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import {
  tryAcquireGlobalNightlyRun,
  completeGlobalNightlyRun,
  failGlobalNightlyRun,
} from '$lib/server/consolidation/consolidation-run-ledger'
import { consolidateForUser, consolidateAllUsers } from '$lib/server/consolidation/runner'

function getAdminKey(): string | undefined {
  return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  const adminKey = event.request.headers.get('x-admin-key')?.trim()
  const configuredAdminKey = getAdminKey()

  const isAdminKeyValid = configuredAdminKey && adminKey === configuredAdminKey
  const isAuthenticated = !!user

  if (!isAdminKeyValid && !isAuthenticated) {
    error(401, 'Unauthorized')
  }

  let body: { userId?: string } = {}
  try {
    const raw = await event.request.text()
    if (raw.trim()) body = JSON.parse(raw)
  } catch {
    // Body is optional; empty body means "run for all" (admin) or "run for me" (user).
  }

  const targetUserId = body.userId ?? (isAdminKeyValid ? undefined : user?.id)

  try {
    if (targetUserId) {
      if (!isAdminKeyValid && user?.id !== targetUserId) {
        error(403, 'Forbidden')
      }
      const result = await consolidateForUser(targetUserId)
      return json({ ok: true, results: [result] })
    }

    if (!isAdminKeyValid) {
      error(403, 'Admin key required to run consolidation for all users')
    }

    let ledger: Awaited<ReturnType<typeof tryAcquireGlobalNightlyRun>> | undefined
    try {
      ledger = await tryAcquireGlobalNightlyRun()
    } catch (ledgerErr) {
      console.warn('[consolidate] ledger unavailable, proceeding without idempotency', {
        message: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
      })
    }

    if (ledger && !ledger.acquired) {
      return json({
        ok: true,
        skipped: true,
        reason: ledger.reason,
        runNight: ledger.runNight,
      })
    }

    try {
      const results = await consolidateAllUsers()
      if (ledger?.acquired) {
        await completeGlobalNightlyRun(ledger.runId, results)
      }
      return json({
        ok: true,
        results,
        ...(ledger ? { runNight: ledger.runNight, runId: ledger.runId } : {}),
      })
    } catch (runErr) {
      if (ledger?.acquired) {
        const message = runErr instanceof Error ? runErr.message : String(runErr)
        await failGlobalNightlyRun(ledger.runId, message).catch(() => {})
      }
      throw runErr
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err
    console.error('[consolidate] endpoint error', {
      message: err instanceof Error ? err.message : String(err),
    })
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Consolidation failed',
      },
      { status: 500 },
    )
  }
}
