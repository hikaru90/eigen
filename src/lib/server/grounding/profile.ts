import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userGroundingProfile } from '$lib/server/db/schema';
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import {
	GROUNDING_FACET_KEY_SET,
	GROUNDING_FACET_MAX_CHARS,
	type GroundingFacetKey
} from '$lib/server/grounding/constants';
import { synthesizeGroundingNarrative } from '$lib/server/grounding/synthesize-narrative';
import type {
	GroundingProfileForEnrichment,
	GroundingProfileSnapshot
} from '$lib/server/grounding/types';

const GROUNDING_TABLE = 'user_grounding_profile';
const NARRATIVE_COLUMN = 'narrative_summary';

function normalizeFacets(raw: Record<string, string> | null | undefined): Record<string, string> {
	if (!raw || typeof raw !== 'object') return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		const k = key.trim();
		if (!GROUNDING_FACET_KEY_SET.has(k)) continue;
		if (typeof value !== 'string') continue;
		const v = value.trim().slice(0, GROUNDING_FACET_MAX_CHARS);
		if (v.length > 0) out[k] = v;
	}
	return out;
}

export function validateGroundingFacetInput(
	facets: Array<{ key: string; content: string }>
): Array<{ key: GroundingFacetKey; content: string }> {
	const out: Array<{ key: GroundingFacetKey; content: string }> = [];
	for (const facet of facets) {
		const key = facet.key.trim();
		if (!GROUNDING_FACET_KEY_SET.has(key)) {
			throw new Error(
				`Invalid grounding facet key "${key}". Allowed: ${[...GROUNDING_FACET_KEY_SET].join(', ')}`
			);
		}
		const content = facet.content.trim().slice(0, GROUNDING_FACET_MAX_CHARS);
		if (content.length === 0) {
			throw new Error(`Grounding facet "${key}" content cannot be empty`);
		}
		out.push({ key: key as GroundingFacetKey, content });
	}
	return out;
}

async function decryptNarrative(userId: string, encrypted: string | null): Promise<string> {
	if (!encrypted) return '';
	return decryptTenantValue({
		userId,
		table: GROUNDING_TABLE,
		column: NARRATIVE_COLUMN,
		ciphertext: encrypted
	});
}

async function rowToSnapshot(
	userId: string,
	row: typeof userGroundingProfile.$inferSelect
): Promise<GroundingProfileSnapshot> {
	const narrativeSummary = await decryptNarrative(userId, row.narrativeSummaryEncrypted);
	return {
		narrativeSummary,
		facets: normalizeFacets(row.facets),
		initialCompletedAt: row.initialCompletedAt,
		lastSessionAt: row.lastSessionAt,
		sessionCount: row.sessionCount
	};
}

export async function loadGroundingProfileRow(
	userId: string
): Promise<GroundingProfileSnapshot | null> {
	const [row] = await getDb()
		.select()
		.from(userGroundingProfile)
		.where(eq(userGroundingProfile.userId, userId))
		.limit(1);
	if (!row) return null;
	return rowToSnapshot(userId, row);
}

export async function loadGroundingProfileForEnrichment(
	userId: string
): Promise<GroundingProfileForEnrichment> {
	const snapshot = await loadGroundingProfileRow(userId);
	if (!snapshot) return null;
	const hasContent =
		snapshot.narrativeSummary.trim().length > 0 || Object.keys(snapshot.facets).length > 0;
	if (!hasContent) return null;
	return {
		narrativeSummary: snapshot.narrativeSummary,
		facets: snapshot.facets
	};
}

export function isInitialGroundingComplete(snapshot: GroundingProfileSnapshot | null): boolean {
	return snapshot?.initialCompletedAt != null;
}

export async function mergeGroundingFacets(input: {
	userId: string;
	facets: Array<{ key: GroundingFacetKey; content: string }>;
	sessionNote?: string;
	/** When false (default for incremental chat saves), only merge facets — no LLM synthesis. */
	synthesizeNarrative?: boolean;
}): Promise<GroundingProfileSnapshot> {
	const validated = validateGroundingFacetInput(input.facets);
	const [existingRow] = await getDb()
		.select()
		.from(userGroundingProfile)
		.where(eq(userGroundingProfile.userId, input.userId))
		.limit(1);
	const existing = existingRow ? await rowToSnapshot(input.userId, existingRow) : null;
	const mergedFacets = { ...(existing?.facets ?? {}) };
	for (const { key, content } of validated) {
		mergedFacets[key] = content;
	}

	let narrativeSummaryEncrypted = existingRow?.narrativeSummaryEncrypted ?? null;

	if (input.synthesizeNarrative === true) {
		const priorNarrative = existing?.narrativeSummary ?? '';
		const narrativeSummary = await synthesizeGroundingNarrative({
			userId: input.userId,
			facets: mergedFacets,
			sessionNote: input.sessionNote,
			priorNarrative: priorNarrative || undefined
		});
		narrativeSummaryEncrypted = await encryptTenantValue({
			userId: input.userId,
			table: GROUNDING_TABLE,
			column: NARRATIVE_COLUMN,
			plaintext: narrativeSummary
		});
	}

	const [row] = await getDb()
		.insert(userGroundingProfile)
		.values({
			userId: input.userId,
			narrativeSummaryEncrypted,
			facets: mergedFacets,
			sessionCount: existing?.sessionCount ?? 0
		})
		.onConflictDoUpdate({
			target: userGroundingProfile.userId,
			set: {
				...(input.synthesizeNarrative === true && narrativeSummaryEncrypted
					? { narrativeSummaryEncrypted }
					: {}),
				facets: mergedFacets,
				updatedAt: new Date()
			}
		})
		.returning();

	return rowToSnapshot(input.userId, row);
}

export async function completeGroundingSession(input: {
	userId: string;
	synthesis?: string;
}): Promise<{ initialCompleted: boolean; redirectTo: string; snapshot: GroundingProfileSnapshot }> {
	const existing = await loadGroundingProfileRow(input.userId);
	let narrativeSummary = existing?.narrativeSummary ?? '';
	const mergedFacets = { ...(existing?.facets ?? {}) };

	if (input.synthesis?.trim()) {
		narrativeSummary = input.synthesis.trim().slice(0, 4000);
	} else if (Object.keys(mergedFacets).length > 0) {
		narrativeSummary = await synthesizeGroundingNarrative({
			userId: input.userId,
			facets: mergedFacets,
			priorNarrative: narrativeSummary || undefined
		});
	}

	const narrativeSummaryEncrypted =
		narrativeSummary.length > 0
			? await encryptTenantValue({
					userId: input.userId,
					table: GROUNDING_TABLE,
					column: NARRATIVE_COLUMN,
					plaintext: narrativeSummary
				})
			: null;

	const now = new Date();
	const wasComplete = existing?.initialCompletedAt != null;
	const initialCompletedAt = wasComplete ? existing!.initialCompletedAt! : now;

	const [row] = await getDb()
		.insert(userGroundingProfile)
		.values({
			userId: input.userId,
			narrativeSummaryEncrypted,
			facets: mergedFacets,
			initialCompletedAt,
			lastSessionAt: now,
			sessionCount: 1
		})
		.onConflictDoUpdate({
			target: userGroundingProfile.userId,
			set: {
				...(narrativeSummaryEncrypted ? { narrativeSummaryEncrypted } : {}),
				initialCompletedAt,
				lastSessionAt: now,
				sessionCount: (existing?.sessionCount ?? 0) + 1,
				updatedAt: now
			}
		})
		.returning();

	const snapshot = await rowToSnapshot(input.userId, row);
	return {
		initialCompleted: !wasComplete,
		redirectTo: '/capture',
		snapshot
	};
}

export async function deleteGroundingProfile(userId: string): Promise<void> {
	await getDb().delete(userGroundingProfile).where(eq(userGroundingProfile.userId, userId));
}
