import path from 'node:path'
import { expect, type Frame, type Locator, type Page, type Request } from '@playwright/test'
import dotenv from 'dotenv'
import {
  TIMELINE_MOUNT_FETCH_BUDGET,
  findMountFetchBudgetViolations,
  isTimelineUnifiedFetch,
} from '../timeline/timeline-client-loads'
import {
  assertChatLoadingVisible,
  assertChatLogHasNoRawJson,
  assertChatStreamMatchesReload,
  askChatQuestion,
  loginUser,
  registerUser,
  startNewChatSession,
  TEST_PASSWORD,
  waitForChatAnswerMarker,
  waitForChatIdle,
} from './test-helpers'
import {
  assertVoiceTranscribeApi,
  exerciseVoiceCaptureUi,
  installVoiceCaptureMocks,
} from './voice-capture-helpers'

// Playwright workers may not inherit .env from the parent shell; load explicitly for preflight.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true, override: true })

export { registerUser, loginUser, TEST_PASSWORD }

/** Max wait for release smoke polls and async UI steps. */
const RELEASE_WAIT_MS = 30_000
/** Overnight heartbeat runs many jobs; allow longer than generic UI polls. */
const RELEASE_HEARTBEAT_WAIT_MS = 120_000
/** Background enrich (entities, GTD link, embeddings) — the one place we wait longer. */
const RELEASE_INDEXING_WAIT_MS = 120_000
/** Single UI probe — fail fast, try the next strategy. */
const QUICK_MS = 1_500
/** One interactive attempt (open dialog, click save, …). */
const ACTION_MS = 6_000

/** Locale-neutral timeline project UI labels (EN + DE). */
const ADD_PROJECT_BTN = /Add project|Projekt anlegen/i
const CREATE_PROJECT_SUBMIT = /Create project|Projekt anlegen/i
const EDIT_PROJECT_BTN = /Edit project|Projekt bearbeiten/i
const SAVE_PROJECT_BTN = /Save changes|Änderungen speichern/i
const DELETE_PROJECT_BTN = /^Delete$|^Löschen$/i
const DELETE_PROJECT_CONFIRM_TITLE = /Delete project\?|Projekt löschen\?/i
const PROJECTS_LISTBOX = /Projects and next actions|Projekte und nächste Schritte/i
const DIALOG_CANCEL_BTN = /Cancel|Abbrechen/i

async function visible(locator: Locator, timeoutMs = QUICK_MS): Promise<boolean> {
  return locator.isVisible({ timeout: timeoutMs }).catch(() => false)
}

async function pollUntil(
  label: string,
  predicate: () => Promise<boolean>,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? RELEASE_WAIT_MS
  const intervalMs = options?.intervalMs ?? 750
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`${label} (not ready within ${timeoutMs}ms)`)
}

type CaptureThoughtRow = {
  id: string
  normalizedText?: string
  enrichmentComplete?: boolean
  queueStatus?: string | null
  queueError?: string | null
}

async function fetchCaptureThoughtResult(
  page: Page,
  thoughtId: string,
): Promise<CaptureThoughtRow | null> {
  // Use Playwright's request context (not page.evaluate). Capture calls
  // invalidateAll() when enrichment completes, which remounts the page and
  // destroys any in-flight page JS context mid-poll.
  const res = await page.request.get(`/api/capture/result/${encodeURIComponent(thoughtId)}`)
  if (!res.ok()) return null
  const body = (await res.json()) as { thought?: CaptureThoughtRow }
  return body.thought ?? null
}

function captureIndexingInFlight(thought: CaptureThoughtRow | null): boolean {
  if (!thought || thought.enrichmentComplete) return false
  if (thought.queueStatus === 'failed') return false
  if (thought.queueStatus === 'awaiting_confirmation') return false
  return (
    thought.queueStatus === 'pending' ||
    thought.queueStatus === 'processing' ||
    thought.queueStatus === null ||
    thought.queueStatus === undefined
  )
}

/** Wait for background enrichment only while the capture queue is actually in flight. */
async function waitForThoughtIndexed(page: Page, thoughtId: string, raw: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })
  // After interpret→confirm, the list shows interpreted text (may differ from verbatim raw).
  const tokenMatch = raw.match(/[A-Za-zÄÖÜäöüß]{5,}/)
  const token = tokenMatch?.[0]
  if (token) {
    await expect(
      page.getByRole('button', { name: /Expand thought|Collapse thought/ }).first(),
    ).toContainText(token, { timeout: RELEASE_WAIT_MS })
  } else {
    await expect(
      page.getByRole('button', { name: /Expand thought|Collapse thought/ }).first(),
    ).toBeVisible({ timeout: RELEASE_WAIT_MS })
  }

  await expect
    .poll(
      async () => {
        const thought = await fetchCaptureThoughtResult(page, thoughtId)
        if (!thought) return 'missing'

        if (thought.queueStatus === 'failed') {
          throw new Error(`Indexing failed${thought.queueError ? `: ${thought.queueError}` : ''}`)
        }
        if (thought.enrichmentComplete) return 'done'

        if (captureIndexingInFlight(thought)) return 'indexing'

        throw new Error(
          `Thought "${raw.slice(0, 40)}…" saved but indexing stopped without completing (queueStatus=${thought.queueStatus ?? 'unknown'})`,
        )
      },
      { timeout: RELEASE_INDEXING_WAIT_MS, intervals: [500, 1000, 2000] },
    )
    .toBe('done')
}

/** Clear drawers/dialogs without blocking on one strategy. Idempotent. */
async function dismissBlockingLayers(page: Page): Promise<void> {
  if (await visible(page.getByTestId('project-delete-confirm'), QUICK_MS)) {
    return
  }

  const namedDialog = page.getByRole('dialog').filter({
    has: page.getByRole('button', {
      name: /Cancel|Abbrechen|Save changes|Änderungen speichern|Create project|Projekt anlegen/,
    }),
  })
  const drawerOverlay = page.locator('[data-vaul-overlay], [data-slot="drawer-overlay"]').first()

  const blocking = async (): Promise<boolean> =>
    (await visible(namedDialog)) || (await visible(drawerOverlay, QUICK_MS))

  if (!(await blocking())) return

  const attempts: Array<() => Promise<void>> = [
    () => page.keyboard.press('Escape'),
    () => page.keyboard.press('Escape'),
    () => drawerOverlay.click({ position: { x: 6, y: 6 }, force: true }),
    () => page.getByRole('button', { name: DIALOG_CANCEL_BTN }).first().click(),
    () => page.getByRole('button', { name: /Tasks|Aufgaben/, exact: true }).click(),
    () => page.goto('/memory/tasks', { waitUntil: 'domcontentloaded' }),
    () => page.goto('/capture', { waitUntil: 'domcontentloaded' }),
  ]

  for (const attempt of attempts) {
    if (!(await blocking())) return
    await attempt().catch(() => undefined)
  }

  await page.goto('/capture', { waitUntil: 'domcontentloaded' }).catch(() => undefined)
}

const RELEASE_ENV_CHECKS: Array<{ label: string; isSet: () => boolean }> = [
  { label: 'PAYPAL_CLIENT_ID', isSet: () => Boolean(process.env.PAYPAL_CLIENT_ID?.trim()) },
  {
    label: 'PAYPAL_CLIENT_SECRET (or PAYPAL_SECRET)',
    isSet: () =>
      Boolean(process.env.PAYPAL_CLIENT_SECRET?.trim() || process.env.PAYPAL_SECRET?.trim()),
  },
  {
    label: 'PAYPAL_API_BASE (or PAYPAL_URL)',
    isSet: () => Boolean(process.env.PAYPAL_API_BASE?.trim() || process.env.PAYPAL_URL?.trim()),
  },
  {
    label: 'PAYPAL_SANDBOX_BUYER_EMAIL',
    isSet: () => Boolean(process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim()),
  },
  {
    label: 'PAYPAL_SANDBOX_BUYER_PASSWORD',
    isSet: () => Boolean(process.env.PAYPAL_SANDBOX_BUYER_PASSWORD?.trim()),
  },
  {
    label: 'SERVICE_API_KEY_EUROUTER',
    isSet: () => Boolean(process.env.SERVICE_API_KEY_EUROUTER?.trim()),
  },
  { label: 'LLM_BASE_URL', isSet: () => Boolean(process.env.LLM_BASE_URL?.trim()) },
  { label: 'LLM_RULE_CHAT', isSet: () => Boolean(process.env.LLM_RULE_CHAT?.trim()) },
  { label: 'LLM_RULE_EMBEDDING', isSet: () => Boolean(process.env.LLM_RULE_EMBEDDING?.trim()) },
  { label: 'OPENROUTER_BASE_URL', isSet: () => Boolean(process.env.OPENROUTER_BASE_URL?.trim()) },
  {
    label: 'SERVICE_API_KEY_OPENROUTER',
    isSet: () => Boolean(process.env.SERVICE_API_KEY_OPENROUTER?.trim()),
  },
]

export function getReleasePreflightMissing(): string[] {
  return RELEASE_ENV_CHECKS.filter((check) => !check.isSet()).map((check) => check.label)
}

export type AuthenticatedSurface = {
  path: string
  label: string
}

/** Main authenticated routes exercised before a release. */
export const AUTHENTICATED_SURFACES: AuthenticatedSurface[] = [
  { path: '/capture', label: 'Capture' },
  { path: '/memory', label: 'Memory graph' },
  { path: '/memory?view=embeddings', label: 'Memory embeddings' },
  { path: '/memory/tasks', label: 'Memory tasks' },
  { path: '/memory/projects', label: 'Memory projects' },
  { path: '/memory/notes', label: 'Memory notes' },
  { path: '/chat', label: 'Chat' },
  { path: '/activity', label: 'Activity' },
  { path: '/settings', label: 'Settings' },
  { path: '/settings/llm', label: 'Settings Credits' },
  { path: '/settings/scheduled-tasks', label: 'Heartbeat' },
  { path: '/api-keys', label: 'API keys' },
]

export function assertReleasePreflight(): void {
  const missing = getReleasePreflightMissing()
  if (missing.length > 0) {
    throw new Error(
      `Release e2e preflight failed. Set these in .env before running npm run test:e2e:release:\n${missing.map((k) => `  - ${k}`).join('\n')}`,
    )
  }
}

async function waitForAuthenticatedPage(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.locator('body')).toBeVisible()
}

async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
}

async function dismissOpenOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
}

/** Locale-neutral PayPal checkout submit controls (hermes + legacy review). */
const PAYPAL_SUBMIT_SELECTORS = [
  '#payment-submit-btn',
  '#confirmButtonTop',
  '#btn_pay',
  '#submit-action',
  'button[data-testid="submit-button-initial"]',
  'button[data-testid="submit-button"]',
  'button[name="payment-submit"]',
  'input#payment-submit-btn',
  'button.actionContinue',
  'button[id*="submit" i]',
  'input[type="submit"]',
  'button[type="submit"]',
] as const

async function isVisible(locator: Locator, timeoutMs = 1_500): Promise<boolean> {
  return locator.isVisible({ timeout: timeoutMs }).catch(() => false)
}

function isPayPalDetachedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /detached|Target closed|Execution context was destroyed/i.test(message)
}

function livePayPalContexts(checkoutPage: Page): Array<Page | Frame> {
  if (checkoutPage.isClosed()) {
    return []
  }
  const contexts: Array<Page | Frame> = [checkoutPage]
  for (const frame of checkoutPage.frames()) {
    if (!frame.isDetached()) {
      contexts.push(frame)
    }
  }
  return contexts
}

async function scanPayPalContext(ctx: Page | Frame): Promise<boolean> {
  try {
    const signals = [
      ctx.locator('#email, input[name="login_email"]').first(),
      ctx.locator('#password, input[name="login_password"]').first(),
      ctx.locator('#payment-submit-btn').first(),
      ctx.locator('button[data-testid="submit-button-initial"]').first(),
      ctx.locator('input[type="radio"]').first(),
    ]
    for (const signal of signals) {
      if (await signal.isVisible().catch(() => false)) {
        return true
      }
    }

    const buttons = ctx.locator('button:visible:not([disabled])')
    const count = await buttons.count().catch(() => 0)
    for (let i = count - 1; i >= 0; i--) {
      const box = await buttons
        .nth(i)
        .boundingBox()
        .catch(() => null)
      if (box && box.height >= 36 && box.width >= 80) {
        return true
      }
    }
  } catch (err) {
    if (isPayPalDetachedError(err)) {
      return false
    }
    throw err
  }
  return false
}

async function maybeLoginPayPalSandbox(
  checkoutPage: Page,
  buyerEmail: string,
  buyerPassword: string,
): Promise<void> {
  const emailInput = checkoutPage.locator('#email, input[name="login_email"]').first()
  if (!(await isVisible(emailInput, 8_000))) {
    return
  }

  await emailInput.fill(buyerEmail)

  const nextButton = checkoutPage.locator('#btnNext').first()
  if (await isVisible(nextButton)) {
    await nextButton.click()
  }

  const passwordInput = checkoutPage.locator('#password, input[name="login_password"]').first()
  await passwordInput.waitFor({ state: 'visible', timeout: 20_000 })
  await passwordInput.fill(buyerPassword)

  await checkoutPage.locator('#btnLogin').first().click()
  await waitForPayPalCheckoutReady(checkoutPage)
}

async function paypalCheckoutReady(checkoutPage: Page): Promise<boolean> {
  if (checkoutPage.isClosed()) {
    return false
  }

  const url = checkoutPage.url()
  if (!url || url === 'about:blank' || !/sandbox\.paypal\.com/i.test(url)) {
    return false
  }

  for (const ctx of livePayPalContexts(checkoutPage)) {
    if (await scanPayPalContext(ctx)) {
      return true
    }
  }

  return false
}

async function waitForPayPalCheckoutReady(checkoutPage: Page): Promise<void> {
  await expect
    .poll(() => paypalCheckoutReady(checkoutPage), {
      timeout: RELEASE_WAIT_MS,
      intervals: [300, 500, 1000],
    })
    .toBe(true)

  if (checkoutPage.isClosed()) {
    throw new Error('PayPal checkout closed before it finished loading')
  }
}

async function closeStrayPayPalPopups(mainPage: Page): Promise<void> {
  for (const p of mainPage.context().pages()) {
    if (p !== mainPage && !p.isClosed()) {
      await p.close().catch(() => undefined)
    }
  }
}

function payPalApiBase(): string {
  const base = (process.env.PAYPAL_API_BASE ?? process.env.PAYPAL_URL)?.trim().replace(/\/$/, '')
  if (!base) {
    throw new Error('PAYPAL_API_BASE (or PAYPAL_URL) is required for release PayPal polling')
  }
  return base
}

let cachedPayPalToken: { token: string; expiresAt: number } | null = null

async function getPayPalAccessTokenForE2e(): Promise<string> {
  const now = Date.now()
  if (cachedPayPalToken && cachedPayPalToken.expiresAt > now + 30_000) {
    return cachedPayPalToken.token
  }

  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const secret = (process.env.PAYPAL_CLIENT_SECRET ?? process.env.PAYPAL_SECRET)?.trim()
  if (!clientId || !secret) {
    throw new Error('PayPal client credentials are required for release PayPal polling')
  }

  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const res = await fetch(`${payPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`PayPal OAuth failed HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new Error('PayPal OAuth response missing access_token')
  }
  cachedPayPalToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 300) * 1000,
  }
  return json.access_token
}

async function getPayPalOrderStatus(orderId: string): Promise<string> {
  const token = await getPayPalAccessTokenForE2e()
  const res = await fetch(`${payPalApiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`PayPal get order failed HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = JSON.parse(text) as { status?: string }
  return json.status?.trim() ?? ''
}

async function waitForPayPalOrderApproved(
  orderId: string,
  timeoutMs = RELEASE_WAIT_MS,
): Promise<void> {
  await expect
    .poll(() => getPayPalOrderStatus(orderId), {
      timeout: timeoutMs,
      intervals: [500, 1000, 2000],
    })
    .toMatch(/APPROVED|COMPLETED/i)
}

async function selectPayPalFundingIfNeeded(checkoutPage: Page): Promise<void> {
  for (const ctx of livePayPalContexts(checkoutPage)) {
    try {
      const radio = ctx.locator('input[type="radio"]:visible').first()
      if (await radio.isVisible().catch(() => false)) {
        await radio.check({ force: true }).catch(() => radio.click({ force: true }))
        return
      }
    } catch (err) {
      if (isPayPalDetachedError(err)) continue
      throw err
    }
  }
}

const PAYPAL_SANDBOX_CHECKOUT_ORIGIN = 'https://www.sandbox.paypal.com'

/** Approve an existing order in sandbox UI (bypasses flaky JS SDK popup bridge). */
async function approvePayPalOrderInSandbox(
  mainPage: Page,
  orderId: string,
  buyerEmail: string,
  buyerPassword: string,
): Promise<void> {
  const checkoutPage = await mainPage.context().newPage()
  try {
    await checkoutPage.goto(
      `${PAYPAL_SANDBOX_CHECKOUT_ORIGIN}/checkoutnow?token=${encodeURIComponent(orderId)}`,
      { waitUntil: 'domcontentloaded', timeout: RELEASE_WAIT_MS },
    )
    await waitForPayPalCheckoutReady(checkoutPage)
    await maybeLoginPayPalSandbox(checkoutPage, buyerEmail, buyerPassword)
    await selectPayPalFundingIfNeeded(checkoutPage)

    let status = await getPayPalOrderStatus(orderId).catch(() => '')
    for (let attempt = 0; attempt < 3 && !/APPROVED|COMPLETED/i.test(status); attempt++) {
      await selectPayPalFundingIfNeeded(checkoutPage)
      if (await paypalCheckoutReady(checkoutPage)) {
        await clickPayPalSubmitButton(checkoutPage)
      }
      status = await getPayPalOrderStatus(orderId).catch(() => status)
    }

    await waitForPayPalOrderApproved(orderId)
  } finally {
    await checkoutPage.close().catch(() => undefined)
  }
}

async function clickPayPalSubmitButton(checkoutPage: Page): Promise<void> {
  const submitVisible = async (): Promise<boolean> => {
    for (const ctx of livePayPalContexts(checkoutPage)) {
      try {
        for (const selector of PAYPAL_SUBMIT_SELECTORS) {
          if (
            await ctx
              .locator(selector)
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            return true
          }
        }
        const buttons = ctx.locator('button:visible:not([disabled])')
        const count = await buttons.count().catch(() => 0)
        for (let i = count - 1; i >= 0; i--) {
          const box = await buttons
            .nth(i)
            .boundingBox()
            .catch(() => null)
          if (box && box.height >= 36 && box.width >= 120) {
            return true
          }
        }
      } catch (err) {
        if (isPayPalDetachedError(err)) continue
        throw err
      }
    }
    return false
  }

  await expect
    .poll(submitVisible, { timeout: RELEASE_WAIT_MS, intervals: [250, 500, 1000] })
    .toBe(true)

  for (const ctx of livePayPalContexts(checkoutPage)) {
    try {
      for (const selector of PAYPAL_SUBMIT_SELECTORS) {
        const button = ctx.locator(selector).first()
        if (await isVisible(button, 1_000)) {
          await button.click()
          return
        }
      }
    } catch (err) {
      if (isPayPalDetachedError(err)) continue
      throw err
    }
  }

  for (const ctx of livePayPalContexts(checkoutPage)) {
    try {
      const buttons = ctx.locator('button:visible:not([disabled])')
      const count = await buttons.count().catch(() => 0)
      for (let i = count - 1; i >= 0; i--) {
        const button = buttons.nth(i)
        const box = await button.boundingBox().catch(() => null)
        if (box && box.height >= 36 && box.width >= 120) {
          await button.click()
          return
        }
      }
    } catch (err) {
      if (isPayPalDetachedError(err)) continue
      throw err
    }
  }

  throw new Error('PayPal submit button not found (checkout may have changed)')
}

/**
 * Buy sandbox credits: create-order API → sandbox buyer approval → capture-order.
 *
 * Skips the PayPal JS SDK button — its popup auto-cancels under automation and leaves
 * the wallet at 0 (Capture stays disabled).
 */
export async function topUpCreditsViaPayPalSandbox(
  page: Page,
  options?: { amountCredits?: number },
): Promise<void> {
  const amountCredits = options?.amountCredits ?? 1000
  const buyerEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim()
  const buyerPassword = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD?.trim()
  if (!buyerEmail || !buyerPassword) {
    throw new Error('PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD are required')
  }

  await closeStrayPayPalPopups(page)

  const createRes = await page.request.post('/api/billing/paypal/create-order', {
    data: { amountCredits },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!createRes.ok()) {
    throw new Error(`create-order failed (${createRes.status()}): ${await createRes.text()}`)
  }

  const orderPayload = (await createRes.json()) as { orderId?: string }
  const orderId = typeof orderPayload.orderId === 'string' ? orderPayload.orderId.trim() : ''
  if (!orderId) {
    throw new Error('create-order response missing orderId')
  }

  await approvePayPalOrderInSandbox(page, orderId, buyerEmail, buyerPassword)
  await closeStrayPayPalPopups(page)

  const captureRes = await page.request.post('/api/billing/paypal/capture-order', {
    data: { orderId },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!captureRes.ok()) {
    throw new Error(`capture-order failed (${captureRes.status()}): ${await captureRes.text()}`)
  }

  await page.reload()

  await expect
    .poll(
      async () => {
        const walletRes = await page.request.get('/api/billing/wallet')
        if (!walletRes.ok()) return 0
        const body = (await walletRes.json()) as { availableCredits?: number }
        return body.availableCredits ?? 0
      },
      { timeout: RELEASE_WAIT_MS },
    )
    .toBeGreaterThanOrEqual(50)
}

function onboardingDialog(page: Page): Locator {
  return page.getByRole('dialog', {
    name: /Your memory, not theirs\.|Just drop it in\.|Install Eigen Mesh|Stay in the loop/,
  })
}

/**
 * Step through the welcome overlay (product → install → notifications), then
 * optionally top up via API (PayPal lives outside onboarding — Settings / capture gate).
 * E2E skips real PWA install / notification permission via the continue-without actions.
 */
export async function completeOnboardingOverlay(
  page: Page,
  options?: { creditAmount?: number },
): Promise<void> {
  const dialog = onboardingDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Step 1 of 4')).toBeVisible()
  await expect(dialog.getByText('Your memory, not theirs.')).toBeVisible()

  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog.getByText('Just drop it in.')).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByText('Step 2 of 4')).toBeVisible()

  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog.getByText('Install Eigen Mesh', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await expect(dialog.getByText('Step 3 of 4')).toBeVisible()
  await dialog.getByRole('button', { name: 'Continue without installing' }).click()

  await expect(dialog.getByText('Stay in the loop')).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByText('Step 4 of 4')).toBeVisible()
  await dialog.getByRole('button', { name: 'Continue without notifications' }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })

  if (options?.creditAmount != null) {
    await topUpCreditsViaPayPalSandbox(page, {
      amountCredits: options.creditAmount,
    })
  }
}

function parseInterpretResponse(bodyText: string): {
  thoughtId: string
  status: 'ingested' | 'awaiting_confirmation' | string
} {
  const json = JSON.parse(bodyText) as {
    thoughtId?: string
    status?: string
    queueStatus?: string
    error?: string
  }
  if (json.error) throw new Error(json.error)
  const thoughtId = json.thoughtId ?? ''
  const status =
    json.status ??
    (json.queueStatus === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'ingested')
  return { thoughtId, status }
}

/**
 * Fill Capture composer and wait until Svelte bind:value has accepted it (button enables).
 * Early fills after domcontentloaded are often wiped by hydration; re-fill until stable.
 */
async function fillCaptureComposer(page: Page, raw: string): Promise<Locator> {
  const thought = page.locator('#thought')
  const captureBtn = page.getByRole('button', { name: 'Capture', exact: true })
  await expect(thought).toBeVisible({ timeout: RELEASE_WAIT_MS })

  for (let attempt = 0; attempt < 8; attempt++) {
    await thought.click()
    await thought.fill(raw)
    const value = await thought.inputValue().catch(() => '')
    if (value === raw && (await captureBtn.isEnabled().catch(() => false))) {
      return captureBtn
    }
    await page.waitForTimeout(250)
  }

  const stuckValue = await thought.inputValue().catch(() => '')
  throw new Error(
    `Capture button stayed disabled (thought value=${JSON.stringify(stuckValue)}, expected=${JSON.stringify(raw)})`,
  )
}

/**
 * Capture through the UI confirmation gate:
 * Capture → interpret → (modal Confirm if LLM deviates) → full ingest.
 * When the LLM does not deviate, interpret returns ingested and no modal appears.
 */
export async function captureThoughtViaUi(page: Page, raw: string): Promise<string> {
  await dismissBlockingLayers(page)
  await page.goto('/capture', { waitUntil: 'domcontentloaded' })
  await dismissBlockingLayers(page)

  if (await visible(onboardingDialog(page))) {
    throw new Error('Onboarding overlay still open — complete onboarding before capture')
  }

  const captureBtn = await fillCaptureComposer(page, raw)

  const errorBanner = page.locator('p.text-destructive.text-sm').first()
  const { thoughtId, status } = await submitInterpretViaUi(page, {
    raw,
    captureBtn,
    errorBanner,
  })

  if (status === 'awaiting_confirmation') {
    const confirmModal = page.getByTestId('capture-confirmation-modal')
    await expect(confirmModal).toBeVisible({ timeout: RELEASE_WAIT_MS })
    await expect(confirmModal.getByRole('button', { name: /^Confirm$/i })).toBeEnabled({
      timeout: RELEASE_WAIT_MS,
    })

    const confirmResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/confirm') && res.request().method() === 'POST',
      { timeout: RELEASE_INDEXING_WAIT_MS },
    )
    await confirmModal.getByRole('button', { name: /^Confirm$/i }).click()
    const confirmRes = await confirmResponsePromise
    if (!confirmRes.ok()) {
      throw new Error(
        (await confirmRes.text()).trim() || `Capture confirm failed (${confirmRes.status()})`,
      )
    }
  }

  await waitForThoughtIndexed(page, thoughtId, raw)
  return thoughtId
}

/**
 * Submit Capture and wait for interpret. Retries once on transient LLM HTTP 400
 * (provider rejection), which the gateway may return intermittently under load.
 */
async function submitInterpretViaUi(
  page: Page,
  input: {
    raw: string
    captureBtn: Locator
    errorBanner?: Locator
  },
): Promise<{ thoughtId: string; status: string }> {
  let lastError = 'Capture interpret failed'
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await fillCaptureComposer(page, input.raw)
    }
    const interpretResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/interpret') && res.request().method() === 'POST',
      { timeout: RELEASE_INDEXING_WAIT_MS },
    )
    await input.captureBtn.click()
    await expect(page.getByTestId('capture-interpret-pending')).toBeVisible({
      timeout: RELEASE_WAIT_MS,
    })
    const interpretRes = await interpretResponsePromise
    const interpretBody = await interpretRes.text()
    if (interpretRes.ok()) {
      const parsed = parseInterpretResponse(interpretBody)
      if (parsed.thoughtId) return parsed
      lastError = 'Capture interpret succeeded but returned no thought id'
      break
    }
    lastError = interpretBody.trim() || `Capture interpret failed (${interpretRes.status()})`
    const retryable = /LLM HTTP 400|provider rejected|invalid_request_error/i.test(lastError)
    if (!retryable || attempt === 1) break
  }
  if (input.errorBanner && (await visible(input.errorBanner, QUICK_MS))) {
    const message = (await input.errorBanner.textContent())?.trim()
    if (message) throw new Error(`Capture failed: ${message}`)
  }
  throw new Error(lastError)
}

/**
 * Capture → interpret deviation modal → Dismiss → store verbatim.
 * Injects forceConfirmation on interpret (non-production) so the modal path is
 * deterministic regardless of the live LLM judge.
 */
export async function captureThoughtViaUiDismissVerbatim(
  page: Page,
  raw: string,
): Promise<string> {
  await dismissBlockingLayers(page)
  await page.goto('/capture', { waitUntil: 'domcontentloaded' })
  await dismissBlockingLayers(page)

  await page.route('**/api/capture/interpret', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const existing = route.request().postDataJSON() as Record<string, unknown>
    await route.continue({
      postData: JSON.stringify({ ...existing, forceConfirmation: true }),
      headers: {
        ...route.request().headers(),
        'content-type': 'application/json',
      },
    })
  })

  try {
    const captureBtn = await fillCaptureComposer(page, raw)
    const { thoughtId, status } = await submitInterpretViaUi(page, { raw, captureBtn })
    if (status !== 'awaiting_confirmation') {
      throw new Error(
        `Expected awaiting_confirmation for dismiss-verbatim test, got status=${status}`,
      )
    }

    const confirmModal = page.getByTestId('capture-confirmation-modal')
    await expect(confirmModal).toBeVisible({ timeout: RELEASE_WAIT_MS })

    const confirmResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/confirm') && res.request().method() === 'POST',
      { timeout: RELEASE_INDEXING_WAIT_MS },
    )
    await confirmModal.getByRole('button', { name: /^Dismiss$/i }).click()
    const confirmRes = await confirmResponsePromise
    if (!confirmRes.ok()) {
      throw new Error((await confirmRes.text()).trim() || 'Capture dismiss (verbatim) failed')
    }
    const thought = await fetchCaptureThoughtResult(page, thoughtId)
    if (thought?.normalizedText !== raw) {
      throw new Error(
        `Expected verbatim normalizedText=${JSON.stringify(raw)}, got ${JSON.stringify(thought?.normalizedText)}`,
      )
    }

    await waitForThoughtIndexed(page, thoughtId, raw)
    return thoughtId
  } finally {
    await page.unroute('**/api/capture/interpret')
  }
}

/**
 * Capture → interpret deviation modal → wait for 5s auto-accept.
 * Injects forceConfirmation on interpret (non-production) for a deterministic modal.
 */
export async function captureThoughtViaUiAutoAccept(page: Page, raw: string): Promise<string> {
  await dismissBlockingLayers(page)
  await page.goto('/capture', { waitUntil: 'domcontentloaded' })
  await dismissBlockingLayers(page)

  await page.route('**/api/capture/interpret', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const existing = route.request().postDataJSON() as Record<string, unknown>
    await route.continue({
      postData: JSON.stringify({ ...existing, forceConfirmation: true }),
      headers: {
        ...route.request().headers(),
        'content-type': 'application/json',
      },
    })
  })

  try {
    const captureBtn = await fillCaptureComposer(page, raw)
    const { thoughtId, status } = await submitInterpretViaUi(page, { raw, captureBtn })
    if (status !== 'awaiting_confirmation') {
      throw new Error(`Expected awaiting_confirmation for auto-accept test, got status=${status}`)
    }

    const confirmModal = page.getByTestId('capture-confirmation-modal')
    await expect(confirmModal).toBeVisible({ timeout: RELEASE_WAIT_MS })

    const confirmResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/capture/confirm') && res.request().method() === 'POST',
      { timeout: RELEASE_INDEXING_WAIT_MS },
    )
    // Do not click — wait for client 5s countdown to auto-confirm.
    const confirmRes = await confirmResponsePromise
    if (!confirmRes.ok()) {
      throw new Error((await confirmRes.text()).trim() || 'Capture auto-accept failed')
    }
    await expect(confirmModal).toBeHidden({ timeout: RELEASE_WAIT_MS })

    await waitForThoughtIndexed(page, thoughtId, raw)
    return thoughtId
  } finally {
    await page.unroute('**/api/capture/interpret')
  }
}

export async function visitAuthenticatedSurfaces(page: Page): Promise<void> {
  await exerciseAuthenticatedUi(page)
}

type TimelineProjectRow = {
  entityId: string
  label: string
  status: string
  openTaskCount: number
  targetDate?: string | null
  tasks?: Array<{ thoughtId: string; summary: string; rank: number }>
  milestones?: Array<{ label: string; targetDate: string | null }>
  nextAction?: { thoughtId: string; summary: string; itemId: string } | null
}

async function fetchTimelineProjects(page: Page): Promise<TimelineProjectRow[]> {
  // Prefer request context over page.evaluate so invalidateAll() / remounts
  // during background enrich do not destroy the poll mid-flight.
  const res = await page.request.get('/api/timeline/projects?author=user')
  if (!res.ok()) {
    throw new Error(`fetchTimelineProjects failed (${res.status()}): ${await res.text()}`)
  }
  const body = (await res.json()) as { projects?: TimelineProjectRow[] }
  return body.projects ?? []
}

async function findProject(page: Page, entityId: string): Promise<TimelineProjectRow | undefined> {
  return (await fetchTimelineProjects(page)).find((p) => p.entityId === entityId)
}

async function gotoTimelineProjectsView(page: Page): Promise<void> {
  await dismissBlockingLayers(page)
  await page.goto('/memory/projects', { waitUntil: 'domcontentloaded' })

  for (let attempt = 0; attempt < 4; attempt++) {
    if (await visible(page.getByRole('button', { name: ADD_PROJECT_BTN }))) {
      return
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
  }
  throw new Error('Projects view did not load')
}

async function createProjectViaUi(page: Page, label: string): Promise<TimelineProjectRow> {
  await gotoTimelineProjectsView(page)
  await page.getByRole('button', { name: ADD_PROJECT_BTN }).click()
  const createDialog = page
    .getByRole('dialog')
    .filter({ has: page.locator('#create-project-label') })
  if (!(await visible(createDialog, ACTION_MS))) {
    throw new Error('Add project dialog did not open')
  }
  await createDialog.locator('#create-project-label').fill(label)

  const createResponse = page.waitForResponse(
    (res) => res.url().includes('/api/timeline/projects') && res.request().method() === 'POST',
    { timeout: ACTION_MS },
  )
  await createDialog.getByRole('button', { name: CREATE_PROJECT_SUBMIT }).click()
  const res = await createResponse
  if (!res.ok()) {
    throw new Error(`create project failed (${res.status()}): ${await res.text()}`)
  }
  await expect(createDialog).toBeHidden({ timeout: QUICK_MS })
  await dismissBlockingLayers(page)

  const created = (await fetchTimelineProjects(page)).find((p) => p.label === label)
  if (!created) {
    throw new Error(`Project "${label}" missing in API immediately after create`)
  }
  return created
}

async function openProjectDetail(page: Page, projectLabel: string): Promise<void> {
  await gotoTimelineProjectsView(page)
  const listbox = page.getByRole('listbox', { name: PROJECTS_LISTBOX })
  const card = listbox
    .locator('[data-testid="project-card"]')
    .filter({ has: page.getByText(projectLabel, { exact: true }) })
    .first()

  if (!(await visible(card, ACTION_MS))) {
    throw new Error(`Project "${projectLabel}" not found in list`)
  }

  await card.click()
  await expect(page).toHaveURL(/\/memory\/projects\/[^/?]+/, { timeout: ACTION_MS })
  await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: ACTION_MS })

  if (!(await visible(page.getByRole('button', { name: EDIT_PROJECT_BTN }), ACTION_MS))) {
    throw new Error(`Project detail page did not show edit control for "${projectLabel}"`)
  }
}

async function renameProjectViaUi(
  page: Page,
  projectName: string,
  renamedProject: string,
): Promise<void> {
  await openProjectDetail(page, projectName)
  await page.getByRole('button', { name: EDIT_PROJECT_BTN }).click()

  const editDialog = page.getByRole('dialog').filter({ has: page.locator('#edit-project-label') })
  if (!(await visible(editDialog, ACTION_MS))) {
    throw new Error('Edit project dialog did not open')
  }
  await editDialog.locator('#edit-project-label').fill(renamedProject)

  const updateResponse = page.waitForResponse(
    (res) =>
      /\/api\/timeline\/projects\/[^/]+\/update$/.test(res.url()) &&
      res.request().method() === 'PUT',
    { timeout: ACTION_MS },
  )
  await editDialog.getByRole('button', { name: SAVE_PROJECT_BTN }).click()
  const res = await updateResponse
  if (!res.ok()) {
    throw new Error(`project rename failed (${res.status()}): ${await res.text()}`)
  }
  await expect(editDialog).toBeHidden({ timeout: QUICK_MS })
  await dismissBlockingLayers(page)
}

async function confirmProjectDeleteModal(page: Page): Promise<void> {
  const modal = page.getByTestId('project-delete-confirm')
  await expect(modal).toBeVisible({ timeout: ACTION_MS })
  await expect(modal.getByRole('heading', { name: DELETE_PROJECT_CONFIRM_TITLE })).toBeVisible()

  const dismissResponse = page.waitForResponse(
    (res) =>
      /\/api\/timeline\/projects\/[^/]+\/dismiss$/.test(res.url()) &&
      res.request().method() === 'POST',
    { timeout: ACTION_MS },
  )
  await modal.getByRole('button', { name: DELETE_PROJECT_BTN }).click()

  const res = await dismissResponse
  if (!res.ok()) {
    throw new Error(`project dismiss failed (${res.status()}): ${await res.text()}`)
  }
  await expect(modal).toBeHidden({ timeout: QUICK_MS })
}

async function dismissProjectViaUi(
  page: Page,
  entityId: string,
  projectLabel: string,
): Promise<void> {
  await openProjectDetail(page, projectLabel)

  const deleteTrigger = page.getByRole('button', { name: DELETE_PROJECT_BTN }).first()
  if (!(await visible(deleteTrigger, ACTION_MS))) {
    throw new Error(`Delete control not found in project detail for "${projectLabel}"`)
  }

  await deleteTrigger.click()
  await confirmProjectDeleteModal(page)

  if (await findProject(page, entityId)) {
    throw new Error(`Project "${projectLabel}" (${entityId}) still listed after confirm delete`)
  }

  await dismissBlockingLayers(page)
}

/**
 * Headed guard: mark-done from Projects grouping uses the same
 * `POST /api/temporal-events/:id/action` client as Tasks (no forked thoughts PATCH).
 */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Match rendered text flexibly: collapse any run of whitespace in the pattern to `\s+`. */
function textMatchPattern(value: string): RegExp {
  return new RegExp(escapeForRegex(value).replace(/\s+/g, '\\s+'))
}

export async function assertMarkDoneFromProjectsView(page: Page): Promise<void> {
  // Locate the task by its thoughtId (returned by captureThoughtViaUi), not by a synthetic
  // "marker-<ts>" token. The interpret LLM reasonably strips a bare `marker-<ts>` as noise —
  // which has broken this guard twice (first "markdone-<ts>" → "mark done-<ts>", then
  // "marker-<ts>" dropped entirely). The UI row's accessible name is the rendered
  // semanticSummary, so we fetch that same value from the API and match it as a substring.
  const stamp = Date.now()
  const captureText = `TODO: finish the release checklist item for the ${stamp} release review`
  const thoughtId = await captureThoughtViaUi(page, captureText)

  let itemId = ''
  let summary = ''
  await pollUntil(
    'open task available for projects mark-done',
    async () => {
      const res = await page.request.get(
        '/api/temporal-events?range=all&status=open&includeTasks=true&author=user',
      )
      if (!res.ok()) return false
      const body = (await res.json()) as {
        items: Array<{ id: string; thoughtId: string; semanticSummary: string }>
      }
      const found = body.items.find((i) => i.thoughtId === thoughtId)
      if (!found || !found.semanticSummary) return false
      itemId = found.id
      summary = found.semanticSummary
      return true
    },
    { timeoutMs: RELEASE_INDEXING_WAIT_MS, intervalMs: 2_000 },
  )

  await gotoTimelineProjectsView(page)

  // Scope the mark-done button to this task's row via the task's summary button
  // (role=button, accessible name contains the rendered semanticSummary), not a div+substring
  // filter that can match an ancestor container holding multiple task rows.
  const summaryButton = page.getByRole('button', { name: textMatchPattern(summary) }).first()
  const markBtn = summaryButton
    .locator('xpath=..')
    .getByRole('button', { name: /Mark done|Als erledigt markieren/i })
  await expect(markBtn).toBeVisible({ timeout: RELEASE_WAIT_MS })

  const actionResponse = page.waitForResponse(
    (res) => {
      const url = res.url()
      return (
        url.includes('/api/temporal-events/') &&
        url.includes('/action') &&
        res.request().method() === 'POST'
      )
    },
    { timeout: RELEASE_WAIT_MS },
  )
  await markBtn.click()
  const res = await actionResponse
  if (!res.ok()) {
    throw new Error(`projects mark-done failed (${res.status()}): ${await res.text()}`)
  }
  const posted = res.request().postDataJSON() as { action?: string } | null
  if (posted?.action !== 'mark_done') {
    throw new Error(`Expected mark_done action body, got ${JSON.stringify(posted)}`)
  }

  await pollUntil(
    'task completed after projects mark-done',
    async () => {
      const listRes = await page.request.get(
        '/api/temporal-events?range=all&status=all&includeTasks=true&author=user',
      )
      if (!listRes.ok()) return false
      const body = (await listRes.json()) as {
        items: Array<{
          id: string
          lifecycleStatus: string
          thoughtStatus: string
        }>
      }
      const item = body.items.find((i) => i.id === itemId)
      if (!item) return false
      return (
        item.lifecycleStatus === 'completed' || item.thoughtStatus === 'completed'
      )
    },
    { timeoutMs: RELEASE_WAIT_MS, intervalMs: 500 },
  )

  // Default Projects list hides completed tasks — the row (and its summary) must be gone.
  await expect(page.getByRole('button', { name: textMatchPattern(summary) })).toHaveCount(0, {
    timeout: RELEASE_WAIT_MS,
  })
}

/**
 * Manual GTD project lifecycle: create → capture-linked task → rename → dismiss → no resurrection.
 */
export async function exerciseProjectsLifecycle(page: Page): Promise<void> {
  const projectName = 'Release Smoke Project'
  const renamedProject = 'Release Smoke Project Renamed'
  const projectTaskThought =
    'Next action for Release Smoke Project: book venue shortlist for the team offsite'
  const postRenameThought =
    'Update for Release Smoke Project Renamed: send invites after venue is confirmed'
  const postDismissThought =
    'Follow-up for Release Smoke Project Renamed: this should not restore the dismissed project'

  const created = await createProjectViaUi(page, projectName)

  await captureThoughtViaUi(page, projectTaskThought)
  await pollUntil(
    `task linked to "${projectName}"`,
    async () => ((await findProject(page, created.entityId))?.openTaskCount ?? 0) > 0,
    { timeoutMs: RELEASE_INDEXING_WAIT_MS, intervalMs: 2_000 },
  )

  await renameProjectViaUi(page, projectName, renamedProject)
  const renamedRow = await findProject(page, created.entityId)
  if (renamedRow?.label !== renamedProject) {
    throw new Error(
      `Expected project label "${renamedProject}" after rename, got "${renamedRow?.label ?? 'missing'}"`,
    )
  }

  await captureThoughtViaUi(page, postRenameThought)
  await pollUntil(
    `second task on "${renamedProject}"`,
    async () => {
      const row = await findProject(page, created.entityId)
      return row?.label === renamedProject && row.openTaskCount >= 1
    },
    { timeoutMs: RELEASE_INDEXING_WAIT_MS, intervalMs: 2_000 },
  )

  await dismissProjectViaUi(page, created.entityId, renamedProject)

  await captureThoughtViaUi(page, postDismissThought)
  if (await findProject(page, created.entityId)) {
    throw new Error('Dismissed project reappeared after follow-up capture')
  }
}

/**
 * Project waterfall + milestone chips on the card; completing the head task advances next-action.
 */
export async function assertProjectWaterfallAndAdvance(page: Page): Promise<void> {
  const stamp = Date.now()
  const projectLabel = `Waterfall Project ${stamp}`
  // Stable tokens must survive interpret→confirm rewriting (word order may change).
  const firstToken = `waterfall-first-${stamp}`
  const secondToken = `waterfall-second-${stamp}`
  const firstSummary = `${firstToken} draft the outline`
  const secondSummary = `${secondToken} review with design`

  const createRes = await page.request.post('/api/timeline/projects', {
    data: { label: projectLabel, status: 'active' },
  })
  if (!createRes.ok()) {
    throw new Error(`create waterfall project failed (${createRes.status()}): ${await createRes.text()}`)
  }
  const created = (await createRes.json()) as { entityId: string }

  const firstThoughtId = await captureThoughtViaUi(page, `TODO: ${firstSummary}`)
  const secondThoughtId = await captureThoughtViaUi(page, `TODO: ${secondSummary}`)

  for (const thoughtId of [firstThoughtId, secondThoughtId]) {
    const assignRes = await page.request.post('/api/timeline/projects/assign', {
      data: { thoughtId, projectEntityId: created.entityId },
    })
    if (!assignRes.ok()) {
      throw new Error(`assign waterfall task failed (${assignRes.status()}): ${await assignRes.text()}`)
    }
  }

  const orderFirst = await page.request.post(`/api/timeline/projects/${created.entityId}/order`, {
    data: { thoughtId: firstThoughtId, rank: 1, asNextAction: true },
  })
  if (!orderFirst.ok()) {
    throw new Error(`order first task failed (${orderFirst.status()}): ${await orderFirst.text()}`)
  }
  const orderSecond = await page.request.post(`/api/timeline/projects/${created.entityId}/order`, {
    data: { thoughtId: secondThoughtId, afterThoughtId: firstThoughtId },
  })
  if (!orderSecond.ok()) {
    throw new Error(`order second task failed (${orderSecond.status()}): ${await orderSecond.text()}`)
  }

  const deadlineRes = await page.request.post(`/api/timeline/projects/${created.entityId}/deadline`, {
    data: { targetDate: '2026-12-01T00:00:00.000Z' },
  })
  if (!deadlineRes.ok()) {
    throw new Error(`set deadline failed (${deadlineRes.status()}): ${await deadlineRes.text()}`)
  }

  const milestoneRes = await page.request.post(
    `/api/timeline/projects/${created.entityId}/milestones`,
    { data: { label: `Beta ${stamp}`, targetDate: '2026-10-01T00:00:00.000Z', rank: 1 } },
  )
  if (!milestoneRes.ok()) {
    throw new Error(`set milestone failed (${milestoneRes.status()}): ${await milestoneRes.text()}`)
  }

  await gotoTimelineProjectsView(page)
  await pollUntil(
    'project waterfall visible on card',
    async () => {
      const waterfall = page.getByTestId('project-waterfall').filter({ hasText: firstToken })
      return visible(waterfall, QUICK_MS)
    },
    { timeoutMs: RELEASE_WAIT_MS, intervalMs: 1_000 },
  )
  await expect(page.getByTestId('project-waterfall').filter({ hasText: secondToken })).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })
  await expect(page.getByTestId('project-milestones').getByText(`Beta ${stamp}`)).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })

  const before = await findProject(page, created.entityId)
  if (!before?.tasks || before.tasks.length < 2) {
    throw new Error(`Expected sequenced tasks on project, got ${JSON.stringify(before?.tasks)}`)
  }

  // Complete the head task via temporal-events action (same path as UI mark-done).
  const headItemId = `task:${firstThoughtId}`
  const completeRes = await page.request.post(`/api/temporal-events/${encodeURIComponent(headItemId)}/action`, {
    data: { action: 'mark_done' },
  })
  if (!completeRes.ok()) {
    // Some environments use action without `action` key — try instruction form.
    const alt = await page.request.post(`/api/temporal-events/${encodeURIComponent(headItemId)}/action`, {
      data: { instruction: 'mark as done' },
    })
    if (!alt.ok()) {
      throw new Error(
        `mark head task done failed (${completeRes.status()}/${alt.status()}): ${await completeRes.text()} / ${await alt.text()}`,
      )
    }
  }

  await pollUntil(
    'next action advanced to second waterfall task',
    async () => {
      const row = await findProject(page, created.entityId)
      return row?.nextAction?.thoughtId === secondThoughtId
    },
    { timeoutMs: RELEASE_WAIT_MS, intervalMs: 1_000 },
  )
}

/**
 * Project detail page: navigate from card (no drawer), switch list/timeline/kanban,
 * and keep completed tasks in the kanban Completed column.
 */
export async function assertProjectDetailPageViews(page: Page): Promise<void> {
  const stamp = Date.now()
  const projectLabel = `Detail Views Project ${stamp}`
  const openToken = `detail-open-${stamp}`
  const doneToken = `detail-done-${stamp}`

  const createRes = await page.request.post('/api/timeline/projects', {
    data: { label: projectLabel, status: 'active' },
  })
  if (!createRes.ok()) {
    throw new Error(`create detail views project failed (${createRes.status()}): ${await createRes.text()}`)
  }
  const created = (await createRes.json()) as { entityId: string }

  const openThoughtId = await captureThoughtViaUi(page, `TODO: ${openToken} prepare kickoff notes`)
  const doneThoughtId = await captureThoughtViaUi(page, `TODO: ${doneToken} finish the checklist`)

  for (const thoughtId of [openThoughtId, doneThoughtId]) {
    const assignRes = await page.request.post('/api/timeline/projects/assign', {
      data: { thoughtId, projectEntityId: created.entityId },
    })
    if (!assignRes.ok()) {
      throw new Error(`assign detail views task failed (${assignRes.status()}): ${await assignRes.text()}`)
    }
  }

  const doneAction = await page.request.post(
    `/api/temporal-events/${encodeURIComponent(`task:${doneThoughtId}`)}/action`,
    { data: { action: 'mark_done' } },
  )
  if (!doneAction.ok()) {
    throw new Error(`mark detail done task failed (${doneAction.status()}): ${await doneAction.text()}`)
  }

  await openProjectDetail(page, projectLabel)
  await expect(page.getByTestId('project-list-view')).toBeVisible({ timeout: RELEASE_WAIT_MS })
  await expect(page.getByText(openToken)).toBeVisible({ timeout: RELEASE_WAIT_MS })

  await page.getByRole('tab', { name: /Timeline|Zeitachse/i }).click()
  await expect(page).toHaveURL(/view=timeline/)
  await expect(page.getByTestId('project-gantt-view')).toBeVisible({ timeout: ACTION_MS })

  await page.getByRole('tab', { name: /Kanban/i }).click()
  await expect(page).toHaveURL(/view=kanban/)
  await expect(page.getByTestId('project-kanban-view')).toBeVisible({ timeout: ACTION_MS })
  await expect(
    page.getByTestId('project-kanban-column-completed').getByText(doneToken),
  ).toBeVisible({ timeout: RELEASE_WAIT_MS })
  await expect(page.getByTestId('project-kanban-column-open').getByText(openToken)).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/view=kanban/)
  await expect(page.getByTestId('project-kanban-view')).toBeVisible({ timeout: ACTION_MS })
}

/**
 * Project tidy-up review dialog: mock dry-run review, uncheck a new-task suggestion,
 * apply only the confirmed subset (no unconfirmed task created).
 */
export async function assertProjectReviewTidyUp(page: Page): Promise<void> {
  const stamp = Date.now()
  const projectLabel = `Tidy Up Project ${stamp}`
  const openToken = `tidy-open-${stamp}`
  const doneToken = `tidy-done-${stamp}`
  const newTaskToken = `tidy-new-${stamp}`

  const createRes = await page.request.post('/api/timeline/projects', {
    data: { label: projectLabel, status: 'active' },
  })
  if (!createRes.ok()) {
    throw new Error(`create tidy-up project failed (${createRes.status()}): ${await createRes.text()}`)
  }
  const created = (await createRes.json()) as { entityId: string }

  const openThoughtId = await captureThoughtViaUi(page, `TODO: ${openToken} prepare kickoff notes`)
  const doneThoughtId = await captureThoughtViaUi(page, `TODO: ${doneToken} finish the checklist`)

  for (const thoughtId of [openThoughtId, doneThoughtId]) {
    const assignRes = await page.request.post('/api/timeline/projects/assign', {
      data: { thoughtId, projectEntityId: created.entityId },
    })
    if (!assignRes.ok()) {
      throw new Error(`assign tidy-up task failed (${assignRes.status()}): ${await assignRes.text()}`)
    }
  }

  const reviewPayload = {
    projectEntityId: created.entityId,
    projectLabel,
    projectDeadline: null,
    tasks: [
      {
        thoughtId: openThoughtId,
        summary: openToken,
        rank: 1,
        status: 'open',
        deadline: null,
        isNextAction: true,
      },
      {
        thoughtId: doneThoughtId,
        summary: doneToken,
        rank: 2,
        status: 'open',
        deadline: null,
        isNextAction: false,
      },
    ],
    linkedThoughts: [],
    allowedThoughtIds: [openThoughtId, doneThoughtId],
    review: {
      projectDeadline: '2026-12-01T00:00:00.000Z',
      taskReviews: [
        {
          thoughtId: openThoughtId,
          suggestion: 'keep',
          deadline: null,
          reason: 'Still needed',
        },
        {
          thoughtId: doneThoughtId,
          suggestion: 'mark_done',
          deadline: null,
          reason: 'Looks finished',
        },
      ],
      order: [openThoughtId, doneThoughtId],
      newTaskSuggestions: [
        {
          summary: `${newTaskToken} book the venue`,
          kind: 'deadline',
          suggestedStartAt: null,
          suggestedEndAt: null,
          reason: 'Gap in waterfall',
        },
      ],
      nextActionThoughtId: openThoughtId,
      nextActionIsNewTaskIndex: null,
    },
  }

  await page.route(`**/api/timeline/projects/${created.entityId}/review`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    // Dry-run only — leave /review/apply unmocked.
    if (route.request().url().includes('/review/apply')) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reviewPayload),
    })
  })

  let applyBody: Record<string, unknown> | null = null
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes(`/api/timeline/projects/${created.entityId}/review/apply`)
    ) {
      try {
        applyBody = request.postDataJSON() as Record<string, unknown>
      } catch {
        applyBody = null
      }
    }
  })

  try {
    await openProjectDetail(page, projectLabel)
    await expect(page.getByTestId('project-review')).toBeVisible({ timeout: RELEASE_WAIT_MS })

    const reviewResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/timeline/projects/${created.entityId}/review`) &&
        !res.url().includes('/apply') &&
        res.request().method() === 'POST',
      { timeout: ACTION_MS },
    )
    await page.getByTestId('project-review').click()
    await reviewResponse

    const dialog = page.getByTestId('project-review-dialog')
    await expect(dialog).toBeVisible({ timeout: ACTION_MS })
    await expect(dialog.getByText(newTaskToken)).toBeVisible({ timeout: ACTION_MS })
    await expect(dialog.getByText(doneToken)).toBeVisible({ timeout: ACTION_MS })

    // Uncheck the suggested new task so it is not created.
    const newTaskRow = dialog.getByTestId('project-review-new-task-0')
    await newTaskRow.locator('[data-slot="checkbox"]').click()

    const applyResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/timeline/projects/${created.entityId}/review/apply`) &&
        res.request().method() === 'POST',
      { timeout: ACTION_MS },
    )
    await dialog.getByRole('button', { name: /Apply selected|Auswahl anwenden/i }).click()
    const applyRes = await applyResponse
    if (!applyRes.ok()) {
      throw new Error(`project review apply failed (${applyRes.status()}): ${await applyRes.text()}`)
    }
    await expect(dialog).toBeHidden({ timeout: QUICK_MS })

    if (!applyBody) {
      throw new Error('Did not capture review/apply request body')
    }
    expect(applyBody.newTasks, 'unchecked new task must not be in apply body').toEqual([])
    expect(applyBody.markDone).toEqual([doneThoughtId])
    expect(applyBody.nextActionThoughtId).toBe(openThoughtId)

    // Unconfirmed new-task token must not appear on the project list.
    await expect(page.getByTestId('project-detail-page').getByText(newTaskToken)).toHaveCount(0, {
      timeout: RELEASE_WAIT_MS,
    })
    await expect(page.getByTestId('project-detail-page').getByText(openToken)).toBeVisible({
      timeout: RELEASE_WAIT_MS,
    })
  } finally {
    await page.unroute(`**/api/timeline/projects/${created.entityId}/review`).catch(() => undefined)
  }
}

type ScheduledTaskSnapshot = {
  activeRun?: unknown
  lastRunAt?: string | null
  lastRunStatus?: string | null
}

async function fetchScheduledTask(page: Page): Promise<ScheduledTaskSnapshot | null> {
  const res = await page.request.get('/api/scheduled-tasks')
  if (!res.ok()) return null
  const body = (await res.json()) as { tasks?: ScheduledTaskSnapshot[] }
  return body.tasks?.[0] ?? null
}

/** Run overnight consolidation from Settings → Heartbeat and wait for completion. */
export async function exerciseOvernightConsolidation(page: Page): Promise<void> {
  await page.goto('/settings/scheduled-tasks')
  await expect(page.getByRole('heading', { name: 'Heartbeat' })).toBeVisible()

  const baseline = await fetchScheduledTask(page)
  const baselineLastRunAt = baseline?.lastRunAt ?? null

  const runNow = page.getByRole('button', { name: 'Run now' })
  let triggered = false
  if (await runNow.isVisible().catch(() => false)) {
    // POST returns 202 immediately; drain continues in the background.
    const triggerResponse = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        /\/api\/scheduled-tasks\/[^/]+$/.test(res.url()) &&
        (res.status() === 202 || res.status() === 409),
      { timeout: RELEASE_HEARTBEAT_WAIT_MS },
    )
    await runNow.click()
    const response = await triggerResponse
    if (!response.ok() && response.status() !== 409) {
      throw new Error(`Heartbeat trigger failed (${response.status()}): ${await response.text()}`)
    }
    triggered = true
  }

  await expect
    .poll(
      async () => {
        const task = await fetchScheduledTask(page)
        if (!task) return false
        if (task.activeRun || task.lastRunStatus === 'running') return false
        if (task.lastRunStatus !== 'completed' || !task.lastRunAt) return false
        if (triggered) return task.lastRunAt !== baselineLastRunAt
        return true
      },
      { timeout: RELEASE_HEARTBEAT_WAIT_MS, intervals: [1000, 2000, 3000] },
    )
    .toBe(true)

  await expect(page.getByText('Heartbeat finished.')).toBeVisible({ timeout: RELEASE_WAIT_MS })
}

/**
 * Headed-release guard: cold `/memory/tasks` must stay within
 * `TIMELINE_MOUNT_FETCH_BUDGET` (one unified `/api/timeline` fetch).
 */
export async function assertTimelineMountFetchBudget(page: Page): Promise<void> {
  await page.goto('/capture', { waitUntil: 'domcontentloaded' })

  const urls: string[] = []
  const onRequest = (request: Request) => {
    if (request.method() !== 'GET') return
    const url = request.url()
    if (isTimelineUnifiedFetch(url)) {
      urls.push(url)
    }
  }
  page.on('request', onRequest)

  try {
    await page.goto('/memory/tasks', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: RELEASE_WAIT_MS })

    await pollUntil(
      `tasks cold-mount fetch budget (≤${TIMELINE_MOUNT_FETCH_BUDGET.timelineUnified} unified /api/timeline)`,
      async () => {
        // 0 client fetches is valid: SSR prefetches and onMount skips load() when seeded.
        const before = urls.length
        await new Promise((r) => setTimeout(r, 750))
        if (urls.length !== before) return false
        return findMountFetchBudgetViolations(urls).length === 0
      },
      { timeoutMs: RELEASE_WAIT_MS, intervalMs: 100 },
    )

    const violations = findMountFetchBudgetViolations(urls)
    expect(
      violations,
      `Tasks cold-mount fetch budget exceeded.\nViolations: ${violations.join('; ')}\nURLs:\n${urls.join('\n')}`,
    ).toEqual([])
  } finally {
    page.off('request', onRequest)
  }
}

/**
 * Timeline filters: AI date dial + shared Tasks/Projects data; kinds filter gone.
 * Dial presets (Last week / Last month / All time) resolve locally — no parse-date-range call.
 */
export async function assertTimelineSharedFiltersAndDial(page: Page): Promise<void> {
  await page.goto('/capture', { waitUntil: 'domcontentloaded' })

  let parseDateRangeCalls = 0
  await page.route('**/api/timeline/parse-date-range', async (route) => {
    parseDateRangeCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        from: '2026-07-14T00:00:00.000Z',
        to: '2026-07-20T23:59:59.999Z',
        includeUndated: false,
        label: 'Last week',
      }),
    })
  })

  const listUrls: string[] = []
  const onRequest = (request: Request) => {
    if (request.method() !== 'GET') return
    const url = request.url()
    if (isTimelineUnifiedFetch(url)) listUrls.push(url)
  }
  page.on('request', onRequest)

  try {
    await page.goto('/memory/tasks', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: RELEASE_WAIT_MS })

    await expect(page.locator('#timeline-date-range-trigger')).toBeVisible({
      timeout: RELEASE_WAIT_MS,
    })

    // Kinds filter is gone: open the Filters popover and confirm no "Event kinds"
    // group / "Clear kinds" button remain. Use a11y roles + accessible names
    // (not substring text matching) so incidental copy can't trip the guard.
    const filtersTrigger = page.getByRole('button', { name: /^filters?$/i })
    await expect(filtersTrigger).toBeVisible({ timeout: RELEASE_WAIT_MS })
    await filtersTrigger.click()
    await expect(page.getByRole('group', { name: /event kinds|ereignistypen/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /clear kinds|arten zurücksetzen/i })).toHaveCount(
      0,
    )
    // Close Filters fully before opening the date dial. Otherwise the dismissable
    // layer can swallow the dial click as an outside-dismiss (popover never opens).
    await page.keyboard.press('Escape')
    const filtersPanel = page.locator('#timeline-options-panel')
    if (await filtersPanel.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape')
    }
    await expect(filtersPanel).toBeHidden({ timeout: ACTION_MS })

    const dial = page.locator('#timeline-date-range-trigger')
    await expect(dial).toBeVisible({ timeout: RELEASE_WAIT_MS })
    await dial.click()
    const dialPanel = page.locator('#timeline-date-range-panel')
    await expect(dialPanel).toBeVisible({ timeout: RELEASE_WAIT_MS })
    const lastWeek = dialPanel.getByRole('button', { name: /last week|letzte woche/i })
    await expect(lastWeek).toBeVisible({ timeout: RELEASE_WAIT_MS })
    await lastWeek.click()
    await expect(dialPanel).toBeHidden({ timeout: ACTION_MS })

    await pollUntil(
      'unified /api/timeline refetch with absolute from/to after dial (local preset)',
      async () =>
        listUrls.some((u) => {
          try {
            const parsed = new URL(u)
            const from = parsed.searchParams.get('from')
            const to = parsed.searchParams.get('to')
            return Boolean(from && to) && !u.includes('kinds=')
          } catch {
            return false
          }
        }),
      { timeoutMs: RELEASE_WAIT_MS, intervalMs: 200 },
    )

    expect(
      parseDateRangeCalls,
      'Last week preset must resolve locally — must not call /api/timeline/parse-date-range',
    ).toBe(0)

    const beforeProjectsNav = listUrls.length
    await page.goto('/memory/projects', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: ADD_PROJECT_BTN })).toBeVisible({
      timeout: RELEASE_WAIT_MS,
    })

    const postNavTemporal = listUrls.slice(beforeProjectsNav)
    expect(
      postNavTemporal.every((u) => !u.includes('range=all&status=all')),
      'Projects page must not refetch range=all&status=all independently',
    ).toBe(true)
  } finally {
    page.off('request', onRequest)
    await page.unroute('**/api/timeline/parse-date-range').catch(() => undefined)
  }
}

/**
 * Tasks search: graph-style morph icon in the header; nonsense query hides rows and zeros To Do.
 */
export async function assertTimelineTasksSearch(page: Page): Promise<void> {
  await page.goto('/memory/tasks', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tablist')).toBeVisible({ timeout: RELEASE_WAIT_MS })

  const todoTab = page.getByRole('tab', { name: /to\s*do|offen/i })
  await todoTab.click()

  const searchTrigger = page.getByRole('button', {
    name: /search tasks|aufgaben durchsuchen/i,
  })
  await expect(searchTrigger).toBeVisible({ timeout: RELEASE_WAIT_MS })
  await searchTrigger.click()

  const search = page.locator('#timeline-tasks-search')
  await expect(search).toBeVisible({ timeout: RELEASE_WAIT_MS })

  await search.fill('__no_such_task_xyz_release__')
  await expect
    .poll(
      async () => {
        const text = (await todoTab.innerText()).replace(/\s+/g, ' ').trim()
        const match = text.match(/^(\d+)/)
        return match ? Number.parseInt(match[1]!, 10) : 0
      },
      { timeout: RELEASE_WAIT_MS },
    )
    .toBe(0)

  const listbox = page.getByRole('listbox')
  await expect(listbox.locator('[role="option"], li')).toHaveCount(0, { timeout: RELEASE_WAIT_MS })

  await search.fill('')
  await page.keyboard.press('Escape')
}

/**
 * Single-source-of-truth: tab badge counts match visible list lengths;
 * overdue badge equals overdue list; project board cards only for projects with tasks in range.
 */
export async function assertTimelineSsotCountsAndLists(page: Page): Promise<void> {
  await page.goto('/memory/tasks', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tablist')).toBeVisible({ timeout: RELEASE_WAIT_MS })

  const todoTab = page.getByRole('tab', { name: /to\s*do|offen/i })
  const doneTab = page.getByRole('tab', { name: /done|erledigt/i })
  const overdueTab = page.getByRole('tab', { name: /overdue|überfällig/i })

  await expect(todoTab).toBeVisible({ timeout: RELEASE_WAIT_MS })

  async function countFromTab(tab: Locator): Promise<number> {
    // Tabs render count then label ("1 Overdue", "0 To do"). Overdue with 0 shows "—".
    const text = (await tab.innerText()).replace(/\s+/g, ' ').trim()
    const match = text.match(/^(\d+)/)
    return match ? Number.parseInt(match[1]!, 10) : 0
  }

  async function visibleRowCount(listbox: Locator): Promise<number> {
    return listbox.locator('[role="option"], li').count()
  }

  const listbox = page.getByRole('listbox')

  await todoTab.click()
  const todoBadge = await countFromTab(todoTab)
  const todoRows = await visibleRowCount(listbox)
  expect(todoBadge, 'To Do badge must equal visible To Do rows').toBe(todoRows)

  await doneTab.click()
  const doneBadge = await countFromTab(doneTab)
  const doneRows = await visibleRowCount(listbox)
  expect(doneBadge, 'Done badge must equal visible Done rows').toBe(doneRows)

  await overdueTab.click()
  const overdueBadge = await countFromTab(overdueTab)
  const overdueRows = await visibleRowCount(listbox)
  expect(overdueBadge, 'Overdue badge must equal visible Overdue rows').toBe(overdueRows)

  // Projects board: no separate catalog-only cards without tasks in the loaded set.
  // Cold projects page must use /api/timeline (same SSOT), not a lone /api/timeline/projects list fan-out for the board.
  const projectCatalogFetches: string[] = []
  const onRequest = (request: Request) => {
    if (request.method() !== 'GET') return
    const url = request.url()
    if (url.includes('/api/timeline/projects') && !url.includes('/assign')) {
      projectCatalogFetches.push(url)
    }
  }
  page.on('request', onRequest)
  try {
    await page.goto('/memory/projects', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: ADD_PROJECT_BTN })).toBeVisible({
      timeout: RELEASE_WAIT_MS,
    })
    await new Promise((r) => setTimeout(r, 800))
    expect(
      projectCatalogFetches,
      'Projects board must not call GET /api/timeline/projects — catalog comes from unified /api/timeline',
    ).toEqual([])
  } finally {
    page.off('request', onRequest)
  }
}

/** Click through primary chrome, tabs, filters, and non-destructive dialogs. */
export async function exerciseAuthenticatedUi(page: Page): Promise<void> {
  for (const surface of AUTHENTICATED_SURFACES) {
    await waitForAuthenticatedPage(page, surface.path)
  }

  await exerciseBottomNav(page)
  await exerciseAccountMenu(page)
  await exerciseMemoryUi(page)
  await exerciseCaptureUi(page)
  await exerciseChatUi(page)
  await exerciseChatFailureUi(page)
  await exerciseSettingsUi(page)
  await exerciseApiKeysUi(page)
  await exerciseActivityUi(page)
  await exerciseLegacyRedirects(page)
}

async function exerciseBottomNav(page: Page): Promise<void> {
  for (const label of ['Memory', 'Capture', 'Chat'] as const) {
    await page.getByRole('link', { name: label, exact: true }).click()
    await expect(page).not.toHaveURL(/\/login/)
  }
}

async function exerciseAccountMenu(page: Page): Promise<void> {
  await page.goto('/capture')
  await openAccountMenu(page)

  for (const item of ['Activity', 'API Keys', 'Credits', 'Heartbeat', 'Settings'] as const) {
    await page.getByRole('link', { name: item, exact: true }).click()
    await expect(page).not.toHaveURL(/\/login/)
    await openAccountMenu(page)
  }

  const evalLink = page.getByRole('link', { name: 'Evals', exact: true })
  if (await evalLink.isVisible().catch(() => false)) {
    await evalLink.click()
    await expect(page).toHaveURL(/\/eval/)
    await page.goto('/capture')
  }

  await openAccountMenu(page)
  await page.getByRole('link', { name: 'Give us Feedback', exact: true }).click()
  await expect(page).toHaveURL(/\/feedback/)
  await exerciseFeedbackSubmit(page)
}

/** Submit product feedback via the UI; server emails feedback@eigenmesh.xyz via useSend. */
export async function exerciseFeedbackSubmit(page: Page): Promise<void> {
  await page.goto('/feedback')
  await expect(page.getByRole('heading', { name: 'Help shape Eigen Mesh' })).toBeVisible()
  const note = `Release smoke feedback ${Date.now()}`
  await page.getByLabel('Message').fill(note)
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByRole('status')).toContainText(/Got it/i, { timeout: 30_000 })
}

async function exerciseMemoryUi(page: Page): Promise<void> {
  await page.goto('/memory')

  for (const tab of ['Graph', 'Embeddings', 'Tasks', 'Projects', 'Notes'] as const) {
    await page.getByRole('link', { name: tab, exact: true }).click()
    await expect(page).not.toHaveURL(/\/login/)
  }

  await page.getByRole('link', { name: 'Graph', exact: true }).click()
  await exerciseGraphFilters(page)

  // Timeline was split into Tasks and Projects routes (commit 26b7bd0); exercise both
  // instead of the removed Timeline tab and its Tasks/Projects toggle button.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  for (const segment of ['To do', 'Done', 'Overdue'] as const) {
    const segTab = page.getByRole('tab', { name: segment, exact: true })
    if (await segTab.isVisible().catch(() => false)) {
      await segTab.click()
    }
  }

  await page.getByRole('link', { name: 'Projects', exact: true }).click()

  await page.getByRole('link', { name: 'Notes', exact: true }).click()
  const newNote = page.getByRole('button', { name: 'New note', exact: true })
  if (await newNote.isVisible().catch(() => false)) {
    await newNote.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await dismissOpenOverlays(page)
  }
}

async function exerciseGraphFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Search nodes', exact: true }).click()
  await page.locator('#graph-search').fill('Lisbon')
  await dismissOpenOverlays(page)

  await page.getByRole('button', { name: 'Edge type filter', exact: true }).click()
  const coMention = page.getByRole('option', { name: 'Co-mentioned' })
  if (await coMention.isVisible().catch(() => false)) {
    await coMention.click()
  }
  await dismissOpenOverlays(page)

  await page.getByRole('button', { name: 'Community level filter', exact: true }).click()
  await dismissOpenOverlays(page)

  const entityFilter = page.getByRole('button', { name: 'Entity type filter', exact: true })
  if (await entityFilter.isVisible().catch(() => false)) {
    await entityFilter.click()
    await dismissOpenOverlays(page)
  }
}

async function exerciseCaptureUi(page: Page): Promise<void> {
  await assertVoiceTranscribeApi(page, { timeoutMs: RELEASE_WAIT_MS })
  await installVoiceCaptureMocks(page)
  await exerciseVoiceCaptureUi(page, { timeoutMs: RELEASE_WAIT_MS })

  await page.goto('/capture')

  const expand = page.getByRole('button', { name: 'Expand thought' }).first()
  if (await expand.isVisible().catch(() => false)) {
    await expand.click()
    await page.getByRole('button', { name: 'Collapse thought' }).first().click()
  }
}

type TextFileApiRow = {
  id: string
  title: string
  body: string
}

async function listTextFilesViaApi(page: Page): Promise<TextFileApiRow[]> {
  const res = await page.request.get('/api/text-files?limit=100')
  if (!res.ok()) {
    throw new Error(`GET /api/text-files failed (${res.status()}): ${await res.text()}`)
  }
  const body = (await res.json()) as { textFiles?: TextFileApiRow[] }
  return body.textFiles ?? []
}

/**
 * Create a shopping-list note in the Notes UI, ask chat to append an item, and
 * assert the existing note was updated (no duplicate text_file row).
 */
export async function exerciseNotesShoppingListAppend(page: Page): Promise<void> {
  const noteTitle = 'Shopping list'
  const initialBody = 'eggs'
  const appendItem = 'milk'

  await page.goto('/memory/notes')
  await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })

  await page.getByRole('button', { name: 'New note', exact: true }).click()
  const createDialog = page.getByRole('dialog').filter({
    has: page.locator('#create-title'),
  })
  await expect(createDialog).toBeVisible({ timeout: RELEASE_WAIT_MS })
  await createDialog.locator('#create-title').fill(noteTitle)
  await createDialog.locator('#create-body').fill(initialBody)
  await createDialog.getByRole('button', { name: 'New note', exact: true }).click()
  // Create dialog closes; product then opens the edit drawer for the new note.
  await expect(createDialog).toBeHidden({ timeout: RELEASE_WAIT_MS })
  const editDrawer = page.getByRole('dialog').filter({
    has: page.locator('#note-title'),
  })
  await expect(editDrawer).toBeVisible({ timeout: RELEASE_WAIT_MS })
  await expect(editDrawer.locator('#note-title')).toHaveValue(noteTitle)
  await page.keyboard.press('Escape')
  await expect(editDrawer).toBeHidden({ timeout: RELEASE_WAIT_MS })
  await expect(page.getByRole('button', { name: new RegExp(noteTitle, 'i') }).first()).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })

  const before = await listTextFilesViaApi(page)
  const shoppingBefore = before.filter(
    (f) => f.title.trim().toLowerCase() === noteTitle.toLowerCase(),
  )
  expect(shoppingBefore, 'expected exactly one Shopping list note after create').toHaveLength(1)
  expect(shoppingBefore[0]?.body).toContain(initialBody)
  const noteId = shoppingBefore[0]!.id

  await startNewChatSession(page)
  const question = `Add ${appendItem} to my shopping list note`
  await askChatQuestion(page, question)
  await expect(page.getByText(question)).toBeVisible({ timeout: RELEASE_WAIT_MS })

  await assertChatLoadingVisible(page)
  await waitForChatIdle(page, RELEASE_INDEXING_WAIT_MS)
  await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({
    timeout: RELEASE_INDEXING_WAIT_MS,
  })

  const logText = (await page.getByRole('log', { name: 'Chat messages' }).textContent()) ?? ''
  assertChatLogHasNoRawJson(logText)
  await expect(page.locator('.animate-spin')).toHaveCount(0)

  await expect
    .poll(
      async () => {
        const files = await listTextFilesViaApi(page)
        const shopping = files.filter(
          (f) => f.title.trim().toLowerCase() === noteTitle.toLowerCase(),
        )
        if (shopping.length !== 1) return `count=${shopping.length}`
        const body = shopping[0]?.body ?? ''
        if (shopping[0]?.id !== noteId) return 'id-changed'
        if (!body.includes(initialBody)) return 'missing-eggs'
        if (!body.includes(appendItem)) return 'missing-milk'
        return 'ok'
      },
      { timeout: RELEASE_WAIT_MS, intervals: [500, 1000, 2000] },
    )
    .toBe('ok')

  await page.goto('/memory/notes')
  await expect(page.getByText(appendItem, { exact: false }).first()).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })
  const listButtons = page.getByRole('button', { name: new RegExp(noteTitle, 'i') })
  await expect(listButtons).toHaveCount(1)
}

async function exerciseChatUi(page: Page): Promise<void> {
  await startNewChatSession(page)

  const question = 'What city did I mention in my recent capture?'
  await askChatQuestion(page, question)
  await expect(page.getByText(question)).toBeVisible({ timeout: RELEASE_WAIT_MS })

  await assertChatLoadingVisible(page)
  // Clear questions must go through answer_question (compose), not retrieve-only browse.
  await expect(page.getByText('Answering your question')).toBeVisible({
    timeout: RELEASE_INDEXING_WAIT_MS,
  })
  await waitForChatAnswerMarker(page, /Lisbon/i, RELEASE_INDEXING_WAIT_MS)
  await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({
    timeout: RELEASE_WAIT_MS,
  })

  const logText = (await page.getByRole('log', { name: 'Chat messages' }).textContent()) ?? ''
  assertChatLogHasNoRawJson(logText)
  expect(logText, 'clear question should use answer_question compose path').toMatch(
    /Answering your question/i,
  )
  await expect(page.locator('.animate-spin')).toHaveCount(0)
  await waitForChatIdle(page, RELEASE_WAIT_MS)

  // Streamed answer must match the session reload from the server.
  await assertChatStreamMatchesReload(page, {
    timeoutMs: RELEASE_WAIT_MS,
    answerMarker: /Lisbon/i,
  })
}

async function exerciseChatFailureUi(page: Page): Promise<void> {
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      body:
        '{"type":"agent_progress","label":"Planning next step…"}\n' +
        '{"type":"error","error":"Chat service unavailable for this test."}\n',
    })
  })

  try {
    await startNewChatSession(page)
    await askChatQuestion(page, 'What did I capture recently?')

    await expect
      .poll(
        async () =>
          (await page
            .getByText(/Planning next step|Connecting…|Working…/i)
            .first()
            .isVisible()
            .catch(() => false)) ||
          (await page
            .locator('.animate-spin')
            .first()
            .isVisible()
            .catch(() => false)) ||
          (await page
            .getByText(/Chat service unavailable for this test/i)
            .isVisible()
            .catch(() => false)),
        { timeout: RELEASE_WAIT_MS, intervals: [100, 250, 500] },
      )
      .toBe(true)

    await expect(page.getByText(/Chat service unavailable for this test/i)).toBeVisible({
      timeout: RELEASE_WAIT_MS,
    })
    await waitForChatIdle(page, RELEASE_WAIT_MS)

    const logText = (await page.getByRole('log', { name: 'Chat messages' }).textContent()) ?? ''
    assertChatLogHasNoRawJson(logText)
    await expect(page.locator('.animate-spin')).toHaveCount(0)
  } finally {
    await page.unroute('**/api/chat')
  }
}

async function exerciseSettingsUi(page: Page): Promise<void> {
  await page.goto('/settings')

  for (const tab of [
    'Appearance',
    'Speech',
    'Account',
    'Notifications',
    'Memory',
    'Danger zone',
  ] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
  }

  await page.goto('/settings/llm')
  await expect(page).not.toHaveURL(/\/login/)
}

async function exerciseApiKeysUi(page: Page): Promise<void> {
  await page.goto('/api-keys')
  await page.getByRole('button', { name: 'Generate new key', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
}

async function exerciseActivityUi(page: Page): Promise<void> {
  await page.goto('/activity')
  await expect(page.locator('table')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('tbody tr').first()).toBeVisible()
}

async function exerciseLegacyRedirects(page: Page): Promise<void> {
  await page.goto('/graph')
  await expect(page).toHaveURL(/\/memory/)
}

/**
 * Notification deep-link contract: `/capture?checkin=1` must surface the
 * pending grounding question card (same question text the push would carry).
 * Routes the question API so this assertion does not depend on a live push.
 */
export async function assertCheckInDeepLinkShowsPendingQuestion(page: Page): Promise<void> {
  const pendingQuestion = 'Where do you work?'
  await page.route('**/api/grounding/question', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        due: false,
        pending: true,
        question: {
          kind: 'grounding',
          facetKey: 'work',
          question: pendingQuestion,
        },
      }),
    })
  })

  await page.goto('/capture?checkin=1')
  const card = page.locator('#grounding-question')
  await expect(card).toBeVisible({ timeout: RELEASE_WAIT_MS })
  await expect(card.getByText(pendingQuestion)).toBeVisible()

  await page.unroute('**/api/grounding/question')
}
