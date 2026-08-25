import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envMock } = vi.hoisted(() => ({
	envMock: { ADMIN_CONSOLIDATION_KEY: undefined as string | undefined },
}))

vi.mock('$lib/server/env/private-env', () => ({
	env: envMock,
}))

import { isEigenAdminKeyConfigured, requireAdminKey } from './admin-key'

function fakeEvent(adminKey: string | null) {
	return {
		request: {
			headers: {
				get: (name: string) => (name.toLowerCase() === 'x-admin-key' ? adminKey : null),
			},
		},
	} as Parameters<typeof requireAdminKey>[0]
}

describe('isEigenAdminKeyConfigured', () => {
	beforeEach(() => {
		envMock.ADMIN_CONSOLIDATION_KEY = undefined
	})

	it('returns false when unset or blank', () => {
		expect(isEigenAdminKeyConfigured()).toBe(false)
		envMock.ADMIN_CONSOLIDATION_KEY = '   '
		expect(isEigenAdminKeyConfigured()).toBe(false)
	})

	it('returns true when set', () => {
		envMock.ADMIN_CONSOLIDATION_KEY = 'secret'
		expect(isEigenAdminKeyConfigured()).toBe(true)
	})
})

describe('requireAdminKey', () => {
	beforeEach(() => {
		envMock.ADMIN_CONSOLIDATION_KEY = undefined
	})

	it('returns 401 when key is not configured', () => {
		expect(() => requireAdminKey(fakeEvent('any'))).toThrow(
			expect.objectContaining({ status: 401 }),
		)
	})

	it('returns 401 when header is missing or wrong', () => {
		envMock.ADMIN_CONSOLIDATION_KEY = 'secret'
		expect(() => requireAdminKey(fakeEvent(null))).toThrow(
			expect.objectContaining({ status: 401 }),
		)
		expect(() => requireAdminKey(fakeEvent('wrong'))).toThrow(
			expect.objectContaining({ status: 401 }),
		)
	})

	it('allows matching key', () => {
		envMock.ADMIN_CONSOLIDATION_KEY = 'secret'
		expect(() => requireAdminKey(fakeEvent('secret'))).not.toThrow()
		expect(() => requireAdminKey(fakeEvent('  secret  '))).not.toThrow()
	})
})
