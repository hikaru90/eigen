import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  buildSpendPicnicProbeTexts,
  GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX,
} from '../../../evals/graph-scale/seed-corpus'
import { computeSpendTrend } from '$lib/e2e/graph-scale-spend-trend'
import { loginUser } from './test-helpers'
import {
  captureThoughtThroughUi,
  fetchSpendProbeSnapshot,
  formatGraphScaleSpendLine,
  holdHeadedBrowserForGraphReview,
  initGraphScaleSpendProbe,
  openGraphScaleSpendCapturePage,
  openGraphScaleSpendGraphPage,
  setGraphScaleSpendPageTitle,
  spendDeltaRow,
  writeGraphScaleSpendReport,
  type GraphScaleSpendReport,
} from './graph-scale-spend-helpers'

function parseCaptureCount(): number {
  const raw = process.env.GRAPH_SCALE_SPEND_CAPTURES?.trim()
  const fallback = 20
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX, Math.max(1, parsed))
}

const SPEND_ENABLED = process.env.GRAPH_SCALE_SPEND === '1'
const CAPTURE_COUNT = parseCaptureCount()

test.use({ headless: false })

test.describe('Graph-scale ingest spend', () => {
  test.describe.configure({ timeout: 3_600_000 })

  test.beforeEach(() => {
    test.skip(!SPEND_ENABLED, 'Set GRAPH_SCALE_SPEND=1 and run npm run test:e2e:graph-scale-spend')
  })

  test('captures linked picnic thoughts and logs per-ingest spend', async ({ page }, testInfo) => {
    const runId = randomUUID()
    const startedAt = new Date().toISOString()
    const texts = buildSpendPicnicProbeTexts(CAPTURE_COUNT)

    const { userId, email } = await test.step('create funded harness user', async () => {
      const user = await initGraphScaleSpendProbe(page.request)
      console.log(`[graph-scale-spend] user ${user.userId} (${user.email})`)
      console.log(`[graph-scale-spend] picnic probe (${CAPTURE_COUNT} linked captures):`)
      for (const [i, text] of texts.entries()) {
        console.log(`  ${i + 1}. ${text}`)
      }
      return user
    })

    await test.step('open login', async () => {
      await page.goto('/login')
      await expect(page).toHaveURL(/\/login/)
    })

    await test.step('sign in', async () => {
      await loginUser(page, email)
      await openGraphScaleSpendCapturePage(page)
    })

    const perThought = []
    for (let index = 0; index < texts.length; index++) {
      await test.step(`capture thought ${index + 1}/${texts.length} in UI`, async () => {
        const label = `Graph-scale spend · capture ${index + 1}/${texts.length}`
        await setGraphScaleSpendPageTitle(page, label)

        const spendBefore = await fetchSpendProbeSnapshot(page.request, userId)

        const capture = await captureThoughtThroughUi(page, texts[index])

        const spendAfter = await fetchSpendProbeSnapshot(page.request, userId)
        const row = spendDeltaRow({
          index,
          thoughtId: capture.thoughtId,
          before: spendBefore,
          after: spendAfter,
          wallMs: capture.wallMs,
          entityCount: capture.entityCount,
        })
        perThought.push(row)
        console.log(formatGraphScaleSpendLine(row))

        expect(row.thoughtId).toBeTruthy()
        expect(Number(row.usd)).toBeGreaterThan(0)
        expect(row.credits).toBeGreaterThan(0)

        console.log(
          `[graph-scale-spend] activity total credits now ${spendAfter.totalCredits} (${spendAfter.callCount} calls)`,
        )
      })
    }

    const trend = computeSpendTrend(perThought)
    const report: GraphScaleSpendReport = {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      userId,
      email,
      thoughtCount: perThought.length,
      probeSuite: 'picnic-linked',
      probeTexts: texts,
      perThought,
      totals: {
        sumUsd: trend.sumUsd,
        sumCredits: trend.sumCredits,
        sumWallMs: trend.sumWallMs,
      },
      trend: {
        firstHalfAvgUsd: trend.firstHalfAvgUsd,
        secondHalfAvgUsd: trend.secondHalfAvgUsd,
        deltaUsd: trend.deltaUsd,
        minUsd: trend.minUsd,
        maxUsd: trend.maxUsd,
        perStepDeltaUsd: trend.perStepDeltaUsd,
        moreExpensiveOverTime: trend.moreExpensiveOverTime,
      },
    }

    let reportPath = ''
    await test.step('write spend report', async () => {
      expect(perThought).toHaveLength(CAPTURE_COUNT)
      expect(trend.sumCredits).toBeGreaterThan(0)
      reportPath = writeGraphScaleSpendReport(report)
    })

    await test.step('review stored graph (close browser when done)', async () => {
      testInfo.setTimeout(0)
      await openGraphScaleSpendGraphPage(page)
      await holdHeadedBrowserForGraphReview(page, reportPath)
    })
  })
})
