import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import type { SpendProbeThoughtRow } from '$lib/e2e/graph-scale-spend-trend'
import type { ActivityCostAggregate } from '$lib/server/activity/trace-cost'

export type SpendProbeUser = {
  userId: string
  email: string
}

export type GraphScaleSpendReport = {
  runId: string
  startedAt: string
  finishedAt: string
  userId: string
  email: string
  thoughtCount: number
  probeSuite: 'picnic-linked'
  probeTexts: string[]
  perThought: SpendProbeThoughtRow[]
  totals: {
    sumUsd: string
    sumCredits: number
    sumWallMs: number
  }
  trend: {
    firstHalfAvgUsd: number
    secondHalfAvgUsd: number
    deltaUsd: number
    minUsd: number
    maxUsd: number
    perStepDeltaUsd: number[]
    moreExpensiveOverTime: boolean
  }
}

function isTransientSpendApiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /socket hang up|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(message)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function withSpendApiRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isTransientSpendApiError(err) || attempt === attempts) break
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.warn(
        `[graph-scale-spend] ${label} attempt ${attempt}/${attempts} failed` +
          ` (${err instanceof Error ? err.message : String(err)}); retry in ${delayMs}ms`,
      )
      await sleep(delayMs)
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `${label} failed after ${attempts} attempts: ${detail}. ` +
      'Ensure `npm run dev` is running and Postgres is up.',
  )
}

export async function initGraphScaleSpendProbe(
  request: APIRequestContext,
): Promise<SpendProbeUser> {
  return withSpendApiRetry('spend/init', async () => {
    const res = await request.post('/api/e2e/graph-scale/spend/init')
    if (!res.ok()) {
      throw new Error(`graph-scale spend init failed (${res.status()}): ${await res.text()}`)
    }
    return (await res.json()) as SpendProbeUser
  })
}

export async function fetchSpendProbeSnapshot(
  request: APIRequestContext,
  userId: string,
): Promise<ActivityCostAggregate> {
  return withSpendApiRetry(`spend/snapshot (${userId})`, async () => {
    const res = await request.get(
      `/api/e2e/graph-scale/spend/snapshot?userId=${encodeURIComponent(userId)}`,
    )
    if (!res.ok()) {
      throw new Error(`graph-scale spend snapshot failed (${res.status()}): ${await res.text()}`)
    }
    return (await res.json()) as ActivityCostAggregate
  })
}

export function spendDeltaRow(input: {
  index: number
  thoughtId: string
  before: ActivityCostAggregate
  after: ActivityCostAggregate
  wallMs: number
  entityCount: number
}): SpendProbeThoughtRow {
  const usdDelta = Math.max(0, Number(input.after.totalUsd) - Number(input.before.totalUsd))
  const creditsDelta = Math.max(0, input.after.totalCredits - input.before.totalCredits)
  return {
    index: input.index,
    thoughtId: input.thoughtId,
    groupId: 'ui-capture',
    usd: usdDelta.toFixed(6),
    credits: creditsDelta,
    wallMs: input.wallMs,
    entityCount: input.entityCount,
    byOperation: {},
  }
}

export function formatGraphScaleSpendLine(row: SpendProbeThoughtRow): string {
  return (
    `[graph-scale-spend] #${row.index + 1} usd=${row.usd} credits=${row.credits}` +
    ` wallMs=${row.wallMs} entities=${row.entityCount} thoughtId=${row.thoughtId}`
  )
}

export function formatGraphScaleSpendSummary(report: GraphScaleSpendReport): string {
  const { trend, totals } = report
  const direction = trend.moreExpensiveOverTime ? 'more expensive' : 'not more expensive'
  return (
    `[graph-scale-spend] done · ${report.thoughtCount} thoughts · ` +
    `total ${totals.sumCredits} credits ($${totals.sumUsd}) · ` +
    `first-half avg $${trend.firstHalfAvgUsd.toFixed(6)} · ` +
    `second-half avg $${trend.secondHalfAvgUsd.toFixed(6)} · ` +
    `delta $${trend.deltaUsd.toFixed(6)} (${direction}) · ` +
    `range $${trend.minUsd.toFixed(6)}–$${trend.maxUsd.toFixed(6)}`
  )
}

const GRAPH_UI_TIMEOUT_MS = 120_000

/** Persist spend report JSON under evals/graph-scale/runs/. */
export function writeGraphScaleSpendReport(report: GraphScaleSpendReport): string {
  console.info(
    report.perThought.map((row) => ({
      '#': row.index + 1,
      usd: row.usd,
      credits: row.credits,
      wallMs: row.wallMs,
      entities: row.entityCount,
    })),
  )
  console.info(formatGraphScaleSpendSummary(report))

  const reportDir = join(process.cwd(), 'evals/graph-scale/runs')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `spend-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.info(`[graph-scale-spend] report ${reportPath}`)
  return reportPath
}

/** Memory graph tab — for headed review after ingest. */
export async function openGraphScaleSpendGraphPage(page: Page): Promise<void> {
  await page.goto('/memory', { waitUntil: 'domcontentloaded', timeout: GRAPH_UI_TIMEOUT_MS })
  await expect(page).toHaveURL(/\/memory/, { timeout: GRAPH_UI_TIMEOUT_MS })
  await page.getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Search nodes', exact: true })).toBeVisible({
    timeout: GRAPH_UI_TIMEOUT_MS,
  })
  await expect(page.locator('canvas, svg').first()).toBeVisible({ timeout: GRAPH_UI_TIMEOUT_MS })
  await setGraphScaleSpendPageTitle(page, 'Graph-scale spend · review graph')
}

/** Keep headed browser open until the operator closes it. */
export async function holdHeadedBrowserForGraphReview(
  page: Page,
  reportPath: string,
): Promise<void> {
  console.info(`[graph-scale-spend] report saved: ${reportPath}`)
  console.info('[graph-scale-spend] graph open — close the browser window when finished reviewing.')
  await page.context().waitForEvent('close')
}

/** Open capture so headed runs show the app instead of about:blank. */
export async function openGraphScaleSpendCapturePage(page: Page): Promise<void> {
  await page.goto('/capture')
  await expect(
    page.getByRole('dialog', { name: /Your memory, not theirs\.|Just drop it in\./ }),
  ).toBeHidden({
    timeout: 15_000,
  })
  await expect(page.getByText('Before your first capture')).toBeHidden()
}

export async function openGraphScaleSpendActivityPage(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 15_000
  await page.goto('/activity', { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  await expect(page.getByText('Available credits:')).toBeVisible({ timeout: timeoutMs })
  await expect(page.getByText('Total spend (credits):')).toBeVisible({ timeout: timeoutMs })
}

export async function setGraphScaleSpendPageTitle(page: Page, label: string): Promise<void> {
  await page.evaluate((text) => {
    document.title = text
  }, label)
}

/**
 * Capture through the real Capture UI (ei redesign decision #3, read → keep): type, wait
 * for the up-front reading (POST /api/capture/read — a preview, persists nothing), press
 * Capture — ONE POST /api/capture/keep persists the accepted reading — watch the thought
 * settle inline, then wait until indexing finishes (API + the on-screen indexing words).
 */
export async function captureThoughtThroughUi(
  page: Page,
  rawText: string,
): Promise<{ thoughtId: string; wallMs: number; entityCount: number }> {
  const trimmed = rawText.trim()
  if (!trimmed) {
    throw new Error('captureThoughtThroughUi: rawText is required')
  }

  if (!page.url().includes('/capture')) {
    await openGraphScaleSpendCapturePage(page)
  }

  const startedAt = Date.now()
  const input = page.getByTestId('capture-input')
  const captureBtn = page.getByTestId('capture-submit')
  const errorBanner = page.locator('.page-error').first()

  // listener first: the debounced read can answer before the fill settles
  const readResponsePromise = page.waitForResponse(
    (res) => {
      if (!res.url().includes('/api/capture/read') || res.request().method() !== 'POST') {
        return false
      }
      const sent = res.request().postDataJSON() as { raw?: string } | null
      return sent?.raw === trimmed
    },
    { timeout: 300_000 },
  )
  await input.fill(trimmed)
  await expect(captureBtn).toBeEnabled({ timeout: 30_000 })

  const readRes = await readResponsePromise
  if (!readRes.ok()) {
    throw new Error((await readRes.text()).trim() || `Capture read failed (${readRes.status()})`)
  }
  // the reading names how the words will be kept — nothing is stored yet
  await expect(page.getByTestId('capture-reading')).toContainText(/Sounds like|Klingt wie/, {
    timeout: 60_000,
  })

  const persistedPromise = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      (res.url().includes('/api/capture/keep') || res.url().includes('/api/capture/submit')),
    { timeout: 300_000 },
  )
  await captureBtn.click()
  const keepRes = await persistedPromise
  if (keepRes.url().includes('/api/capture/submit')) {
    throw new Error(
      'Capture enqueued the raw text through /api/capture/submit instead of keeping the reading',
    )
  }
  const keepBody = await keepRes.text()
  if (!keepRes.ok()) {
    if (await errorBanner.isVisible().catch(() => false)) {
      const message = (await errorBanner.textContent())?.trim()
      if (message) throw new Error(`Capture failed: ${message}`)
    }
    throw new Error(keepBody.trim() || `Capture keep failed (${keepRes.status()})`)
  }

  // ConfirmCaptureResult (src/lib/server/capture/capture-confirmation.ts)
  const keepJson = JSON.parse(keepBody) as {
    thoughtId?: string
    rawText?: string
    normalizedText?: string
    category?: string
    queueStatus?: string
    error?: string
  }
  if (keepJson.error) throw new Error(keepJson.error)
  const thoughtId = keepJson.thoughtId ?? ''
  if (!thoughtId) {
    if (await errorBanner.isVisible().catch(() => false)) {
      const message = (await errorBanner.textContent())?.trim()
      throw new Error(message ? `Capture failed: ${message}` : 'Capture failed')
    }
    throw new Error('Capture keep succeeded but returned no thought id')
  }
  expect(keepJson.rawText).toBe(trimmed)

  // the kept thought settles inline — no modal, no card pile
  await expect(page.getByTestId('capture-confirmation-modal')).toHaveCount(0)
  const settled = page.getByTestId('capture-settled')
  await expect(settled.getByTestId('capture-settled-open')).toHaveAttribute(
    'href',
    new RegExp(`/thought/${thoughtId}$`),
    { timeout: 60_000 },
  )
  await expect(settled).not.toContainText('Indexing failed', { timeout: 5_000 })

  await expect
    .poll(
      async () => {
        const result = await page.evaluate(async (id) => {
          const res = await fetch(`/api/capture/result/${encodeURIComponent(id)}`)
          if (!res.ok) return null
          const body = (await res.json()) as {
            thought?: { enrichmentComplete?: boolean; entities?: unknown[] }
          }
          return body.thought ?? null
        }, thoughtId)

        return result?.enrichmentComplete === true ? result : null
      },
      { timeout: 300_000, intervals: [1000, 2000, 3000] },
    )
    .not.toBeNull()

  // the indexing words under the settled block rest once enrichment is complete
  await expect(settled.getByTestId('capture-indexing-message')).toBeHidden({ timeout: 300_000 })

  const resultBody = await page.evaluate(async (id) => {
    const res = await fetch(`/api/capture/result/${encodeURIComponent(id)}`)
    if (!res.ok) {
      throw new Error(`capture result failed (${res.status})`)
    }
    return (await res.json()) as {
      thought: { enrichmentComplete: boolean; entities: unknown[] }
    }
  }, thoughtId)

  expect(resultBody.thought.enrichmentComplete).toBe(true)

  return {
    thoughtId,
    wallMs: Date.now() - startedAt,
    entityCount: resultBody.thought.entities.length,
  }
}
