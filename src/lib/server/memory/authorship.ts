import { and, eq, like, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userApiKey, thought, type MemoryAuthor } from '$lib/server/db/schema';

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

export type AuthenticatedApiKey = { id: string; name: string };

export function authorshipFromAuthenticatedApiKey(key: AuthenticatedApiKey): MemoryAuthorship {
	return {
		author: 'agent',
		authorLabel: key.name,
		authorKeyId: key.id
	};
}

/** MCP capture authorship: explicit prefix, else Bearer API key identity, else user. */
export async function resolveMcpCaptureAuthorship(input: {
	authorPrefix?: string | null;
	asUser?: boolean;
	authenticatedApiKey?: AuthenticatedApiKey | null;
}): Promise<MemoryAuthorship> {
	if (input.asUser === true) {
		return USER_AUTHORSHIP;
	}
	const trimmed = input.authorPrefix?.trim() ?? '';
	if (trimmed) {
		return resolveAuthorFromPrefix(trimmed);
	}
	if (input.authenticatedApiKey) {
		return authorshipFromAuthenticatedApiKey(input.authenticatedApiKey);
	}
	return USER_AUTHORSHIP;
}

export type AuthorLayerMeta = {
	key: string;
	label: string;
	kind: 'user' | 'agent';
};

/** Stable filter-layer key for a thought row or authorship tuple. */
export function authorLayerKeyFromThought(input: {
	author: MemoryAuthor;
	authorKeyId: string | null;
	authorLabel: string | null;
}): string {
	if (input.author !== 'agent') return 'user';
	if (input.authorKeyId) return `apikey:${input.authorKeyId}`;
	const label = input.authorLabel?.trim();
	if (label) return `label:${label}`;
	return 'user';
}

export async function listAuthorLayersForUser(userId: string): Promise<AuthorLayerMeta[]> {
	const db = getDb();
	const layers: AuthorLayerMeta[] = [{ key: 'user', label: 'You', kind: 'user' }];
	const seen = new Set<string>(['user']);

	const activeKeys = await db
		.select({ id: userApiKey.id, name: userApiKey.name })
		.from(userApiKey)
		.where(and(eq(userApiKey.userId, userId), eq(userApiKey.isActive, true)));

	for (const key of activeKeys) {
		const layerKey = `apikey:${key.id}`;
		if (seen.has(layerKey)) continue;
		seen.add(layerKey);
		layers.push({ key: layerKey, label: key.name, kind: 'agent' });
	}

	const legacyAgentRows = await db
		.selectDistinct({ authorLabel: thought.authorLabel })
		.from(thought)
		.where(
			and(
				eq(thought.userId, userId),
				eq(thought.author, 'agent'),
				sql`${thought.authorKeyId} IS NULL`,
				sql`${thought.authorLabel} IS NOT NULL`
			)
		);

	for (const row of legacyAgentRows) {
		const label = row.authorLabel?.trim();
		if (!label) continue;
		const layerKey = `label:${label}`;
		if (seen.has(layerKey)) continue;
		seen.add(layerKey);
		layers.push({ key: layerKey, label, kind: 'agent' });
	}

	return layers;
}
