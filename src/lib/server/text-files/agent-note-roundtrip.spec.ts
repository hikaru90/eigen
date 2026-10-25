/**
 * Acceptance for docs/planning/secret-hygiene.md Part 2, end to end through the real tools and the
 * real service (only the database, encryption and embedding edges are doubles): the agent reads a
 * note with two secrets, edits it with the placeholders it was shown, and the stored body keeps
 * both values while nothing an LLM or a log could see ever holds one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatToolResultForAgentMessage } from '$lib/server/llm/agent-tool-result-compact'
import {
  runAppendTextFileTool,
  runCreateTextFileTool,
  runGetTextFileTool,
  runUpdateTextFileTool,
} from '$lib/server/mcp/tools'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import { guardOutgoingMessages } from '$lib/server/security/gateway-guard'
import { FAKE_SECRETS, guardWouldTrip, leaks } from '$lib/test/secret-fixtures'

const { getDbMock, encryptMock, preparePassageSyncMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  encryptMock: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
  preparePassageSyncMock: vi.fn(async () => ({ deleteIds: [], rows: [] })),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => {
    const db = getDbMock()
    return { ...db, transaction: async (fn: (tx: unknown) => unknown) => fn(db) }
  },
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptMock,
  decryptTenantValue: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
    ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
  ),
}))
vi.mock('$lib/server/text-files/note-passages', () => ({
  preparePassageSync: preparePassageSyncMock,
  applyPassageSync: vi.fn(async () => undefined),
  loadStoredPassages: vi.fn(async () => []),
  createDbNoteSearchSources: vi.fn(),
}))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbedding: vi.fn() }))

const at = new Date('2026-06-05T12:00:00.000Z')
const ORIGINAL = [
  'Deploy runbook, versoin 3',
  `LLM_API_KEY=${FAKE_SECRETS.openai}`,
  'Restart the worker afterwards.',
  `GITHUB_TOKEN=${FAKE_SECRETS.githubClassic}`,
  'Done.',
].join('\n')

/** The database holds one note; every update replaces its encrypted body. */
function oneNoteDb(initialBody: string) {
  let stored = initialBody
  const row = () => ({
    id: 'f1',
    title: 'runbook',
    bodyText: '',
    bodyTextEncrypted: `enc:${stored}`,
    author: 'user',
    authorLabel: null,
    authorKeyId: null,
    createdAt: at,
    updatedAt: at,
  })
  getDbMock.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [row()]) })) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: { bodyTextEncrypted?: string }) => {
        if (values.bodyTextEncrypted) stored = values.bodyTextEncrypted.slice(4)
        return { where: vi.fn(() => ({ returning: vi.fn(async () => [row()]) })) }
      }),
    })),
  })
  return { stored: () => stored }
}

describe('agent note round trip: secrets survive every edit and no LLM sees one', () => {
  const ctx = { userId: 'u1' }
  let spies: Array<ReturnType<typeof vi.spyOn>>

  beforeEach(() => {
    vi.clearAllMocks()
    spies = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ]
  })
  afterEach(() => spies.forEach((spy) => spy.mockRestore()))

  /** What the agent loop would put in front of the model for a tool result. */
  function llmPayload(tool: string, result: unknown) {
    return [
      {
        role: 'user' as const,
        content: formatToolResultForAgentMessage(tool, sanitizeMcpToolResult(result)),
      },
    ]
  }

  it('read, fix a typo with the shown placeholders, append a line: both secrets intact', async () => {
    const db = oneNoteDb(ORIGINAL)
    const llmSaw: unknown[] = []

    const read = await runGetTextFileTool(ctx, { text_file_id: 'f1' })
    llmSaw.push(llmPayload('get_text_file', read))
    const shown = read.textFile.body as string
    expect(shown).toContain('LLM_API_KEY=[redacted secret #1]')
    expect(shown).toContain('GITHUB_TOKEN=[redacted secret #2]')

    // the agent fixes a typo elsewhere, echoing the placeholders it was given
    const updated = await runUpdateTextFileTool(ctx, {
      text_file_id: 'f1',
      body: shown.replace('versoin', 'version'),
    })
    llmSaw.push(llmPayload('update_text_file', updated))
    expect(db.stored()).toBe(ORIGINAL.replace('versoin', 'version'))

    // then appends a line
    const appended = await runAppendTextFileTool(ctx, {
      text_file_id: 'f1',
      text: 'Rotate the keys monthly.',
    })
    llmSaw.push(llmPayload('append_text_file', appended))
    expect(db.stored()).toBe(`${ORIGINAL.replace('versoin', 'version')}\nRotate the keys monthly.`)
    expect(db.stored()).toContain(FAKE_SECRETS.openai)
    expect(db.stored()).toContain(FAKE_SECRETS.githubClassic)

    // what the model saw, what was embedded/indexed and what was logged: placeholders only
    expect(leaks(JSON.stringify(llmSaw))).toBe(false)
    expect(guardWouldTrip(llmSaw)).toBe(false)
    const warn = vi.mocked(console.warn)
    guardOutgoingMessages(llmSaw.flat() as Array<{ content: string }>, 'roundtrip')
    expect(warn).not.toHaveBeenCalled()
    expect(leaks(JSON.stringify(preparePassageSyncMock.mock.calls))).toBe(false)
    expect(guardWouldTrip(preparePassageSyncMock.mock.calls)).toBe(false)
    for (const spy of spies) expect(leaks(JSON.stringify(spy.mock.calls))).toBe(false)
  })

  it('a placeholder the note does not have, or a bare one, fails loud and the stored body is untouched', async () => {
    const db = oneNoteDb(ORIGINAL)

    await expect(
      runUpdateTextFileTool(ctx, { text_file_id: 'f1', body: 'KEY=[redacted secret #7]' }),
    ).rejects.toThrow(
      'placeholder #7 does not exist in this note; keep placeholders exactly as returned',
    )
    await expect(
      runUpdateTextFileTool(ctx, { text_file_id: 'f1', body: 'KEY=[redacted secret]' }),
    ).rejects.toThrow(/Notes editor/)
    await expect(
      runAppendTextFileTool(ctx, { text_file_id: 'f1', text: 'token: [redacted secret]' }),
    ).rejects.toThrow(/Notes editor/)
    await expect(
      runCreateTextFileTool(ctx, { title: 'copy', body: 'KEY=[redacted secret #1]' }),
    ).rejects.toThrow(/does not exist in this note/)

    expect(db.stored()).toBe(ORIGINAL)
    expect(encryptMock).not.toHaveBeenCalled()
  })
})
