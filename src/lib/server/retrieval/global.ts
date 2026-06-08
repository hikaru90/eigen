/**
 * Global sensemaking retrieval.
 *
 * Answers queries that require understanding across the entire memory corpus —
 * patterns, themes, recurring concerns, broad knowledge about a topic.
 *
 * Architecture (from GraphRAG paper, Edge et al. 2024):
 *   1. Embed the query.
 *   2. Find relevant community summaries via HNSW similarity search.
 *   3. For each community, generate a partial answer (map step).
 *   4. Reduce partial answers into a final global answer.
 *
 * This is separate from `searchThoughts` (which handles local/relational queries)
 * because it retrieves from `community_summary` rows, not `thought` rows.
 *
 * Wired into `composeAnswer` for queries classified as `global` when community
 * summaries exist. See docs/repo-map/retrieval.md § Global retrieval.
 *
 * Cost: N community LLM calls + 1 reduce LLM call + 1 embedding call.
 * Controlled by `topCommunities` (default 5).
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { communitySummary } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { llmChatCompletion } from '$lib/server/llm/llm-client';

export type GlobalSearchResult = {
	answer: string;
	communitiesUsed: number;
	/** Community summaries that contributed to the answer, for provenance. */
	sources: Array<{ communityId: string; level: number; summaryExcerpt: string }>;
};

/** True when nightly consolidation has produced at least one embedded community summary. */
export async function hasCommunitySummaries(userId: string): Promise<boolean> {
	const db = getDb();
	const rows = await db
		.select({ id: communitySummary.id })
		.from(communitySummary)
		.where(
			and(
				eq(communitySummary.userId, userId),
				isNotNull(communitySummary.summaryEmbedding)
			)
		)
		.limit(1);
	return rows.length > 0;
}

export type RelevantCommunitySummary = {
	communityId: string;
	level: number;
	summaryText: string;
};

/**
 * Fetch the community summaries most relevant to a query embedding (HNSW cosine),
 * WITHOUT the map-reduce LLM step. Used as cheap thematic context for blended
 * profile/global answers in `composeAnswer` (no extra embedding or LLM cost).
 */
export async function fetchRelevantCommunitySummaries(params: {
	userId: string;
	queryEmbedding: number[];
	limit?: number;
}): Promise<RelevantCommunitySummary[]> {
	const limit = Math.max(1, Math.min(params.limit ?? 6, 20));
	const vectorLiteral = `[${params.queryEmbedding.join(',')}]`;
	const db = getDb();
	const distanceExpr = sql<number>`${communitySummary.summaryEmbedding} <=> ${vectorLiteral}::vector`;
	const rows = await db
		.select({
			communityId: communitySummary.communityId,
			level: communitySummary.level,
			summaryText: communitySummary.summaryText,
			distance: distanceExpr
		})
		.from(communitySummary)
		.where(
			and(
				eq(communitySummary.userId, params.userId),
				isNotNull(communitySummary.summaryEmbedding)
			)
		)
		.orderBy(distanceExpr)
		.limit(limit);
	return rows.map((r) => ({
		communityId: r.communityId,
		level: r.level,
		summaryText: r.summaryText
	}));
}

/**
 * Generate a global sensemaking answer by querying community summaries.
 *
 * @param userId - Tenant identifier.
 * @param query - Natural language question requiring global understanding.
 * @param topCommunities - How many community summaries to retrieve (default 5).
 * @param preferLevel - Prefer summaries at this hierarchy level (0=root, 2=leaf).
 *   Defaults to 1 (theme level) which balances detail with scope per the paper.
 */
export async function searchGlobal(params: {
	userId: string;
	query: string;
	topCommunities?: number;
	preferLevel?: number;
}): Promise<GlobalSearchResult> {
	const { userId, query } = params;
	const topK = Math.max(1, Math.min(params.topCommunities ?? 5, 20));
	const preferLevel = params.preferLevel ?? 1;

	// Embed the query.
	const queryEmbedding = await createThoughtEmbedding(userId, query);
	const vectorLiteral = `[${queryEmbedding.join(',')}]`;

	const db = getDb();

	// Find most relevant community summaries by cosine similarity.
	const distanceExpr = sql<number>`${communitySummary.summaryEmbedding} <=> ${vectorLiteral}::vector`;

	const candidates = await db
		.select({
			id: communitySummary.id,
			communityId: communitySummary.communityId,
			level: communitySummary.level,
			summaryText: communitySummary.summaryText,
			distance: distanceExpr
		})
		.from(communitySummary)
		.where(
			and(
				eq(communitySummary.userId, userId),
				isNotNull(communitySummary.summaryEmbedding)
			)
		)
		.orderBy(distanceExpr)
		.limit(topK * 2); // fetch more to filter by level preference

	if (candidates.length === 0) {
		return {
			answer: "I don't have enough memory clusters to answer this question yet. Try capturing more thoughts first.",
			communitiesUsed: 0,
			sources: []
		};
	}

	// Prefer the requested level; fall back to whatever is available.
	const preferredCandidates = candidates
		.filter((c) => c.level === preferLevel)
		.slice(0, topK);

	const selected = preferredCandidates.length >= Math.ceil(topK / 2)
		? preferredCandidates
		: candidates.slice(0, topK);

	// Map step: generate a partial answer from each community summary.
	const partialAnswers: Array<{ text: string; helpfulness: number; communityId: string; level: number; excerpt: string }> = [];

	for (const community of selected) {
		try {
			const mapPrompt = [
				`Query: ${query}`,
				'',
				'Memory cluster summary:',
				community.summaryText,
				'',
				'Based ONLY on this summary, provide:',
				'1. A partial answer to the query (or "Not relevant" if this cluster doesn\'t help).',
				'2. A helpfulness score 0-100.',
				'',
				'Respond in JSON: {"answer": "...", "score": 0-100}'
			].join('\n');

			const response = await llmChatCompletion({
				userId,
				messages: [
					{
						role: 'system',
						content: 'You answer queries from personal memory summaries. JSON only.'
					},
					{ role: 'user', content: mapPrompt }
				],
				temperature: 0
			});

			const choices = (response as { choices?: unknown }).choices;
			if (!Array.isArray(choices) || choices.length === 0) continue;
			const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
			if (typeof content !== 'string') continue;

			let parsed: { answer?: string; score?: number };
			try {
				const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
				parsed = JSON.parse(cleaned) as { answer?: string; score?: number };
			} catch {
				continue;
			}

			const score = typeof parsed.score === 'number' ? parsed.score : 0;
			const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';

			if (score > 0 && answer && answer.toLowerCase() !== 'not relevant') {
				partialAnswers.push({
					text: answer,
					helpfulness: score,
					communityId: community.communityId,
					level: community.level,
					excerpt: community.summaryText.slice(0, 200)
				});
			}
		} catch (err) {
			console.warn('[searchGlobal] map step failed for community', {
				communityId: community.communityId,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}

	if (partialAnswers.length === 0) {
		return {
			answer: "I couldn't find relevant memory patterns to answer this question.",
			communitiesUsed: 0,
			sources: []
		};
	}

	// Sort by helpfulness and take the most useful answers.
	const sorted = partialAnswers.sort((a, b) => b.helpfulness - a.helpfulness);
	const toReduce = sorted.slice(0, 8);

	// Reduce step: synthesise partial answers into a final global answer.
	const reducePrompt = [
		`Query: ${query}`,
		'',
		'Partial answers from different memory clusters:',
		toReduce.map((a, i) => `[${i + 1}] ${a.text}`).join('\n\n'),
		'',
		'Synthesise these partial answers into one comprehensive, direct response.',
		'Be specific. If patterns or themes emerge across multiple clusters, highlight them.',
		'If the answers conflict, note the tension.'
	].join('\n');

	let reduceResponse: unknown;
	try {
		reduceResponse = await llmChatCompletion({
			userId,
			messages: [
				{
					role: 'system',
					content: 'You synthesise memory-based insights into clear, honest answers.'
				},
				{ role: 'user', content: reducePrompt }
			],
			temperature: 0.3
		});
	} catch (err) {
		throw new Error(
			`searchGlobal: reduce step failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	const reduceChoices = (reduceResponse as { choices?: unknown }).choices;
	const finalAnswer = Array.isArray(reduceChoices) && reduceChoices.length > 0
		? ((reduceChoices[0] as { message?: { content?: unknown } }).message?.content as string ?? '').trim()
		: partialAnswers[0]!.text;

	return {
		answer: finalAnswer,
		communitiesUsed: toReduce.length,
		sources: toReduce.map((a) => ({
			communityId: a.communityId,
			level: a.level,
			summaryExcerpt: a.excerpt
		}))
	};
}
