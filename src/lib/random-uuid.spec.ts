import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUuidV4, randomUuid } from './random-uuid';

describe('randomUuid', () => {
	const originalCrypto = globalThis.crypto;

	afterEach(() => {
		Object.defineProperty(globalThis, 'crypto', {
			value: originalCrypto,
			configurable: true,
			writable: true
		});
		vi.restoreAllMocks();
	});

	it('returns a valid UUID v4 when crypto.randomUUID exists', () => {
		const id = randomUuid();
		expect(isUuidV4(id)).toBe(true);
	});

	it('falls back to getRandomValues when randomUUID is unavailable', () => {
		const getRandomValues = vi.fn((array: Uint8Array) => {
			for (let i = 0; i < array.length; i++) array[i] = i + 1;
			return array;
		});
		Object.defineProperty(globalThis, 'crypto', {
			value: { getRandomValues },
			configurable: true,
			writable: true
		});

		const id = randomUuid();
		expect(isUuidV4(id)).toBe(true);
		expect(getRandomValues).toHaveBeenCalledOnce();
	});

	it('throws when neither randomUUID nor getRandomValues is available', () => {
		Object.defineProperty(globalThis, 'crypto', {
			value: {},
			configurable: true,
			writable: true
		});

		expect(() => randomUuid()).toThrow('UUID generation is not available');
	});
});
