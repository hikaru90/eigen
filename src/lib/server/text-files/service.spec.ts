import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	appendTextFile,
	createTextFile,
	deleteTextFile,
	getTextFile,
	linkTextFileToThought,
	listTextFilesForThought,
	listTextFilesForThoughtIds,
	listThoughtsForTextFile,
	searchTextFiles,
	unlinkTextFileFromThought,
	updateTextFile
} from './service';

const { getDbMock, encryptTenantValueMock, decryptTenantValueMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	encryptTenantValueMock: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
	decryptTenantValueMock: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
		ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext
	)
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	encryptTenantValue: encryptTenantValueMock,
	decryptTenantValue: decryptTenantValueMock
}));

function makeReturningInsert(row: unknown) {
	return {
		values: vi.fn(() => ({
			returning: vi.fn(async () => [row])
		}))
	};
}

describe('text-files service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createTextFile encrypts body and returns decrypted record', async () => {
		const createdAt = new Date('2026-06-05T12:00:00.000Z');
		getDbMock.mockReturnValue({
			insert: vi.fn(() =>
				makeReturningInsert({
					id: 'f1',
					title: 'Notes',
					bodyText: '',
					bodyTextEncrypted: 'enc:hello world',
					createdAt,
					updatedAt: createdAt
				})
			)
		});

		const result = await createTextFile('u1', { title: 'Notes', body: 'hello world' });

		expect(encryptTenantValueMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', table: 'text_file', column: 'body_text' })
		);
		expect(result).toMatchObject({
			id: 'f1',
			title: 'Notes',
			body: 'hello world'
		});
	});

	it('rejects create when title and body are both empty', async () => {
		await expect(createTextFile('u1', { body: '   ' })).rejects.toThrow(
			/title or body is required/
		);
		await expect(createTextFile('u1', { title: '   ' })).rejects.toThrow(
			/title or body is required/
		);
	});

	it('createTextFile allows title-only notes with empty body', async () => {
		const createdAt = new Date('2026-06-05T12:00:00.000Z');
		getDbMock.mockReturnValue({
			insert: vi.fn(() =>
				makeReturningInsert({
					id: 'f2',
					title: 'shopping list',
					bodyText: '',
					bodyTextEncrypted: 'enc:',
					createdAt,
					updatedAt: createdAt
				})
			)
		});

		const result = await createTextFile('u1', { title: 'shopping list' });

		expect(encryptTenantValueMock).toHaveBeenCalledWith(
			expect.objectContaining({ plaintext: '' })
		);
		expect(result).toMatchObject({
			id: 'f2',
			title: 'shopping list',
			body: ''
		});
	});

	it('updateTextFile returns null when missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		});

		const result = await updateTextFile('u1', 'missing', { body: 'next' });
		expect(result).toBeNull();
	});

	it('appendTextFile returns null when missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		});

		const result = await appendTextFile('u1', 'missing', { text: 'milk' });
		expect(result).toBeNull();
	});

	it('appendTextFile rejects blank text', async () => {
		await expect(appendTextFile('u1', 'f1', { text: '   ' })).rejects.toThrow(/text is required/);
	});

	it('appendTextFile inserts a newline between existing body and new text', async () => {
		const createdAt = new Date('2026-06-05T12:00:00.000Z');
		const updatedAt = new Date('2026-06-05T13:00:00.000Z');
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [
							{
								id: 'f1',
								title: 'shopping list',
								bodyText: '',
								bodyTextEncrypted: 'enc:eggs',
								author: 'user',
								authorLabel: null,
								authorKeyId: null,
								createdAt,
								updatedAt: createdAt
							}
						])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [
							{
								id: 'f1',
								title: 'shopping list',
								bodyText: '',
								bodyTextEncrypted: 'enc:eggs\nmilk',
								author: 'user',
								authorLabel: null,
								authorKeyId: null,
								createdAt,
								updatedAt
							}
						])
					}))
				}))
			}))
		});

		const result = await appendTextFile('u1', 'f1', { text: 'milk' });

		expect(encryptTenantValueMock).toHaveBeenCalledWith(
			expect.objectContaining({ plaintext: 'eggs\nmilk' })
		);
		expect(result).toMatchObject({
			id: 'f1',
			title: 'shopping list',
			body: 'eggs\nmilk'
		});
	});

	it('appendTextFile does not double-newline when body already ends with newline', async () => {
		const createdAt = new Date('2026-06-05T12:00:00.000Z');
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [
							{
								id: 'f1',
								title: 'list',
								bodyText: '',
								bodyTextEncrypted: 'enc:eggs\n',
								author: 'user',
								authorLabel: null,
								authorKeyId: null,
								createdAt,
								updatedAt: createdAt
							}
						])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [
							{
								id: 'f1',
								title: 'list',
								bodyText: '',
								bodyTextEncrypted: 'enc:eggs\nmilk',
								author: 'user',
								authorLabel: null,
								authorKeyId: null,
								createdAt,
								updatedAt: createdAt
							}
						])
					}))
				}))
			}))
		});

		await appendTextFile('u1', 'f1', { text: 'milk' });
		expect(encryptTenantValueMock).toHaveBeenCalledWith(
			expect.objectContaining({ plaintext: 'eggs\nmilk' })
		);
	});

	it('appendTextFile appends without separator when body is empty', async () => {
		const createdAt = new Date('2026-06-05T12:00:00.000Z');
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [
							{
								id: 'f1',
								title: 'shopping list',
								bodyText: '',
								bodyTextEncrypted: 'enc:',
								author: 'user',
								authorLabel: null,
								authorKeyId: null,
								createdAt,
								updatedAt: createdAt
							}
						])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [
							{
								id: 'f1',
								title: 'shopping list',
								bodyText: '',
								bodyTextEncrypted: 'enc:milk',
								author: 'user',
								authorLabel: null,
								authorKeyId: null,
								createdAt,
								updatedAt: createdAt
							}
						])
					}))
				}))
			}))
		});

		const result = await appendTextFile('u1', 'f1', { text: 'milk' });
		expect(encryptTenantValueMock).toHaveBeenCalledWith(
			expect.objectContaining({ plaintext: 'milk' })
		);
		expect(result?.body).toBe('milk');
	});

	it('deleteTextFile reports whether a row was removed', async () => {
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(async () => [{ id: 'f1' }])
				}))
			}))
		});
		expect(await deleteTextFile('u1', 'f1')).toBe(true);
	});

	it('getTextFile decrypts stored body', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [
							{
								id: 'f1',
								title: '',
								bodyText: '',
								bodyTextEncrypted: 'enc:secret note',
								createdAt: new Date('2026-06-05T12:00:00.000Z'),
								updatedAt: new Date('2026-06-05T12:00:00.000Z')
							}
						])
					}))
				}))
			}))
		});

		const file = await getTextFile('u1', 'f1');
		expect(file?.body).toBe('secret note');
	});

	it('linkTextFileToThought validates ownership', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		});

		const result = await linkTextFileToThought('u1', 't1', 'f1');
		expect(result).toEqual({ linked: false, reason: 'thought_not_found' });
	});

	it('listTextFilesForThought returns previews', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(async () => [
								{
									id: 'f1',
									title: 'Doc',
									bodyText: '',
									bodyTextEncrypted: 'enc:long body text here',
									updatedAt: new Date('2026-06-05T12:00:00.000Z')
								}
							])
						}))
					}))
				}))
			}))
		});

		const rows = await listTextFilesForThought('u1', 't1');
		expect(rows).toEqual([
			{
				id: 'f1',
				title: 'Doc',
				preview: 'long body text here',
				updatedAt: '2026-06-05T12:00:00.000Z'
			}
		]);
	});

	it('unlinkTextFileFromThought returns false when link missing', async () => {
		getDbMock.mockReturnValue({
			delete: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(async () => [])
				}))
			}))
		});
		expect(await unlinkTextFileFromThought('u1', 't1', 'f1')).toBe(false);
	});

	it('listTextFilesForThoughtIds groups attachments by thought', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(async () => [
								{
									thoughtId: 't1',
									id: 'f1',
									title: 'Doc',
									bodyText: '',
									bodyTextEncrypted: 'enc:recipe body',
									updatedAt: new Date('2026-06-05T12:00:00.000Z')
								},
								{
									thoughtId: 't2',
									id: 'f2',
									title: 'Other',
									bodyText: '',
									bodyTextEncrypted: 'enc:other',
									updatedAt: new Date('2026-06-05T12:00:00.000Z')
								}
							])
						}))
					}))
				}))
			}))
		});

		const map = await listTextFilesForThoughtIds('u1', ['t1', 't2']);
		expect(map.get('t1')).toEqual([
			{
				id: 'f1',
				title: 'Doc',
				preview: 'recipe body',
				updatedAt: '2026-06-05T12:00:00.000Z'
			}
		]);
		expect(map.get('t2')).toHaveLength(1);
	});

	it('listThoughtsForTextFile returns empty when note missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		});

		const rows = await listThoughtsForTextFile('u1', 'missing');
		expect(rows).toEqual([]);
	});

	it('listThoughtsForTextFile returns linked thought snippets', async () => {
		let selectCall = 0;
		getDbMock.mockReturnValue({
			select: vi.fn(() => {
				selectCall += 1;
				if (selectCall === 1) {
					return {
						from: vi.fn(() => ({
							where: vi.fn(() => ({
								limit: vi.fn(async () => [{ id: 'f1' }])
							}))
						}))
					};
				}
				return {
					from: vi.fn(() => ({
						innerJoin: vi.fn(() => ({
							where: vi.fn(() => ({
								orderBy: vi.fn(async () => [
									{ id: 't1', normalizedText: 'Buy groceries' }
								])
							}))
						}))
					}))
				};
			})
		});

		const rows = await listThoughtsForTextFile('u1', 'f1');
		expect(rows).toEqual([{ id: 't1', normalizedText: 'Buy groceries' }]);
	});

	it('searchTextFiles returns empty for blank query tokens', async () => {
		const rows = await searchTextFiles('u1', { query: 'a' });
		expect(rows).toEqual([]);
		expect(getDbMock).not.toHaveBeenCalled();
	});

	it('searchTextFiles passes authorFilter to the query when provided', async () => {
		const whereSpy = vi.fn(() => ({
			orderBy: vi.fn(() => ({
				limit: vi.fn(async () => [])
			}))
		}));
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: whereSpy
				}))
			}))
		});
		await searchTextFiles('u1', { query: 'recipe notes', authorFilter: 'user' });
		expect(whereSpy).toHaveBeenCalled();
	});
});
