import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildReflectionPromptMessages,
  generateReflectionPrompts,
  hasReflectionMaterial,
  parseReflectionPromptOutput,
  REFLECTION_PROMPTS_LOG_CONTEXT,
  resolveTodaysReflectionPrompts,
  type ReflectionContext,
} from './reflection-prompts'

const { llmMock } = vi.hoisted(() => ({ llmMock: vi.fn() }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))
vi.mock('$lib/server/ontology/llm-json', () => ({
  extractChatContent: (r: { content: string }) => r.content,
}))

const context: ReflectionContext = {
  language: 'de',
  projects: [{ label: 'Eigen offline', nextAction: 'Service worker cache' }],
  stalled: [{ label: 'Garden shed', reason: 'no_next_action' }],
  recent: ['Called Jonas about the bike trip'],
}
const empty: ReflectionContext = { language: 'en', projects: [], stalled: [], recent: [] }

describe('reflection prompt messages (RP-1)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hands the model the projects, stalled threads, recent thoughts and the language', () => {
    const [system, user] = buildReflectionPromptMessages(context)
    expect(system.content).toContain('"prompts"')
    expect(system.content).toContain('de')
    expect(user.content).toContain('Eigen offline')
    expect(user.content).toContain('Service worker cache')
    expect(user.content).toContain('Garden shed')
    expect(user.content).toContain('Called Jonas about the bike trip')
  })

  it('accepts one to three short prompts and rejects anything off-schema', () => {
    expect(parseReflectionPromptOutput('{"prompts": [" How is the shed going? "]}')).toEqual([
      'How is the shed going?',
    ])
    expect(() => parseReflectionPromptOutput('{"prompts": []}')).toThrow(/schema/)
    expect(() => parseReflectionPromptOutput('{"prompts": ["a","b","c","d"]}')).toThrow(/schema/)
    expect(() => parseReflectionPromptOutput(`{"prompts": ["${'x'.repeat(121)}"]}`)).toThrow(
      /schema/,
    )
    expect(() => parseReflectionPromptOutput('not json')).toThrow()
  })

  it('bills the user under its own log context', async () => {
    llmMock.mockResolvedValue({ content: '{"prompts": ["Wie läuft Eigen offline?"]}' })
    await expect(generateReflectionPrompts({ userId: 'u1', context })).resolves.toEqual([
      'Wie läuft Eigen offline?',
    ])
    expect(llmMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', logContext: REFLECTION_PROMPTS_LOG_CONTEXT }),
    )
  })

  it('tries exactly three times, then fails out loud (RP-2)', async () => {
    llmMock.mockResolvedValue({ content: 'not json' })
    await expect(generateReflectionPrompts({ userId: 'u1', context })).rejects.toThrow(/3 times/)
    expect(llmMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry when credits run out', async () => {
    const noCredits = Object.assign(new Error('Not enough credits'), {
      name: 'InsufficientCreditsError',
    })
    llmMock.mockRejectedValue(noCredits)
    await expect(generateReflectionPrompts({ userId: 'u1', context })).rejects.toBe(noCredits)
    expect(llmMock).toHaveBeenCalledTimes(1)
  })
})

describe('hasReflectionMaterial (RP-3)', () => {
  it('needs at least one project, stalled thread or recent thought', () => {
    expect(hasReflectionMaterial(empty)).toBe(false)
    expect(hasReflectionMaterial({ ...empty, recent: ['x'] })).toBe(true)
    expect(hasReflectionMaterial({ ...empty, stalled: [{ label: 'x', reason: 'r' }] })).toBe(true)
  })
})

describe('resolveTodaysReflectionPrompts', () => {
  function deps(row: { prompts: string[] | null; dismissed: boolean } | null) {
    return {
      readRow: vi.fn().mockResolvedValue(row),
      loadContext: vi.fn().mockResolvedValue(context),
      generate: vi.fn().mockResolvedValue(['How is the shed going?']),
      writePrompts: vi.fn().mockResolvedValue(['How is the shed going?']),
    }
  }

  it('generates and stores once when today has no row (RP-AC1)', async () => {
    const d = deps(null)
    await expect(resolveTodaysReflectionPrompts(d)).resolves.toEqual({
      state: 'ready',
      prompts: ['How is the shed going?'],
    })
    expect(d.generate).toHaveBeenCalledWith(context)
    expect(d.writePrompts).toHaveBeenCalledWith(['How is the shed going?'])
  })

  it('returns the stored set without a call (RP-AC2)', async () => {
    const d = deps({ prompts: ['Stored?'], dismissed: false })
    await expect(resolveTodaysReflectionPrompts(d)).resolves.toEqual({
      state: 'ready',
      prompts: ['Stored?'],
    })
    expect(d.loadContext).not.toHaveBeenCalled()
    expect(d.generate).not.toHaveBeenCalled()
  })

  it('stays quiet for a dismissed day, generated or not (RP-5)', async () => {
    for (const prompts of [['Stored?'], null]) {
      const d = deps({ prompts, dismissed: true })
      await expect(resolveTodaysReflectionPrompts(d)).resolves.toEqual({ state: 'dismissed' })
      expect(d.generate).not.toHaveBeenCalled()
    }
  })

  it('spends nothing when there is nothing to reflect on (RP-AC4)', async () => {
    const d = deps(null)
    d.loadContext.mockResolvedValue(empty)
    await expect(resolveTodaysReflectionPrompts(d)).resolves.toEqual({ state: 'empty' })
    expect(d.generate).not.toHaveBeenCalled()
    expect(d.writePrompts).not.toHaveBeenCalled()
  })

  it('stores nothing when generation fails (RP-AC3)', async () => {
    const d = deps(null)
    d.generate.mockRejectedValue(new Error('failed 3 times'))
    await expect(resolveTodaysReflectionPrompts(d)).rejects.toThrow(/3 times/)
    expect(d.writePrompts).not.toHaveBeenCalled()
  })
})
