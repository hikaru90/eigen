import { decryptEnvelope, encryptEnvelope } from '$lib/server/crypto/envelope'
import { getOrCreateTenantDek } from '$lib/server/crypto/tenant-keys'

function aadFor(userId: string, table: string, column: string): string {
  return `tenant:${userId}|table:${table}|column:${column}`
}

export async function encryptTenantValue(input: {
  userId: string
  table: string
  column: string
  plaintext: string
}): Promise<string> {
  const { dek } = await getOrCreateTenantDek(input.userId)
  return encryptEnvelope(input.plaintext, dek, aadFor(input.userId, input.table, input.column))
}

export async function decryptTenantValue(input: {
  userId: string
  table: string
  column: string
  ciphertext: string
}): Promise<string> {
  const { dek } = await getOrCreateTenantDek(input.userId)
  return decryptEnvelope(input.ciphertext, dek, aadFor(input.userId, input.table, input.column))
}
