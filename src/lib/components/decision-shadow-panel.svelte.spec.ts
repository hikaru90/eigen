import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import type { DecisionShadowView } from '$lib/server/llm/decision-shadow-query'
import DecisionShadowPanel from './decision-shadow-panel.svelte'

function view(overrides?: Partial<DecisionShadowView>): DecisionShadowView {
  return {
    summary: {
      total: 4,
      compared: 3,
      agreed: 2,
      disagreed: 1,
      errored: 1,
      agreementRate: 2 / 3,
    },
    kinds: [
      {
        decisionKind: 'category',
        total: 2,
        compared: 2,
        agreed: 1,
        disagreed: 1,
        errored: 0,
        agreementRate: 0.5,
        authoritativeEngine: 'chat_judge',
      },
      {
        decisionKind: 'entity_type',
        total: 2,
        compared: 1,
        agreed: 1,
        disagreed: 0,
        errored: 1,
        agreementRate: 1,
        authoritativeEngine: 'chat_judge',
      },
    ],
    confusionPairs: [
      { decisionKind: 'category', llmChoice: 'task', decisionChoice: 'idea', count: 1 },
    ],
    recent: [
      {
        id: 'r1',
        createdAt: '2026-01-01T10:00:00.000Z',
        surface: 'capture_service',
        decisionKind: 'category',
        llmChoice: 'task',
        llmConfidence: 0.8,
        decisionChoice: 'idea',
        decisionProbability: 0.62,
        agree: false,
        decisionError: null,
        decisionDurationMs: 55,
        authoritativeEngine: 'chat_judge',
      },
      {
        id: 'r2',
        createdAt: '2026-01-01T09:00:00.000Z',
        surface: 'enrich_queued',
        decisionKind: 'entity_type',
        llmChoice: 'person',
        llmConfidence: 0.9,
        decisionChoice: null,
        decisionProbability: null,
        agree: null,
        decisionError: 'Decision request failed (401): Invalid API key',
        decisionDurationMs: 120,
        authoritativeEngine: 'chat_judge',
      },
    ],
    ...overrides,
  }
}

describe('decision-shadow-panel.svelte', () => {
  it('renders collapsed by default with the agreement headline', async () => {
    render(DecisionShadowPanel, { shadow: view() })

    const panel = page.getByTestId('decision-shadow-panel')
    await expect.element(panel).toBeInTheDocument()

    const toggle = page.getByTestId('decision-shadow-toggle')
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.element(page.getByText('67% agreement (2/3 compared)')).toBeInTheDocument()
    await expect.element(page.getByText(/1 error/)).toBeInTheDocument()

    // Collapsed = details not rendered at all (not merely hidden).
    await expect.element(page.getByTestId('decision-shadow-details')).not.toBeInTheDocument()
  })

  it('expands on toggle and shows per-kind summaries, confusion pairs, and recent rows', async () => {
    render(DecisionShadowPanel, { shadow: view() })

    await page.getByTestId('decision-shadow-toggle').click()

    const details = page.getByTestId('decision-shadow-details')
    await expect.element(details).toBeVisible()
    await expect
      .element(page.getByTestId('decision-shadow-toggle'))
      .toHaveAttribute('aria-expanded', 'true')

    // Per-kind summary rows.
    await expect.element(page.getByTestId('decision-shadow-kinds')).toBeInTheDocument()
    await expect.element(page.getByTestId('decision-shadow-kinds').getByText('category')).toBeInTheDocument()
    await expect.element(page.getByTestId('decision-shadow-kinds').getByText('entity_type')).toBeInTheDocument()

    // confusion pair row: kind · llm → jev with count
    await expect.element(page.getByText('task → idea')).toBeInTheDocument()
    await expect.element(page.getByText('×1')).toBeInTheDocument()

    // recent rows: qwen pick vs jev pick with probabilities
    await expect.element(page.getByText('task (80%)')).toBeInTheDocument()
    await expect.element(page.getByText('idea (62%)')).toBeInTheDocument()
    await expect.element(page.getByText('Invalid API key')).toBeInTheDocument()
  })

  it('shows a zero state when no comparisons exist yet', async () => {
    render(DecisionShadowPanel, {
      shadow: {
        summary: {
          total: 0,
          compared: 0,
          agreed: 0,
          disagreed: 0,
          errored: 0,
          agreementRate: null,
        },
        kinds: [],
        confusionPairs: [],
        recent: [],
      },
    })

    await expect.element(page.getByText('no comparisons yet')).toBeInTheDocument()
  })

  it('marks decision-model authoritative kinds with a Jev-decides chip and renders chat-skipped rows', async () => {
    render(
      DecisionShadowPanel,
      {
        shadow: view({
          kinds: [
            {
              decisionKind: 'content_role',
              total: 1,
              compared: 0,
              agreed: 0,
              disagreed: 0,
              errored: 0,
              agreementRate: null,
              authoritativeEngine: 'decision_model',
            },
          ],
          recent: [
            {
              id: 'r3',
              createdAt: '2026-01-01T11:00:00.000Z',
              surface: 'enrich_queued',
              decisionKind: 'content_role',
              llmChoice: null,
              llmConfidence: null,
              decisionChoice: 'thought_only',
              decisionProbability: 0.8,
              agree: null,
              decisionError: null,
              decisionDurationMs: 320,
              authoritativeEngine: 'decision_model',
            },
          ],
        }),
      },
    )

    await page.getByTestId('decision-shadow-toggle').click()

    await expect
      .element(page.getByTestId('decision-shadow-authority-content_role'))
      .toHaveTextContent('Jev decides')
    await expect.element(page.getByText('thought_only (80%)')).toBeInTheDocument()
    await expect.element(page.getByText('· chat skipped')).toBeInTheDocument()
  })
})
