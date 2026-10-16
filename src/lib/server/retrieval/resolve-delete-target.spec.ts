import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STRONG_RETRIEVE_MATCH_MIN } from '$lib/server/llm/agent-tool-result-compact'
import {
  buildDeleteTargetCandidates,
  parseDeleteTargetsResponse,
  resolveDeleteTargets,
  strongDeleteTargetCandidates,
} from './resolve-delete-target'

const { llmChatCompletionMock, runEnforcedPerItemDecisionsMock, resolveEnforceKindsMock } =
  vi.hoisted(() => ({
    llmChatCompletionMock: vi.fn(),
    runEnforcedPerItemDecisionsMock: vi.fn(),
    resolveEnforceKindsMock: vi.fn(),
  }))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

vi.mock('$lib/server/llm/decision-plane', () => ({
  runEnforcedPerItemDecisions: runEnforcedPerItemDecisionsMock,
}))

// $env/dynamic/private bakes values at transform time, so vi.stubEnv alone
// cannot drive resolveDecisionEnforceKinds() at call time — the module mock
// is the control surface (same pattern as relation-extraction.spec.ts).
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return { ...actual, resolveDecisionEnforceKinds: resolveEnforceKindsMock }
})

beforeEach(() => {
  // Enforcement OFF by default — the chat-judge (qwen) path stays authoritative.
  resolveEnforceKindsMock.mockReturnValue(new Set())
  runEnforcedPerItemDecisionsMock.mockResolvedValue(new Map())
})

describe('buildDeleteTargetCandidates', () => {
  it('maps retrieve rows to compact delete candidates', () => {
    const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1
    const candidates = buildDeleteTargetCandidates([
      {
        id: 't-salmon',
        normalizedText: 'Recipe: Japanese glazed salmon',
        category: 'reference',
        score: strongScore,
      },
      { id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: strongScore },
    ])
    expect(candidates).toHaveLength(2)
    expect(candidates[0].thoughtId).toBe('t-salmon')
    expect(candidates[0].snippet).toContain('Japanese glazed salmon')
    expect(candidates[0].scoreNormalized).toBeGreaterThanOrEqual(STRONG_RETRIEVE_MATCH_MIN)
  })

  it('filters to strong candidates only', () => {
    const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1
    const weakScore = STRONG_RETRIEVE_MATCH_MIN - 0.1
    const all = buildDeleteTargetCandidates([
      { id: 'strong', normalizedText: 'A', score: strongScore },
      { id: 'weak', normalizedText: 'B', score: weakScore },
    ])
    expect(strongDeleteTargetCandidates(all).map((c) => c.thoughtId)).toEqual(['strong'])
  })
})

describe('parseDeleteTargetsResponse', () => {
  const candidates = buildDeleteTargetCandidates([
    { id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
    { id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 },
  ])

  it('parses one matching thoughtId', () => {
    expect(parseDeleteTargetsResponse('{"thoughtIds":["t-salmon"]}', candidates)).toEqual([
      expect.objectContaining({ thoughtId: 't-salmon' }),
    ])
  })

  it('parses multiple matching thoughtIds', () => {
    expect(
      parseDeleteTargetsResponse('{"thoughtIds":["t-salmon","t-chicken"]}', candidates).map(
        (c) => c.thoughtId,
      ),
    ).toEqual(['t-salmon', 't-chicken'])
  })

  it('parses empty array when nothing matches', () => {
    expect(parseDeleteTargetsResponse('{"thoughtIds":[]}', candidates)).toEqual([])
  })

  it('accepts legacy single thoughtId responses', () => {
    expect(parseDeleteTargetsResponse('{"thoughtId":"t-salmon"}', candidates)).toEqual([
      expect.objectContaining({ thoughtId: 't-salmon' }),
    ])
  })

  it('rejects ids not in the candidate list', () => {
    expect(() => parseDeleteTargetsResponse('{"thoughtIds":["missing"]}', candidates)).toThrow(
      /must reference listed candidates/,
    )
  })
})

describe('resolveDeleteTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the LLM-selected candidates', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"thoughtIds":["t-salmon"]}' } }],
    })
    const candidates = buildDeleteTargetCandidates([
      { id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
      { id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 },
    ])

    await expect(
      resolveDeleteTargets({
        userId: 'u1',
        deleteRequest: 'delete the Japanese glazed salmon recipe',
        candidates,
      }),
    ).resolves.toEqual([expect.objectContaining({ thoughtId: 't-salmon' })])

    expect(llmChatCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ logContext: 'delete_target_resolver' }),
    )
  })

  it('returns multiple targets when the user asks to delete several matches', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"thoughtIds":["t-salmon","t-chicken"]}' } }],
    })
    const candidates = buildDeleteTargetCandidates([
      { id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
      { id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 },
    ])

    await expect(
      resolveDeleteTargets({
        userId: 'u1',
        deleteRequest: 'delete all my recipe notes',
        candidates,
      }),
    ).resolves.toHaveLength(2)
  })
})

describe('resolveDeleteTargets (enforced delete_target)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const candidates = buildDeleteTargetCandidates([
    { id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
    { id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 },
  ])

  function enforcedOn(): void {
    resolveEnforceKindsMock.mockReturnValue(new Set(['delete_target']))
  }

  it('asks the decision model once per candidate on the delete_gate surface', async () => {
    enforcedOn()
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['d1', { choice: 'delete', probability: 0.9, alternatives: { keep: 0.1 } }],
        ['d2', { choice: 'keep', probability: 0.95, alternatives: { delete: 0.05 } }],
      ]),
    )

    await resolveDeleteTargets({
      userId: 'u1',
      deleteRequest: 'delete the Japanese glazed salmon recipe',
      candidates,
    })

    expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
    expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledWith({
      userId: 'u1',
      surface: 'delete_gate',
      kind: 'delete_target',
      state: 'delete the Japanese glazed salmon recipe',
      criteria: {
        delete: 'This thought matches the delete request — the user means this one.',
        keep: 'This thought does not match the request.',
      },
      items: [
        {
          ref: 'd1',
          instructions:
            'Should this stored thought be deleted for this request: "Recipe: Japanese glazed salmon"?',
          llmChoice: null,
        },
        {
          ref: 'd2',
          instructions:
            'Should this stored thought be deleted for this request: "Recipe: Lemon Herb Roast Chicken"?',
          llmChoice: null,
        },
      ],
    })
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('throws the gate error when a selected candidate is below 0.8 confidence', async () => {
    enforcedOn()
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['d1', { choice: 'delete', probability: 0.9, alternatives: { keep: 0.1 } }],
        ['d2', { choice: 'delete', probability: 0.7, alternatives: { keep: 0.3 } }],
      ]),
    )

    await expect(
      resolveDeleteTargets({
        userId: 'u1',
        deleteRequest: 'delete the recipes',
        candidates,
      }),
    ).rejects.toThrow('[delete-gate] ambiguous delete request — refine it (best match confidence 0.90)')
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('selects candidates at the 0.8 gate boundary', async () => {
    enforcedOn()
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([['d1', { choice: 'delete', probability: 0.8, alternatives: { keep: 0.2 } }]]),
    )

    await expect(
      resolveDeleteTargets({ userId: 'u1', deleteRequest: 'delete the salmon recipe', candidates }),
    ).resolves.toEqual([expect.objectContaining({ thoughtId: 't-salmon' })])
  })

  it('returns only candidates whose answer is delete when every selected one clears the gate', async () => {
    enforcedOn()
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['d1', { choice: 'delete', probability: 0.9, alternatives: { keep: 0.1 } }],
        ['d2', { choice: 'keep', probability: 0.82, alternatives: { delete: 0.18 } }],
      ]),
    )

    await expect(
      resolveDeleteTargets({ userId: 'u1', deleteRequest: 'delete the salmon recipe', candidates }),
    ).resolves.toEqual([expect.objectContaining({ thoughtId: 't-salmon' })])
  })

  it('returns an explicit empty result when every candidate answers keep', async () => {
    enforcedOn()
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['d1', { choice: 'keep', probability: 0.9, alternatives: { delete: 0.1 } }],
        ['d2', { choice: 'keep', probability: 0.85, alternatives: { delete: 0.15 } }],
      ]),
    )

    await expect(
      resolveDeleteTargets({ userId: 'u1', deleteRequest: 'delete my childhood photos', candidates }),
    ).resolves.toEqual([])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('propagates enforced decision failures without fallback', async () => {
    enforcedOn()
    runEnforcedPerItemDecisionsMock.mockRejectedValue(
      new Error('[decision-plane] enforced delete_target per-item decision failed: boom'),
    )

    await expect(
      resolveDeleteTargets({ userId: 'u1', deleteRequest: 'delete the recipes', candidates }),
    ).rejects.toThrow('[decision-plane] enforced delete_target per-item decision failed: boom')
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })
})
