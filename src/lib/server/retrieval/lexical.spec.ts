import { describe, expect, it, vi } from 'vitest';
import { lexicalSearch } from './lexical';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

describe('lexicalSearch', () => {
	it('returns normalized lexical results', async () => {
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(async () => [
								{
									id: 't1',
									normalizedText: 'hello world',
									category: 'thought',
									metadata: {},
									lexicalScore: 0.42
								}
							])
						}))
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const out = await lexicalSearch({ userId: 'u1', query: 'hello', limit: 10 });
		expect(out).toEqual([
			{
				id: 't1',
				normalizedText: 'hello world',
				category: 'thought',
				metadata: {},
				lexicalScore: 0.42
			}
		]);
	});

	it('applies default metadata and lexicalScore fallback', async () => {
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(async () => [
								{
									id: 't2',
									normalizedText: 'fallback',
									category: 'idea',
									metadata: null,
									lexicalScore: undefined
								}
							])
						}))
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		const out = await lexicalSearch({ userId: 'u1', query: 'fallback', limit: 5 });
		expect(out[0]).toEqual({
			id: 't2',
			normalizedText: 'fallback',
			category: 'idea',
			metadata: {},
			lexicalScore: 0
		});
	});
});
