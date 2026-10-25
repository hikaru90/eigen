import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { envPaste, FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import {
  resolveDecisionEnforceKinds,
  resolveDecisionShadowConfig,
  runDecisionModel,
} from './decision-client'

describe('resolveDecisionShadowConfig', () => {
  it('returns null when DECISION_SHADOW_ENABLED is not "true"', () => {
    expect(
      resolveDecisionShadowConfig({ DECISION_SHADOW_ENABLED: undefined } as Record<string, string | undefined>),
    ).toBeNull()
    expect(
      resolveDecisionShadowConfig({ DECISION_SHADOW_ENABLED: 'false' } as Record<string, string | undefined>),
    ).toBeNull()
  })

  it('returns the config when enabled and fully configured', () => {
    const cfg = resolveDecisionShadowConfig({
      DECISION_SHADOW_ENABLED: 'true',
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      DECISION_SHADOW_MODEL: 'typesafe/jev-1.13',
    })
    expect(cfg).toEqual({ apiKey: 'sk-or-v1-test', model: 'typesafe/jev-1.13' })
  })

  it('throws listing every missing required var when enabled but incomplete', () => {
    expect(() =>
      resolveDecisionShadowConfig({ DECISION_SHADOW_ENABLED: 'true' } as Record<string, string | undefined>),
    ).toThrow(/OPENROUTER_API_KEY.*DECISION_SHADOW_MODEL/s)
  })

  it('throws listing only the vars that are actually missing', () => {
    expect(() =>
      resolveDecisionShadowConfig({
        DECISION_SHADOW_ENABLED: 'true',
        OPENROUTER_API_KEY: 'sk-or-v1-test',
      } as Record<string, string | undefined>),
    ).toThrow(/DECISION_SHADOW_MODEL/s)
    expect(() =>
      resolveDecisionShadowConfig({
        DECISION_SHADOW_ENABLED: 'true',
        OPENROUTER_API_KEY: 'sk-or-v1-test',
      } as Record<string, string | undefined>),
    ).not.toThrow(/OPENROUTER_API_KEY/)
  })
})

describe('resolveDecisionEnforceKinds', () => {
  it('is off (empty set) when DECISION_ENFORCE_KINDS is absent or blank', () => {
    expect(resolveDecisionEnforceKinds({} as Record<string, string | undefined>).size).toBe(0)
    expect(
      resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: '  ' } as Record<string, string | undefined>).size,
    ).toBe(0)
  })

  it('parses a single kind', () => {
    const kinds = resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'category' })
    expect([...kinds]).toEqual(['category'])
  })

  it('parses multiple kinds tolerating whitespace, case, and empty tokens', () => {
    const kinds = resolveDecisionEnforceKinds({
      DECISION_ENFORCE_KINDS: ' Category , content_role ,,',
    })
    expect([...kinds].sort()).toEqual(['category', 'content_role'])
  })

  it('de-duplicates repeated kinds', () => {
    const kinds = resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'category,category' })
    expect([...kinds]).toEqual(['category'])
  })

  it('fails loud on unknown kinds (no silent no-op)', () => {
    expect(() => resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'category,salience' })).toThrow(
      /unknown decision kind "salience"/,
    )
  })

  it('accepts entity_type — enforced per item via runEnforcedPerItemDecisions (spec O1)', () => {
    const kinds = resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'entity_type' })
    expect([...kinds]).toEqual(['entity_type'])
  })

  it('accepts relation_type and temporal_kind', () => {
    const kinds = resolveDecisionEnforceKinds({
      DECISION_ENFORCE_KINDS: 'entity_type, relation_type ,TEMPORAL_KIND',
    })
    expect([...kinds].sort()).toEqual(['entity_type', 'relation_type', 'temporal_kind'])
  })

  it('accepts the whole-question chat/qa kinds (retrieval_scope, query_temporal_kind, duration_unit, gtd_promotion)', () => {
    const kinds = resolveDecisionEnforceKinds({
      DECISION_ENFORCE_KINDS: 'retrieval_scope,query_temporal_kind, duration_unit ,GTD_PROMOTION',
    })
    expect([...kinds].sort()).toEqual([
      'duration_unit',
      'gtd_promotion',
      'query_temporal_kind',
      'retrieval_scope',
    ])
  })

  it('still fails loud on unknown kinds after the registry widened', () => {
    expect(() => resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'gtd_promotions' })).toThrow(
      /unknown decision kind "gtd_promotions"/,
    )
  })

  it('accepts the widened kinds (resolution_choice, delete_target, message_intent, open_loop, salience_band)', () => {
    const kinds = resolveDecisionEnforceKinds({
      DECISION_ENFORCE_KINDS: 'resolution_choice,delete_target, message_intent ,OPEN_LOOP,Salience_Band',
    })
    expect([...kinds].sort()).toEqual([
      'delete_target',
      'message_intent',
      'open_loop',
      'resolution_choice',
      'salience_band',
    ])
  })

  it('accepts each widened kind on its own', () => {
    for (const kind of ['resolution_choice', 'delete_target', 'message_intent', 'open_loop', 'salience_band']) {
      expect([...resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: kind })]).toEqual([kind])
    }
  })

  it('accepts all 14 registry kinds in one setting', () => {
    const all = [
      'category',
      'content_role',
      'entity_type',
      'relation_type',
      'temporal_kind',
      'retrieval_scope',
      'query_temporal_kind',
      'duration_unit',
      'gtd_promotion',
      'resolution_choice',
      'delete_target',
      'message_intent',
      'open_loop',
      'salience_band',
    ]
    const kinds = resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: all.join(',') })
    expect(kinds.size).toBe(14)
    expect([...kinds].sort()).toEqual([...all].sort())
  })

  it('still fails loud on near-misses of the widened kinds', () => {
    expect(() => resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'resolution_choices' })).toThrow(
      /unknown decision kind "resolution_choices"/,
    )
    expect(() => resolveDecisionEnforceKinds({ DECISION_ENFORCE_KINDS: 'delete_targets' })).toThrow(
      /unknown decision kind "delete_targets"/,
    )
  })
})

describe('runDecisionModel', () => {
  const config = { apiKey: 'secret-or-key', model: 'typesafe/jev-1.13' }

  const validResponse = {
    model: 'typesafe/jev-1.13',
    answers: {
      category: {
        type: 'choice',
        choice: 'task',
        probabilities: { task: 0.9, idea: 0.1 },
        confidence: 0.9,
      },
    },
    usage: { cost: 0.0000123, input_tokens: 10, output_tokens: 1 },
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(validResponse), { status: 200 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to the OpenRouter Decisions endpoint with bearer auth and the typed question body', async () => {
    await runDecisionModel(config, {
      state: 'Buy milk tomorrow',
      questions: {
        category: { type: 'choice', instructions: 'Pick one', criteria: { task: 'Tasks', idea: 'Ideas' } },
      },
    })
    const fetchMock = vi.mocked(globalThis.fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-or-key')
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({
      model: 'typesafe/jev-1.13',
      state: 'Buy milk tomorrow',
      questions: {
        category: { type: 'choice', instructions: 'Pick one', criteria: { task: 'Tasks', idea: 'Ideas' } },
      },
    })
  })

  it('never sends a credential to the decisions gateway: state and question text are redacted and the call is warned about', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runDecisionModel(config, {
      state: `deploy ${envPaste()}`,
      questions: {
        category: {
          type: 'choice',
          instructions: `Which type is the mention "${FAKE_SECRETS.githubClassic}"?`,
          criteria: { a: 'A' },
        },
      },
    })
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    const sent = String(init?.body)
    expect(leaks(sent)).toBe(false)
    expect(sent).toContain('LLM_API_KEY=[redacted secret]')
    expect(warn).toHaveBeenCalledWith(
      '[security.gateway-guard] redacted a secret before an outgoing call',
      expect.objectContaining({ callSite: 'decision_model' }),
    )
    expect(leaks(JSON.stringify(warn.mock.calls))).toBe(false)
    warn.mockRestore()
  })

  it('stays silent for a clean request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runDecisionModel(config, {
      state: 'commit 9f3a2c1',
      questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns the parsed choice answer including provider-reported cost', async () => {
    const res = await runDecisionModel(config, {
      state: 'x',
      questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
    })
    expect(res.model).toBe('typesafe/jev-1.13')
    expect(res.answers.category.type).toBe('choice')
    expect(res.answers.category.choice).toBe('task')
    expect(res.answers.category.probabilities).toEqual({ task: 0.9, idea: 0.1 })
    expect(res.answers.category.confidence).toBe(0.9)
    expect(res.usage).toEqual({ input_tokens: 10, output_tokens: 1 })
    expect(res.reportedCostUsd).toBe(0.0000123)
  })

  it('returns reportedCostUsd null when usage.cost is absent (never inferred)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: 'typesafe/jev-1.13',
            answers: validResponse.answers,
            usage: { input_tokens: 10, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      ),
    )
    const res = await runDecisionModel(config, {
      state: 'x',
      questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
    })
    expect(res.reportedCostUsd).toBeNull()
  })

  it('throws with the API error message on HTTP failure (OpenRouter error shape)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }),
      ),
    )
    await expect(
      runDecisionModel(config, {
        state: 'x',
        questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
      }),
    ).rejects.toThrow(/Invalid API key/)
  })

  it('throws on HTTP failure without a parseable error payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(
      runDecisionModel(config, {
        state: 'x',
        questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
      }),
    ).rejects.toThrow(/502/)
  })

  it('throws when the answer for a question is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: 'typesafe/jev-1.13',
            answers: {},
            usage: { cost: 0, input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      ),
    )
    await expect(
      runDecisionModel(config, {
        state: 'x',
        questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
      }),
    ).rejects.toThrow(/missing/i)
  })

  it('throws when a choice answer has a non-choice type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: 'typesafe/jev-1.13',
            answers: { category: { type: 'noul', noul: 0.5 } },
            usage: { cost: 0, input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      ),
    )
    await expect(
      runDecisionModel(config, {
        state: 'x',
        questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
      }),
    ).rejects.toThrow(/unexpected type/i)
  })

  it('throws when probabilities are missing, non-numeric, or out of range', async () => {
    const badBodies = [
      { choice: 'a', probabilities: {}, confidence: 0.5 },
      { choice: 'a', probabilities: { a: 1.5 }, confidence: 0.5 },
      { choice: 'a', probabilities: { a: 'high' }, confidence: 0.5 },
      { choice: 'a', probabilities: { a: 1 }, confidence: 7 },
    ]
    for (const answer of badBodies) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              model: 'typesafe/jev-1.13',
              answers: { category: answer },
              usage: { cost: 0, input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200 },
          ),
        ),
      )
      await expect(
        runDecisionModel(config, {
          state: 'x',
          questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
        }),
      ).rejects.toThrow()
    }
  })

  it('aborts the request after timeoutMs', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('The operation was aborted')),
              )
            }),
        ),
      )
      const pending = runDecisionModel(
        config,
        { state: 'x', questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } } },
        { timeoutMs: 50 },
      )
      vi.advanceTimersByTime(60)
      await expect(pending).rejects.toThrow(/abort|timeout/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never includes the API key in thrown error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom secret-or-key boom', { status: 500 })),
    )
    const pending = runDecisionModel(config, {
      state: 'x',
      questions: { category: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } },
    })
    await expect(pending).rejects.toBeInstanceOf(Error)
    await expect(pending).rejects.not.toThrow(/secret-or-key/)
  })
})
