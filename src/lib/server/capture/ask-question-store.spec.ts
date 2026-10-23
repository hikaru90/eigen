import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askQuestionColumns, readAskQuestion } from './ask-question-store'

const { encryptMock, decryptMock } = vi.hoisted(() => ({
  encryptMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptMock,
  decryptTenantValue: decryptMock,
}))

describe('ask_question at rest (SQ-3, same pattern as raw/normalized text)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async ({ plaintext }: { plaintext: string }) => `enc(${plaintext})`)
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.replace(/^enc\((.*)\)$/, '$1'),
    )
  })

  it('encrypts the question under thought.ask_question for the tenant', async () => {
    const cols = await askQuestionColumns('u1', 'What did I tell the plumber?')
    expect(encryptMock).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'thought',
      column: 'ask_question',
      plaintext: 'What did I tell the plumber?',
    })
    expect(cols).toEqual({
      askQuestion: 'What did I tell the plumber?',
      askQuestionEncrypted: 'enc(What did I tell the plumber?)',
    })
  })

  it('clears both columns for null without encrypting', async () => {
    expect(await askQuestionColumns('u1', null)).toEqual({
      askQuestion: null,
      askQuestionEncrypted: null,
    })
    expect(encryptMock).not.toHaveBeenCalled()
  })

  it('round-trips: reads decrypt the ciphertext when present', async () => {
    const cols = await askQuestionColumns('u1', 'Wann ist der Termin?')
    expect(await readAskQuestion('u1', cols)).toBe('Wann ist der Termin?')
    expect(decryptMock).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'thought',
      column: 'ask_question',
      ciphertext: 'enc(Wann ist der Termin?)',
    })
  })

  it('reads null when no question is stored', async () => {
    expect(await readAskQuestion('u1', { askQuestion: null, askQuestionEncrypted: null })).toBeNull()
  })
})
