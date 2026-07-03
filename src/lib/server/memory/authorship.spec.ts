import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	USER_AUTHORSHIP,
	resolveAuthorFromPrefix,
	resolveMemoryAuthorship
} from './authorship';

const { getDbMock, selectMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	selectMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

function mockKeyLookup(rows: Array<{ id: string; name: string }>) {
	selectMock.mockReturnValue({
		from: vi.fn(() => ({
			where: vi.fn(async () => rows)
		}))
	});
	getDbMock.mockReturnValue({ select: selectMock });
}

describe('resolveAuthorFromPrefix', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns user authorship for empty prefix', async () => {
		await expect(resolveAuthorFromPrefix('')).resolves.toEqual(USER_AUTHORSHIP);
		await expect(resolveAuthorFromPrefix('   ')).resolves.toEqual(USER_AUTHORSHIP);
		await expect(resolveAuthorFromPrefix(undefined)).resolves.toEqual(USER_AUTHORSHIP);
	});

	it('returns agent authorship when exactly one key matches', async () => {
		mockKeyLookup([{ id: 'key-1', name: 'cursor' }]);
		await expect(resolveAuthorFromPrefix('eigen_abcd')).resolves.toEqual({
			author: 'agent',
			authorLabel: 'cursor',
			authorKeyId: 'key-1'
		});
	});

	it('throws when no key matches', async () => {
		mockKeyLookup([]);
		await expect(resolveAuthorFromPrefix('unknown')).rejects.toThrow(/No API key matches/);
	});

	it('throws when multiple keys match', async () => {
		mockKeyLookup([
			{ id: 'key-1', name: 'a' },
			{ id: 'key-2', name: 'b' }
		]);
		await expect(resolveAuthorFromPrefix('eigen_')).rejects.toThrow(/Ambiguous author prefix/);
	});
});

describe('resolveMemoryAuthorship', () => {
	it('requires authorLabel when author is agent', () => {
		expect(() => resolveMemoryAuthorship({ author: 'agent' })).toThrow(/authorLabel/);
	});

	it('accepts explicit agent authorship', () => {
		expect(
			resolveMemoryAuthorship({
				author: 'agent',
				authorLabel: 'cursor',
				authorKeyId: 'a1111111-1111-4111-8111-111111111111'
			})
		).toEqual({
			author: 'agent',
			authorLabel: 'cursor',
			authorKeyId: 'a1111111-1111-4111-8111-111111111111'
		});
	});
});
