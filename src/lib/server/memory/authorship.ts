import { and, eq, like } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userApiKey, type MemoryAuthor } from '$lib/server/db/schema';

export type MemoryAuthorship = {
	author: MemoryAuthor;
	authorLabel: string | null;
	authorKeyId: string | null;
};

export const USER_AUTHORSHIP: MemoryAuthorship = {
	author: 'user',
	authorLabel: null,
	authorKeyId: null
};

export async function resolveAuthorFromPrefix(
	prefix: string | null | undefined
): Promise<MemoryAuthorship> {
	const trimmed = prefix?.trim() ?? '';
	if (!trimmed) {
		return USER_AUTHORSHIP;
	}

	const db = getDb();
	const rows = await db
		.select({ id: userApiKey.id, name: userApiKey.name })
		.from(userApiKey)
		.where(and(eq(userApiKey.isActive, true), like(userApiKey.keyPrefix, `${trimmed}%`)));

	if (rows.length === 0) {
		throw new Error(`No API key matches author prefix "${trimmed}"`);
	}
	if (rows.length > 1) {
		throw new Error(`Ambiguous author prefix "${trimmed}" — matches multiple API keys`);
	}

	return {
		author: 'agent',
		authorLabel: rows[0].name,
		authorKeyId: rows[0].id
	};
}

export function resolveMemoryAuthorship(input?: Partial<MemoryAuthorship>): MemoryAuthorship {
	const author = input?.author ?? 'user';
	if (author === 'agent') {
		const label = input?.authorLabel?.trim();
		if (!label) {
			throw new Error('authorLabel is required when author is agent');
		}
		return {
			author: 'agent',
			authorLabel: label,
			authorKeyId: input?.authorKeyId ?? null
		};
	}
	return USER_AUTHORSHIP;
}

export function authorshipInsertValues(authorship: MemoryAuthorship): {
	author: MemoryAuthor;
	authorLabel: string | null;
	authorKeyId: string | null;
} {
	return {
		author: authorship.author,
		authorLabel: authorship.authorLabel,
		authorKeyId: authorship.authorKeyId
	};
}

export function graphAuthorProperty(authorship: MemoryAuthorship): string {
	return authorship.author === 'agent' && authorship.authorLabel
		? authorship.authorLabel
		: 'user';
}
