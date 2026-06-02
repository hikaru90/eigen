import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptEnvelope, encryptEnvelope } from '$lib/server/crypto/envelope';

function keyFrom(input: string): Buffer {
	return createHash('sha256').update(input, 'utf8').digest();
}

describe('envelope encryption', () => {
	it('round-trips plaintext with matching AAD', () => {
		const key = keyFrom('test-key');
		const aad = 'tenant:u1|table:thought|column:raw_text';
		const encrypted = encryptEnvelope('hello world', key, aad);
		const decrypted = decryptEnvelope(encrypted, key, aad);
		expect(decrypted).toBe('hello world');
	});

	it('fails decrypt when AAD mismatches', () => {
		const key = keyFrom('test-key');
		const encrypted = encryptEnvelope('hello world', key, 'tenant:u1|table:thought|column:raw_text');
		expect(() =>
			decryptEnvelope(encrypted, key, 'tenant:u1|table:thought|column:normalized_text')
		).toThrow();
	});
});
