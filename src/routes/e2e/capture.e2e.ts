import { expect, test } from '@playwright/test'
import { expectKeptThought, registerUser, waitForNewUserThoughtId } from './test-helpers'

/**
 * The ei Capture design: interpretation moves up front (debounced while typing) via
 * POST /api/capture/read — a preview that persists nothing. Pressing Capture keeps
 * the already-accepted reading in ONE call (POST /api/capture/keep) — no confirmation
 * modal. Verbatim invariant: raw_text keeps the typed words, the accepted reading goes
 * to normalized_text. Offline / stale readings fall back to the client capture queue
 * (POST /api/capture/submit, unchanged payload).
 */

const TYPE_TEXT = 'I need to review the Q3 budget report'

/** Mirrors categoryLabel in src/lib/capture/reading-state.ts (render-only prettify of a key). */
function categoryLabelForE2e(key: string): string {
  const t = key.trim().replace(/_+/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/** Endpoints that persist a thought row; none may be called while the mesh only reads. */
const PERSISTING = ['/api/capture/keep', '/api/capture/submit', '/api/capture/interpret', '/api/capture/confirm']

function trackPersistingCalls(page: import('@playwright/test').Page) {
  const calls: string[] = []
  page.on('request', (req) => {
    if (req.method() !== 'POST') return
    const url = req.url()
    if (PERSISTING.some((p) => url.includes(p))) calls.push(url)
  })
  return calls
}

/** Type into the writer and wait for the debounced read pass to answer. */
async function typeAndWaitForReading(page: import('@playwright/test').Page, raw: string) {
  await page.fill('[data-testid="capture-input"]', raw)
  const readRes = await page.waitForResponse(
    (res) => res.url().includes('/api/capture/read') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  const body = (await readRes.json()) as { preview?: { category?: { key?: string } } }
  await expect(page.getByTestId('capture-reading')).toContainText('Sounds like')
  return body.preview
}

async function captureAndWaitForKept(page: import('@playwright/test').Page, raw: string) {
  await typeAndWaitForReading(page, raw)
  const keepPromise = page.waitForResponse(
    (res) => res.url().includes('/api/capture/keep') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  // submission is the confirmation: one press, one keep call, no modal
  await page.getByTestId('capture-submit').click()
  const keepRes = await keepPromise
  expect(keepRes.ok()).toBe(true)
  await expect(page.getByTestId('capture-confirmation-modal')).toHaveCount(0)
  // Capture does not show the thought again: the writer empties and the heading returns
  await expect(page.getByTestId('capture-input')).toHaveValue('')
  await expect(page.getByTestId('capture-heading')).toBeVisible({ timeout: 30_000 })
  return (await keepRes.json()) as { thoughtId: string; rawText: string; normalizedText: string }
}

test.describe('Capture flow (AC-001, AC-004, ei decision #3: read → keep)', () => {
  test('reading while typing persists nothing — only /api/capture/read is called', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')
    const persisting = trackPersistingCalls(page)

    let releaseRead: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    await page.route('**/api/capture/read', async (route) => {
      await held
      await route.continue()
    })

    await page.fill('[data-testid="capture-input"]', 'Immediate feedback thought about the Hamburg workshop')

    const reading = page.getByTestId('capture-reading')
    await expect(reading).toBeVisible()
    await expect(reading).toContainText('Interpreting')

    // once the read pass answers, the reading names how it will be kept
    releaseRead()
    await expect(reading).toContainText('Sounds like')
    await expect(page.getByTestId('capture-reading-type')).toBeVisible()
    await expect(page.getByTestId('capture-reading-thread')).toContainText('loose')

    // nothing was stored: no keep/submit/interpret/confirm while reading
    expect(persisting).toEqual([])
  })

  test('user types, sees the reading, and Capture keeps it with one call and no modal', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')
    const persisting = trackPersistingCalls(page)

    const kept = await captureAndWaitForKept(page, TYPE_TEXT)

    // exactly one persisting call, and it was keep
    expect(persisting.filter((u) => u.includes('/api/capture/keep'))).toHaveLength(1)
    expect(persisting).toHaveLength(1)
    // verbatim invariant: the typed words are the raw text
    expect(kept.rawText).toBe(TYPE_TEXT)
    expect(kept.normalizedText.trim().length).toBeGreaterThan(0)

    await expectKeptThought(page, kept.thoughtId, 'Q3 budget report')
  })

  test('a chosen type is carried into keep; stale input falls back to the submit queue', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    // Gate the read pass so the reading state is deterministic.
    let gate: Promise<void> = Promise.resolve()
    let releaseGate: () => void = () => {}
    const hold = () => {
      gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
    }
    await page.route('**/api/capture/read', async (route) => {
      await gate
      await route.continue()
    })

    // Phase 1 — fresh reading: open the type menu, pick one of the LLM's own alternatives,
    // and Capture keeps it with the one keep call carrying the chosen key.
    hold()
    await page.fill('[data-testid="capture-input"]', TYPE_TEXT)
    await expect(page.getByTestId('capture-reading')).toContainText('Interpreting')
    releaseGate()
    const readRes = await page.waitForResponse(
      (res) => res.url().includes('/api/capture/read') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    const readBody = (await readRes.json()) as {
      preview: { category: { key: string; alternatives: Array<{ key: string }> } }
    }
    const primary = readBody.preview.category.key
    const alternative = readBody.preview.category.alternatives.find((a) => a.key !== primary)
    let expectedKey = primary
    if (alternative) {
      await page.getByTestId('capture-reading-type').click()
      await page
        .getByRole('menuitemradio', { name: categoryLabelForE2e(alternative.key) })
        .click()
      await expect(page.getByTestId('capture-reading-type')).toContainText(
        categoryLabelForE2e(alternative.key),
      )
      expectedKey = alternative.key
    } else {
      test.info().annotations.push({
        type: 'note',
        description: `interpret offered no alternatives for "${primary}" — type pick not exercised`,
      })
    }
    const keepPromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/keep') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByTestId('capture-submit').click()
    const keepRes = await keepPromise
    const keepReq = keepRes.request().postDataJSON() as {
      raw: string
      reading: { category: { key: string }; interpretedText: string }
    }
    expect(keepReq.raw).toBe(TYPE_TEXT)
    expect(keepReq.reading.category.key).toBe(expectedKey)
    if (alternative) expect(keepReq.reading.category.key).not.toBe(primary)
    const kept = (await keepRes.json()) as { category: string; thoughtId: string }
    expect(kept.category).toBe(expectedKey)
    await expect(page.getByTestId('capture-input')).toHaveValue('')

    // Phase 2 — the read pass never answers (held): Capture enqueues the raw text through
    // the client capture queue instead of keeping a reading nobody saw.
    hold()
    await page.fill('[data-testid="capture-input"]', 'A second thought about the offline capture queue')
    await expect(page.getByTestId('capture-reading')).toContainText('Interpreting')
    const submitPromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/submit') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByTestId('capture-submit').click()
    await submitPromise
    await expect(page.getByTestId('capture-input')).toHaveValue('')
    const queuedId = await waitForNewUserThoughtId(page, [kept.thoughtId])
    await expectKeptThought(page, queuedId, /offline capture queue/i)
  })

  test('a failing follow-up after a 2xx keep never puts the words back — exactly one row', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')
    const persisting = trackPersistingCalls(page)

    // the settled-summary GET fails after keep succeeded (transient network error)
    await page.route('**/api/capture/result/**', (route) => route.abort('failed'))

    await typeAndWaitForReading(page, TYPE_TEXT)
    const keepPromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/keep') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByTestId('capture-submit').click()
    expect((await keepPromise).ok()).toBe(true)

    // the row is kept: the field stays empty, an explicit error shows, and pressing
    // Capture again does nothing (there are no words to keep twice)
    await expect(page.locator('[data-testid="capture-input"]')).toHaveValue('')
    await expect(page.locator('.page-error')).toBeVisible({ timeout: 10_000 })
    // the empty writer offers the mic, not a send action; Enter keeps nothing
    await expect(page.getByTestId('capture-submit')).toHaveCount(0)
    await page.getByTestId('capture-input').press('Enter')
    await page.waitForTimeout(500)
    expect(persisting.filter((u) => u.includes('/api/capture/keep'))).toHaveLength(1)
    expect(persisting).toHaveLength(1)
  })

  test('action-item captures succeed through read → keep (category repair/retry)', async ({
    page,
    context,
  }) => {
    // Models often invent out-of-set keys like "action"; read must repair/retry, not 500.
    await registerUser(context, page)
    await page.goto('/capture')

    const kept = await captureAndWaitForKept(
      page,
      'Action item: follow up with the Lisbon design team about the Q3 budget report',
    )

    await expectKeptThought(page, kept.thoughtId, /Lisbon design team/i)
  })

  test('user can edit a stored thought with a natural-language request', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    const kept = await captureAndWaitForKept(page, 'Meeting with design team tomorrow at 2pm')
    // editing lives on the thought page now, not on Capture
    await expectKeptThought(page, kept.thoughtId, /design team/i)

    const editResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/edit') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByTestId('thought-edit').click()
    const field = page.getByTestId('thought-edit-field')
    await expect(field).toBeVisible()
    await field.fill('Meeting with the design team tomorrow at 2pm, formally')
    await field.press('Enter')
    expect((await editResPromise).ok()).toBe(true)
    await expect(page.getByTestId('thought-text')).toContainText(/design team/i, { timeout: 30_000 })
  })

  test('capture field is sized by CSS and never clips text on viewport resize', async ({
    context,
    page,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    const field = page.getByTestId('capture-input')
    await expect(field).toBeVisible()

    // CSS owns sizing: the interactivity layer must not write inline heights,
    // and the browser must size the field by its content (field-sizing).
    expect(await field.evaluate((el) => el.style.height)).toBe('')
    expect(await field.evaluate((el) => getComputedStyle(el).fieldSizing)).toBe('content')

    // long text grows the field; resizing the window never hides words —
    // content is either fully visible or scrollable, never clipped away.
    const lines = Array.from({ length: 9 }, (_, i) => `thought line ${i + 1}`).join('\n')
    await field.fill(lines)

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 500 },
      { width: 1440, height: 900 },
      { width: 800, height: 400 },
    ]) {
      await page.setViewportSize(viewport)
      await page.waitForTimeout(150)
      const accessible = await field.evaluate((el) => {
        const cs = getComputedStyle(el)
        return cs.overflowY === 'auto' || cs.overflowY === 'scroll' || el.scrollHeight <= el.clientHeight + 1
      })
      expect(accessible, `text accessible at ${viewport.width}x${viewport.height}`).toBe(true)
    }

    // still no inline height after all interactions — sizing stayed in CSS
    expect(await field.evaluate((el) => el.style.height)).toBe('')
  })
})
