import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'

/**
 * At-rest storage for `thought.ask_question` — the same tenant-envelope pattern as
 * raw/normalized text: plaintext column plus `_encrypted` ciphertext; reads decrypt.
 */
export async function askQuestionColumns(
  userId: string,
  question: string | null,
): Promise<{ askQuestion: string | null; askQuestionEncrypted: string | null }> {
  if (question === null) return { askQuestion: null, askQuestionEncrypted: null }
  const askQuestionEncrypted = await encryptTenantValue({
    userId,
    table: 'thought',
    column: 'ask_question',
    plaintext: question,
  })
  return { askQuestion: question, askQuestionEncrypted }
}

export async function readAskQuestion(
  userId: string,
  row: { askQuestion: string | null; askQuestionEncrypted: string | null },
): Promise<string | null> {
  if (row.askQuestionEncrypted) {
    return decryptTenantValue({
      userId,
      table: 'thought',
      column: 'ask_question',
      ciphertext: row.askQuestionEncrypted,
    })
  }
  return row.askQuestion
}
