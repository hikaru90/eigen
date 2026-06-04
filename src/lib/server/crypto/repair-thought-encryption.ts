import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption';

export function isDecryptAuthFailure(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes('Unsupported state') || msg.includes('unable to authenticate');
}

/**
 * Verify tenant ciphertext decrypts; when auth fails but plaintext columns exist,
 * re-encrypt with the current tenant DEK (stale ciphertext after key rotation).
 */
export async function repairThoughtEncryptionFromPlaintext(
	userId: string,
	thoughtId: string
): Promise<boolean> {
	const db = getDb();
	const [row] = await db
		.select({
			id: thought.id,
			rawText: thought.rawText,
			rawTextEncrypted: thought.rawTextEncrypted,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted
		})
		.from(thought)
		.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
		.limit(1);

	if (!row) return false;

	const hasEncrypted =
		Boolean(row.rawTextEncrypted) ||
		Boolean(row.normalizedTextEncrypted) ||
		Boolean(row.metadataEncrypted);
	if (!hasEncrypted) return true;

	try {
		if (row.normalizedTextEncrypted) {
			await decryptTenantValue({
				userId,
				table: 'thought',
				column: 'normalized_text',
				ciphertext: row.normalizedTextEncrypted
			});
		}
		return true;
	} catch (err) {
		if (!isDecryptAuthFailure(err)) throw err;
	}

	if (!row.rawText?.trim() && !row.normalizedText?.trim()) {
		return false;
	}

	const metadataJson = JSON.stringify(row.metadata ?? {});
	const [rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted] = await Promise.all([
		encryptTenantValue({ userId, table: 'thought', column: 'raw_text', plaintext: row.rawText }),
		encryptTenantValue({
			userId,
			table: 'thought',
			column: 'normalized_text',
			plaintext: row.normalizedText
		}),
		encryptTenantValue({ userId, table: 'thought', column: 'metadata', plaintext: metadataJson })
	]);

	await db
		.update(thought)
		.set({ rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted, updatedAt: new Date() })
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)));

	return true;
}
