import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTextFile,
	deleteTextFile,
	getTextFile,
	linkTextFileToThought,
	listTextFilesForThought,
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

	it('rejects empty body on create', async () => {
		await expect(createTextFile('u1', { body: '   ' })).rejects.toThrow(/body is required/);
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

	it('searchTextFiles returns empty for blank query tokens', async () => {
		const rows = await searchTextFiles('u1', { query: 'a' });
		expect(rows).toEqual([]);
		expect(getDbMock).not.toHaveBeenCalled();
	});
});
