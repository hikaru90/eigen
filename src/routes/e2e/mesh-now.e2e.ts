import { expect, test, type Page, type Route } from '@playwright/test'
import { registerUser } from './test-helpers'

/**
 * Lightning questions on Yarn (docs/planning/feature-mesh-now.md section 7). The Now API is
 * stubbed with page.route (no LLM, no deck in the database); the page, the card, History and
 * the Mesh search are real. "Too big reaches Ask" belongs to build step 6 and is not here.
 */

type Kind = 'do' | 'sort' | 'file' | 'unblock'
const ANSWERS: Record<Kind, string[]> = {
  do: ['done', 'not_now', 'too_big'],
  sort: ['done', 'drop', 'keep'],
  file: ['yes', 'other_project', 'not_a_task'],
  unblock: ['yes', 'something_else', 'someday', 'finished'],
}

function card(id: string, kind: Kind, text: string) {
  return {
    state: 'card',
    card: { id, kind, text, why: `Why ${id}`, project: null, answers: ANSWERS[kind] },
    remaining: 1,
    candidatesOmitted: 0,
  }
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

type Counters = { get: number; answers: string[]; undos: string[] }

/** Stubs the three Now endpoints; `getBodies` are served to GET /api/mesh/now in order. */
async function stubNow(
  page: Page,
  getBodies: Array<{ status: number; body: unknown }>,
  answerBodies: unknown[] = [],
): Promise<Counters> {
  const counters: Counters = { get: 0, answers: [], undos: [] }
  await page.route('**/api/mesh/now', (route) => {
    const next = getBodies[Math.min(counters.get, getBodies.length - 1)]
    counters.get += 1
    return json(route, next.status, next.body)
  })
  await page.route('**/api/mesh/now/cards/*/answer', (route) => {
    counters.answers.push(route.request().postData() ?? '')
    return json(route, 200, answerBodies.shift())
  })
  await page.route('**/api/mesh/now/cards/*/undo', (route) => {
    counters.undos.push(route.request().url())
    return json(route, 200, card('c1', 'do', 'Send the signed form'))
  })
  await page.route('**/api/mesh/now/history*', (route) => json(route, 200, { items: [], nextCursor: null }))
  return counters
}

test.describe('Lightning questions on Yarn', () => {
  test.beforeEach(async ({ context, page }) => {
    await registerUser(context, page)
  })

  test('the card shows above the "Captured thoughts" label and the list', async ({ page }) => {
    await stubNow(page, [{ status: 200, body: card('c1', 'do', 'Send the signed form') }])
    await page.goto('/mesh/yarn')

    const now = page.getByTestId('now-card')
    await expect(now.getByText('Send the signed form')).toBeVisible()
    await expect(now.getByText('Lightning questions')).toBeVisible()
    const label = page.getByText('Captured thoughts')
    await expect(label).toBeVisible()
    const nowBox = await now.boundingBox()
    const labelBox = await label.boundingBox()
    expect(nowBox!.y + nowBox!.height).toBeLessThanOrEqual(labelBox!.y)
    await expect(page.getByRole('tab', { name: 'Yarn' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Threads' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Patterns' })).toBeVisible()
  })

  test('Done brings the next card; Undo brings the first back', async ({ page }) => {
    const counters = await stubNow(
      page,
      [{ status: 200, body: card('c1', 'do', 'Send the signed form') }],
      [{ ...card('c2', 'sort', 'Change the key battery'), undo: { cardId: 'c1' } }],
    )
    await page.goto('/mesh/yarn')
    await page.getByRole('button', { name: 'Done' }).click()

    await expect(page.getByText('Change the key battery')).toBeVisible()
    await expect(page.getByText('Marked done')).toBeVisible()
    expect(JSON.parse(counters.answers[0])).toEqual({ answer: 'done' })

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Send the signed form')).toBeVisible()
    expect(counters.undos).toHaveLength(1)
    expect(counters.undos[0]).toContain('/cards/c1/undo')
  })

  test('Not now moves on with no Undo', async ({ page }) => {
    await stubNow(
      page,
      [{ status: 200, body: card('c1', 'do', 'Send the signed form') }],
      [{ ...card('c2', 'do', 'Call the landlord'), undo: null }],
    )
    await page.goto('/mesh/yarn')
    await page.getByRole('button', { name: 'Not now' }).click()

    await expect(page.getByText('Call the landlord')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  })

  test('502 shows Try again while the list stays usable', async ({ page }) => {
    await stubNow(page, [
      { status: 502, body: { error: 'The model failed 3 times' } },
      { status: 200, body: card('c1', 'do', 'Send the signed form') },
    ])
    await page.goto('/mesh/yarn')

    await expect(page.getByText('The model failed 3 times')).toBeVisible()
    await expect(page.getByText('Captured thoughts')).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Send the signed form')).toBeVisible()
  })

  test('search hides Now and History and closing it brings the same card back with no new request', async ({ page }) => {
    const counters = await stubNow(page, [{ status: 200, body: card('c1', 'do', 'Send the signed form') }])
    await page.goto('/mesh/yarn')
    await expect(page.getByText('Send the signed form')).toBeVisible()

    await page.getByRole('button', { name: /search/i }).first().click()
    await page.getByRole('searchbox').fill('zzz')
    await expect(page.getByTestId('now-card')).toBeHidden()

    await page.getByRole('button', { name: /close/i }).first().click()
    await expect(page.getByText('Send the signed form')).toBeVisible()
    expect(counters.get).toBe(1)
  })

  test('offline shows the offline line with no actions', async ({ context, page }) => {
    await stubNow(page, [{ status: 200, body: card('c1', 'do', 'Send the signed form') }])
    await page.goto('/mesh/yarn')
    await expect(page.getByText('Send the signed form')).toBeVisible()

    await context.setOffline(true)
    await expect(page.getByTestId('now-offline')).toBeVisible()
    await expect(page.getByTestId('now-card').getByRole('button')).toHaveCount(0)
  })
})
