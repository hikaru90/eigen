/**
 * User context bundle for background enrichment.
 * Never enrich with row text alone — always load who the user is and what they already know.
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { communitySummary } from '$lib/server/db/schema';
import type { LoadedUserOntology } from '$lib/server/ontology-db/load-ontology';
import { loadOntologyForUser, ensureUserOntologySeeded } from '$lib/server/ontology-db';
import {
	loadCategoryDistribution,
	loadRecentThoughtsContext,
	loadUserOntologyProfileRow
} from '$lib/server/ontology/classify-thought-category';
import { ONTOLOGY_RECENT_THOUGHT_WINDOW } from '$lib/server/ontology/constants';
import type { OntologyProfileV2 } from '$lib/server/ontology/types';
import { loadGroundingProfileForEnrichment } from '$lib/server/grounding/profile';
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types';
import {
	loadEntityHintsForThought,
	loadIngestKnownEntityHints
} from '$lib/server/memory/entity-graph-hints';
import type { KnownEntityHint } from '$lib/server/memory/entity-extraction';
import { tokenizeLexicalQuery } from '$lib/server/memory/lexical-fold';

export type EnrichmentCommunityExcerpt = {
	communityId: string;
	level: number;
	summaryText: string;
};

export type EnrichmentContext = {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	rawText: string;
	ontology: LoadedUserOntology;
	profile: OntologyProfileV2;
	groundingProfile: GroundingProfileForEnrichment;
	knownEntities: KnownEntityHint[];
	recentThoughts: Array<{ normalizedText: string; category: string }>;
	categoryDistribution: Map<string, number>;
	communityExcerpts: EnrichmentCommunityExcerpt[];
	completeness: {
		knownEntityCount: number;
		recentThoughtCount: number;
		communitySummaryCount: number;
		hasProfileNotes: boolean;
		hasGroundingProfile: boolean;
	};
};

function buildCommunityLexicalTsQuery(normalizedText: string): string {
	const tokens = tokenizeLexicalQuery(normalizedText)
		.filter((t) => t.length >= 3)
		.slice(0, 12);
	return tokens.join(' | ');
}

async function loadRelevantCommunitySummaries(input: {
	userId: string;
	normalizedText: string;
	limit: number;
}): Promise<EnrichmentCommunityExcerpt[]> {
	const tsQueryString = buildCommunityLexicalTsQuery(input.normalizedText);
	const db = getDb();

	if (tsQueryString.length > 0) {
		const summaryVector = sql`to_tsvector('simple', coalesce(${communitySummary.summaryText}, ''))`;
		const tsQueryExpr = sql`to_tsquery('simple', ${tsQueryString})`;
		const matchExpr = sql<boolean>`${summaryVector} @@ ${tsQueryExpr}`;

		const matched = await db
			.select({
				communityId: communitySummary.communityId,
				level: communitySummary.level,
				summaryText: communitySummary.summaryText
			})
			.from(communitySummary)
			.where(and(eq(communitySummary.userId, input.userId), matchExpr))
			.orderBy(desc(communitySummary.generatedAt))
			.limit(input.limit);

		if (matched.length > 0) return matched;
	}

	const fallback = await db
		.select({
			communityId: communitySummary.communityId,
			level: communitySummary.level,
			summaryText: communitySummary.summaryText
		})
		.from(communitySummary)
		.where(and(eq(communitySummary.userId, input.userId), isNotNull(communitySummary.summaryText)))
		.orderBy(desc(communitySummary.generatedAt))
		.limit(Math.min(3, input.limit));

	return fallback;
}

export async function loadEnrichmentContext(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	rawText: string;
}): Promise<EnrichmentContext> {
	await ensureUserOntologySeeded(getDb(), input.userId);

	const [
		ontology,
		profile,
		groundingProfile,
		textHints,
		graphHints,
		recentThoughts,
		categoryDistribution,
		communityExcerpts
	] = await Promise.all([
			loadOntologyForUser(getDb(), input.userId),
			loadUserOntologyProfileRow(input.userId),
			loadGroundingProfileForEnrichment(input.userId),
			loadIngestKnownEntityHints({ userId: input.userId, normalizedText: input.normalizedText }),
			loadEntityHintsForThought({
				userId: input.userId,
				thoughtId: input.thoughtId,
				normalizedText: input.normalizedText
			}),
			loadRecentThoughtsContext(input.userId, 5),
			loadCategoryDistribution(input.userId, ONTOLOGY_RECENT_THOUGHT_WINDOW),
			loadRelevantCommunitySummaries({
				userId: input.userId,
				normalizedText: input.normalizedText,
				limit: 5
			})
		]);

	const byLabel = new Map<string, KnownEntityHint>();
	for (const hint of [...textHints, ...graphHints]) {
		const key = hint.label.trim().toLowerCase();
		if (!key || byLabel.has(key)) continue;
		byLabel.set(key, hint);
	}
	const knownEntities = [...byLabel.values()];

	const hasProfileNotes =
		(typeof profile.summary === 'string' && profile.summary.trim().length > 0) ||
		(profile.kindGuidance !== undefined && Object.keys(profile.kindGuidance).length > 0);
	const hasGroundingProfile = groundingProfile != null;

	console.info('[enrichment-context] loaded', {
		userId: input.userId.slice(0, 8),
		thoughtId: input.thoughtId,
		knownEntityCount: knownEntities.length,
		recentThoughtCount: recentThoughts.length,
		communitySummaryCount: communityExcerpts.length,
		hasProfileNotes,
		hasGroundingProfile
	});

	return {
		userId: input.userId,
		thoughtId: input.thoughtId,
		normalizedText: input.normalizedText,
		rawText: input.rawText,
		ontology,
		profile,
		groundingProfile,
		knownEntities,
		recentThoughts,
		categoryDistribution,
		communityExcerpts,
		completeness: {
			knownEntityCount: knownEntities.length,
			recentThoughtCount: recentThoughts.length,
			communitySummaryCount: communityExcerpts.length,
			hasProfileNotes,
			hasGroundingProfile
		}
	};
}

export function formatCommunityContextBlock(excerpts: EnrichmentCommunityExcerpt[]): string {
	if (excerpts.length === 0) return '';
	const lines = excerpts.map(
		(c, i) => `${i + 1}. [L${c.level}] ${c.summaryText.slice(0, 400)}${c.summaryText.length > 400 ? '…' : ''}`
	);
	return `\nRelevant memory themes (community summaries):\n${lines.join('\n')}`;
}

export function formatKnownEntitiesBlock(entities: KnownEntityHint[]): string {
	if (entities.length === 0) return '';
	const lines = entities.map((e) => `- ${e.label} (${e.entityType})`);
	return `\nKnown entities for this user:\n${lines.join('\n')}`;
}
