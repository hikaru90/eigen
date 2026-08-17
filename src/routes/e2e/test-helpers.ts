import { expect, type Page, type BrowserContext } from '@playwright/test'
import { HARNESS_E2E_PASSWORD } from '$lib/e2e/harness-credentials'

export const TEST_PASSWORD = HARNESS_E2E_PASSWORD

let userCounter = 0

export type RegisterUserOptions = {
  /** Defaults to `test.eigen` (harness). Use a production domain to exercise onboarding. */
  emailDomain?: string
}

/**
 * Register a fresh test user and return their credentials + the context with session cookies.
 */
export async function registerUser(
  context: BrowserContext,
  page: Page,
  options?: RegisterUserOptions,
): Promise<{ email: string }> {
  userCounter += 1
  const id = `${Date.now()}-${userCounter}`
  const emailDomain = options?.emailDomain ?? 'test.eigen'
  const email = `e2e-${id}@${emailDomain}`

  await page.goto('/signup')
  await page.getByRole('button', { name: 'Create account' }).waitFor({ state: 'visible' })

  const firstName = 'Test'
  const lastName = `User ${id}`
  const firstNameInput = page.locator('#firstName')
  const lastNameInput = page.locator('#lastName')
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')

  // Fill email/password first, then names last — early fills can be cleared by Svelte hydration.
  await emailInput.fill(email)
  await passwordInput.fill(TEST_PASSWORD)
  await firstNameInput.fill(firstName)
  await lastNameInput.fill(lastName)

  await expect(firstNameInput).toHaveValue(firstName)
  await expect(lastNameInput).toHaveValue(lastName)
  await expect(emailInput).toHaveValue(email)
  await expect(passwordInput).toHaveValue(TEST_PASSWORD)

  const terms = page.getByRole('checkbox', { name: /Terms of Service|AGB/i })
  await terms.check()
  await expect(terms).toBeChecked()

  await page.getByRole('button', { name: 'Create account' }).click()

  await completeEmailVerificationIfRequired(page, email)

  await page.waitForURL(/\/capture/)
  return { email }
}

/**
 * When email verification is enabled (useSend configured), signup stays on /signup and shows a
 * "check your email" notice instead of redirecting. The dev-only harness endpoint exposes the
 * verification link Better Auth generated so we can follow it and land on /capture.
 */
async function completeEmailVerificationIfRequired(page: Page, email: string): Promise<void> {
  const checkEmailNotice = page.getByText(/Check your email for a verification link/i)
  const landed = await Promise.race([
    page.waitForURL(/\/capture/, { timeout: 15_000 }).then(() => 'capture' as const),
    checkEmailNotice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'verify' as const),
  ]).catch(() => 'unknown' as const)

  if (landed === 'capture') return

  const link = await fetchVerificationLink(page, email)
  const target = new URL(link)
  await page.goto(`${target.pathname}${target.search}`)
}

async function fetchVerificationLink(page: Page, email: string): Promise<string> {
  let link: string | null = null
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/e2e/harness/verification-link?email=${encodeURIComponent(email)}`,
        )
        if (!res.ok()) {
          throw new Error(
            `verification-link endpoint failed (${res.status()}): ${await res.text()}`,
          )
        }
        const body = (await res.json()) as { link?: string | null }
        link = body.link ?? null
        return link
      },
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    .not.toBeNull()

  if (!link) {
    throw new Error(`No verification link captured for ${email}`)
  }
  return link
}

/**
 * Login an existing user via the login form.
 */
export async function loginUser(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.waitForURL(/\/login/, { timeout: 15_000 })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/capture/)
}

/**
 * Sign out via the session API (POST — GET does not clear the Better Auth session).
 */
export async function signOut(page: Page): Promise<void> {
  const res = await page.request.post('/api/session/sign-out')
  if (!res.ok()) {
    throw new Error(`sign-out failed (${res.status()}): ${await res.text()}`)
  }
  await page.goto('/login')
  await page.waitForURL(/\/login/, { timeout: 15_000 })
}

/**
 * Capture a thought by submitting to the API (used for seeding test data).
 * Returns the stored thought id.
 */
export async function captureThought(
  page: Page,
  raw: string,
): Promise<{ id: string; normalizedText: string; category: string }> {
  const res = await page.request.post('/api/capture/submit', {
    data: { raw },
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`captureThought failed (${res.status()}): ${body}`)
  }
  const j = (await res.json()) as {
    thought: { id: string; normalizedText: string; category: string }
  }
  return j.thought
}

/**
 * Navigate to a protected route and assert redirect to /login.
 */
export async function assertRedirectsToLogin(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForURL(/\/login/)
}

/** Detects raw JSON/tool payloads that must never appear in user-visible chat text. */
export const CHAT_RAW_JSON_PATTERN = /\{"|\btool"\s*:|"arguments"\s*:|"results"\s*:|"items"\s*:/

export const CHAT_SNAKE_CASE_TOOL_PATTERN = /Running\s+[a-z]+_[a-z0-9_]+/i

export function assertChatLogHasNoRawJson(logText: string): void {
  expect(logText, 'chat should not expose raw JSON to the user').not.toMatch(CHAT_RAW_JSON_PATTERN)
  expect(logText, 'chat should not show snake_case tool names').not.toMatch(
    CHAT_SNAKE_CASE_TOOL_PATTERN,
  )
}

export async function startNewChatSession(page: Page): Promise<void> {
  await page.goto('/chat')
  await expect(page.getByPlaceholder('Ask a question about your memories...')).toBeVisible({
    timeout: 30_000,
  })

  const toggle = page.getByRole('button', { name: 'Toggle session list' })
  if (!(await toggle.isVisible().catch(() => false))) return

  await toggle.click()
  const newChat = page.getByRole('button', { name: 'New chat', exact: true })
  if (await newChat.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await newChat.click()
    // New chat must leave a blank compose — not a prior session that can race-reload mid-stream.
    await expect(
      page.getByText(
        'Ask about your memories, manage thoughts, or save something new when you want to.',
      ),
    ).toBeVisible({ timeout: 10_000 })
  }
  const closeSidebar = page.getByRole('button', { name: 'Close sidebar' })
  if (await closeSidebar.isVisible().catch(() => false)) {
    await closeSidebar.click()
  }
}

export async function askChatQuestion(page: Page, question: string): Promise<void> {
  const input = page.getByPlaceholder('Ask a question about your memories...')
  await expect(input).toBeVisible()
  await input.click()
  await input.fill(question)
  await expect(input).toHaveValue(question)
  await input.press('Enter')
  await expect(page.getByRole('log', { name: 'Chat messages' }).getByText(question)).toBeVisible({
    timeout: 15_000,
  })
}

export async function waitForChatIdle(page: Page, timeoutMs = 120_000): Promise<void> {
  const input = page.getByPlaceholder('Ask a question about your memories...')
  await expect(input).toBeEnabled({ timeout: timeoutMs })
}

export async function assertChatLoadingVisible(page: Page): Promise<void> {
  const progress = page.getByText(
    /Connecting…|Working…|Planning next step|Searching your memories|Searching text notes|Appending to text note|Creating text note|Updating text note|Preparing your reply|Answering your question|Checking your schedule/i,
  )
  const spinner = page.locator('.animate-spin').first()
  await expect
    .poll(
      async () =>
        (await progress
          .first()
          .isVisible()
          .catch(() => false)) || (await spinner.isVisible().catch(() => false)),
      { timeout: 10_000, intervals: [100, 250, 500] },
    )
    .toBe(true)
}

export async function waitForChatAnswerMarker(
  page: Page,
  marker: RegExp | string,
  timeoutMs = 120_000,
): Promise<string> {
  const log = page.getByRole('log', { name: 'Chat messages' })
  const pattern = typeof marker === 'string' ? new RegExp(marker, 'i') : marker
  await waitForChatIdle(page, timeoutMs)
  await expect
    .poll(async () => (await log.textContent()) ?? '', { timeout: timeoutMs })
    .toMatch(pattern)
  const logText = (await log.textContent()) ?? ''
  assertChatLogHasNoRawJson(logText)
  return logText
}

export function normalizeChatLogText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Final assistant answer bubble (the message with "Regenerate answer").
 * Ephemeral stream progress labels are excluded by design.
 */
export async function readChatFinalAnswerText(page: Page): Promise<string> {
  const regenerate = page.getByRole('button', { name: 'Regenerate answer' }).last()
  await expect(regenerate).toBeVisible()
  const bubble = regenerate.locator('xpath=ancestor::div[contains(@class,"group")][1]')
  return normalizeChatLogText((await bubble.innerText()) ?? '')
}

/**
 * After a completed stream turn: reload the chat page and assert the persisted
 * session answer matches what the live NDJSON stream rendered.
 */
export async function assertChatStreamMatchesReload(
  page: Page,
  options?: { timeoutMs?: number; answerMarker?: RegExp | string },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000
  const marker =
    typeof options?.answerMarker === 'string'
      ? new RegExp(options.answerMarker, 'i')
      : (options?.answerMarker ?? /./)

  await waitForChatIdle(page, timeoutMs)
  await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({
    timeout: timeoutMs,
  })

  const streamAnswer = await readChatFinalAnswerText(page)
  expect(streamAnswer.length, 'stream should produce a non-empty answer').toBeGreaterThan(0)
  expect(streamAnswer, 'stream answer should include expected marker').toMatch(marker)
  assertChatLogHasNoRawJson(streamAnswer)

  await page.reload()
  await expect(page.getByPlaceholder('Ask a question about your memories...')).toBeVisible({
    timeout: timeoutMs,
  })
  await waitForChatIdle(page, timeoutMs)

  const log = page.getByRole('log', { name: 'Chat messages' })
  await expect
    .poll(async () => normalizeChatLogText((await log.textContent()) ?? ''), {
      timeout: timeoutMs,
    })
    .toMatch(marker)
  await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({
    timeout: timeoutMs,
  })

  const reloadedAnswer = await readChatFinalAnswerText(page)
  assertChatLogHasNoRawJson(reloadedAnswer)
  expect(reloadedAnswer, 'persisted chat answer on reload should match stream response').toBe(
    streamAnswer,
  )
}
