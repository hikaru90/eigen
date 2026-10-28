import { and, eq } from 'drizzle-orm'
import { loadRecentCaptureThoughts } from '$lib/server/capture/load-recent-capture-thoughts'
import {
  generateReflectionPrompts,
  resolveTodaysReflectionPrompts,
  type ReflectionContext,
  type ReflectionPromptsResult,
} from '$lib/server/capture/reflection-prompts'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { captureReflectionPrompt, userPreference } from '$lib/server/db/schema'
import { loadDailyDigest } from '$lib/server/memory/daily-digest'
import { localDayKey } from '$lib/server/memory/timeline-today-server'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

const TABLE = 'capture_reflection_prompt'
const COLUMN = 'prompts'

async function todayKey(userId: string, now: Date): Promise<string> {
  return localDayKey(now.toISOString(), await getUserPreferredTimezone(userId))
}

async function readRow(userId: string, day: string) {
  const [row] = await getDb()
    .select({
      promptsEncrypted: captureReflectionPrompt.promptsEncrypted,
      dismissedAt: captureReflectionPrompt.dismissedAt,
    })
    .from(captureReflectionPrompt)
    .where(and(eq(captureReflectionPrompt.userId, userId), eq(captureReflectionPrompt.day, day)))
    .limit(1)
  if (!row) return null
  const prompts = row.promptsEncrypted
    ? (JSON.parse(
        await decryptTenantValue({
          userId,
          table: TABLE,
          column: COLUMN,
          ciphertext: row.promptsEncrypted,
        }),
      ) as string[])
    : null
  return { prompts, dismissed: row.dismissedAt !== null }
}

async function loadContext(userId: string, now: Date): Promise<ReflectionContext> {
  const timeZone = await getUserPreferredTimezone(userId)
  const [digest, { recentThoughts }, [pref]] = await Promise.all([
    loadDailyDigest(userId, timeZone, now),
    loadRecentCaptureThoughts(userId),
    getDb()
      .select({ language: userPreference.preferredLanguage })
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .limit(1),
  ])
  return {
    language: pref?.language ?? 'en',
    projects: digest.projects.map((p) => ({ label: p.label, nextAction: p.nextAction })),
    stalled: digest.stalled.map((s) => ({ label: s.label, reason: s.reason })),
    recent: recentThoughts.map((t) => t.normalizedText),
  }
}

/** Today's prompts for Capture: stored, dismissed, nothing to reflect on, or freshly written. */
export async function loadTodaysReflectionPrompts(
  userId: string,
  now = new Date(),
): Promise<ReflectionPromptsResult> {
  const day = await todayKey(userId, now)
  return resolveTodaysReflectionPrompts({
    readRow: () => readRow(userId, day),
    loadContext: () => loadContext(userId, now),
    generate: (context) => generateReflectionPrompts({ userId, context }),
    writePrompts: async (prompts) => {
      const promptsEncrypted = await encryptTenantValue({
        userId,
        table: TABLE,
        column: COLUMN,
        plaintext: JSON.stringify(prompts),
      })
      await getDb()
        .insert(captureReflectionPrompt)
        .values({ userId, day, promptsEncrypted })
        .onConflictDoNothing()
      // a parallel load may have stored first: show the stored set
      return (await readRow(userId, day))?.prompts ?? prompts
    },
  })
}

/** "Not today": hides today's prompts, and keeps a dismissed day from generating. */
export async function dismissTodaysReflectionPrompts(
  userId: string,
  now = new Date(),
): Promise<void> {
  const day = await todayKey(userId, now)
  await getDb()
    .insert(captureReflectionPrompt)
    .values({ userId, day, dismissedAt: now })
    .onConflictDoUpdate({
      target: [captureReflectionPrompt.userId, captureReflectionPrompt.day],
      set: { dismissedAt: now },
    })
}
