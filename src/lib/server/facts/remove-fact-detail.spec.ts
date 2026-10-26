import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  state: { db: null as unknown },
  llmMock: vi.fn(),
  embedMock: vi.fn(),
  forgetMock: vi.fn(),
  encrypted: new Map<string, string>(),
}))

vi.mock('$lib/server/db', () => ({ getDb: () => m.state.db }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: m.llmMock }))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbedding: m.embedMock }))
vi.mock('./user-fact-lifecycle', () => ({ forgetUserFacts: m.forgetMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: vi.fn(async (input: { plaintext: string }) => {
    const cipher = `cipher-${m.encrypted.size + 1}`
    m.encrypted.set(cipher, input.plaintext)
    return cipher
  }),
  decryptTenantValue: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.replace(/^stored:/, ''),
  ),
}))

import { userFact } from '$lib/server/db/schema'
import { rememberEvalLlmCacheOrigin, type EvalLlmCache } from '$lib/server/llm/eval-llm-cache'
import { createRecordingDb } from '$lib/test/recording-db'
import { SECURE_VALUE_PLACEHOLDER, secureReferenceToken } from './fact-vocabulary'
import { REMOVE_FACT_DETAIL_PROMPT, removeDetailFromFact } from './remove-fact-detail'

const FACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECURE_ID = '22222222-2222-4222-8222-222222222222'
const VECTOR = [0.4, 0.5]

const row = (statement: string, over: Record<string, unknown> = {}) => ({
  id: FACT,
  subjectLabel: null,
  statementEncrypted: `stored:${statement}`,
  secureValueId: null,
  ...over,
})

function reply(json: unknown) {
  return {
    choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }],
  }
}

function arrange(statement: string, over: Record<string, unknown> = {}) {
  const rec = createRecordingDb([[row(statement, over)]])
  m.state.db = rec.db
  return rec
}

const run = (detail = 'that I drink coffee') =>
  removeDetailFromFact({ userId: 'u1', factId: FACT, detail })

beforeEach(() => {
  vi.clearAllMocks()
  m.encrypted.clear()
  m.embedMock.mockResolvedValue(VECTOR)
  m.forgetMock.mockResolvedValue([FACT])
})

describe('removeDetailFromFact (forget: remove_detail on a fact)', () => {
  it('rewrites the statement without the detail: new encrypted statement, keyword surface and embedding', async () => {
    const rec = arrange('Drinks coffee and swims at the local pool')
    m.llmMock.mockResolvedValue(reply({ statement: 'Swims at the local pool' }))

    await expect(run()).resolves.toBe('edited')

    const call = m.llmMock.mock.calls[0]![0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.logContext).toBe('forget_fact_edit')
    expect(call.messages[0].content).toBe(REMOVE_FACT_DETAIL_PROMPT)
    expect(call.messages[1].content).toContain('that I drink coffee')
    expect(call.messages[1].content).toContain('Drinks coffee and swims at the local pool')

    expect(m.embedMock).toHaveBeenCalledWith('u1', 'Swims at the local pool')
    const update = rec.events.find((e) => e.kind === 'update' && e.table === userFact)
    expect(update).toMatchObject({
      set: {
        statementEncrypted: 'cipher-1',
        lexicalText: 'swims at the local pool',
        embedding: VECTOR,
      },
    })
    expect(m.encrypted.get('cipher-1')).toBe('Swims at the local pool')
    expect(m.forgetMock).not.toHaveBeenCalled()
  })

  it('a fact that is only the detail is forgotten (no statement left)', async () => {
    arrange('Drinks coffee')
    m.llmMock.mockResolvedValue(reply({ statement: null }))
    await expect(run()).resolves.toBe('forgotten')
    expect(m.forgetMock).toHaveBeenCalledWith('u1', [FACT])
    expect(m.embedMock).not.toHaveBeenCalled()

    arrange('Drinks coffee')
    m.llmMock.mockResolvedValue(reply({ statement: '   ' }))
    await expect(run()).resolves.toBe('forgotten')
  })

  it('a fact that is no longer active is gone: no model call', async () => {
    m.state.db = createRecordingDb([[]]).db
    await expect(run()).resolves.toBe('gone')
    expect(m.llmMock).not.toHaveBeenCalled()
  })

  it('fails loud when the rewrite left the fact unchanged, so the detail would still be remembered', async () => {
    arrange('Drinks coffee and swims')
    m.llmMock.mockResolvedValue(reply({ statement: 'Drinks coffee and swims' }))
    await expect(run()).rejects.toThrow(/unchanged/)
  })

  it('fails loud on a malformed reply and evicts it from the eval cache', async () => {
    const evict = vi.fn(() => true)
    arrange('Drinks coffee and swims')
    const bad = reply('not json')
    rememberEvalLlmCacheOrigin(bad, { evict } as unknown as EvalLlmCache, {
      endpoint: 'chat',
      provider: 'p',
      model: 'm',
      body: {},
    })
    m.llmMock.mockResolvedValue(bad)
    await expect(run()).rejects.toThrow(/fact detail removal/)
    expect(evict).toHaveBeenCalled()
  })

  it('rejects a rewrite whose statement is neither a string nor null', async () => {
    arrange('Drinks coffee and swims')
    m.llmMock.mockResolvedValue(reply({ statement: 42 }))
    await expect(run()).rejects.toThrow(/statement/)
  })

  describe('identifier facts', () => {
    const display = `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`
    const stored = `The user's licence plate is ${secureReferenceToken(SECURE_ID)}`

    it('the model sees the placeholder, not the reference id', async () => {
      arrange(stored, { secureValueId: SECURE_ID })
      m.llmMock.mockResolvedValue(
        reply({ statement: `Owns a car. Plate: ${SECURE_VALUE_PLACEHOLDER}` }),
      )
      await run('that they live in Berlin')
      const user = m.llmMock.mock.calls[0]![0].messages[1].content as string
      expect(user).toContain(display)
      expect(user).not.toContain(SECURE_ID)
    })

    it('a rewrite that keeps the placeholder keeps the reference to the same secure value', async () => {
      const rec = arrange(stored, { secureValueId: SECURE_ID })
      m.llmMock.mockResolvedValue(
        reply({ statement: `The car's plate is ${SECURE_VALUE_PLACEHOLDER}` }),
      )
      await expect(run("that it is the user's own car")).resolves.toBe('edited')
      expect(m.encrypted.get('cipher-1')).toBe(
        `The car's plate is ${secureReferenceToken(SECURE_ID)}`,
      )
      // what is embedded is the placeholder form
      expect(m.embedMock).toHaveBeenCalledWith(
        'u1',
        `The car's plate is ${SECURE_VALUE_PLACEHOLDER}`,
      )
      expect(rec.events.some((e) => e.kind === 'delete')).toBe(false)
    })

    it('a rewrite that drops the placeholder removes the identifier: the fact is forgotten with its secure value', async () => {
      arrange(stored, { secureValueId: SECURE_ID })
      m.llmMock.mockResolvedValue(reply({ statement: 'Owns a car' }))
      await expect(run('the licence plate')).resolves.toBe('forgotten')
      expect(m.forgetMock).toHaveBeenCalledWith('u1', [FACT])
    })

    it('a rewrite with more placeholders than the fact has secure values fails loud', async () => {
      arrange(stored, { secureValueId: SECURE_ID })
      m.llmMock.mockResolvedValue(
        reply({ statement: `${SECURE_VALUE_PLACEHOLDER} and ${SECURE_VALUE_PLACEHOLDER}` }),
      )
      await expect(run()).rejects.toThrow(/placeholder/)
    })

    it('a rewrite of a plain fact may not invent a placeholder', async () => {
      arrange('Drinks coffee and swims')
      m.llmMock.mockResolvedValue(reply({ statement: `Swims, number ${SECURE_VALUE_PLACEHOLDER}` }))
      await expect(run()).rejects.toThrow(/placeholder/)
    })
  })
})
