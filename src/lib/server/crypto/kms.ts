import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { decryptEnvelope, encryptEnvelope } from '$lib/server/crypto/envelope';

export type TenantKekProvider = 'local';

function deriveLocalMasterKey(): Buffer {
	const raw = env.TENANT_MASTER_KEY?.trim();
	if (!raw) {
		throw new Error('TENANT_MASTER_KEY is required for tenant envelope encryption');
	}
	return createHash('sha256').update(raw, 'utf8').digest();
}

export async function wrapDek(input: { userId: string; dekBytes: Buffer }): Promise<string> {
	return encryptEnvelope(input.dekBytes.toString('base64'), deriveLocalMasterKey(), `tenant:${input.userId}`);
}

export async function unwrapDek(input: { userId: string; wrappedDek: string }): Promise<Buffer> {
	const b64 = decryptEnvelope(input.wrappedDek, deriveLocalMasterKey(), `tenant:${input.userId}`);
	return Buffer.from(b64, 'base64');
}

export function getKekProvider(): TenantKekProvider {
	return 'local';
}

export function getKekKeyId(): string {
	return 'local-master-key';
}
