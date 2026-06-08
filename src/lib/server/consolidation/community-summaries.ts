/**
 * Community summary generation job.
 *
 * GraphRAG-style bottom-up reports: each community gets a thematic title and
 * summary (not an entity keyword list). Higher levels incorporate child
 * community summaries when available.
 *
 * After generating each summary, embeds the title + short routing text (1536d)
 * for HNSW semantic search. Community summaries are the primary index for
 * global sensemaking queries.
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	graphCommunity,
	communitySummary,
	communityMember,
	canonicalEntity,
	thought
} from '$lib/server/db/schema';
import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { loadCommunityThoughtIds } from './community-bundles';
import {
	COMMUNITY_HIERARCHY_DEPTH,
	COMMUNITY_LEAF_LEVEL,
	COMMUNITY_MID_LEVEL
} from './community-levels';

const SUMMARY_BATCH_SIZE = 20;

export type CommunitySummaryResult = {
	total: number;
	summarized: number;
	generated: number;
	pending: number;
};

export type CommunitySummaryStats = Pick<CommunitySummaryResult, 'total' | 'summarized' | 'pending'>;

export type CommunitySummaryOptions = {
	batchSize?: number;
	shouldCancel?: () => boolean | Promise<boolean>;
};

function toPgVectorLiteral(values: number[]): string {
	return `[${values.join(',')}]`;
}

function dbErrorMessage(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const cause = (err as Error & { cause?: unknown }).cause;
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (err.message.startsWith('Failed query:') && cause) {
		return typeof cause === 'string' ? cause : String(cause);
	}
	return err.message;
}

async function communityStillExists(userId: string, communityId: string): Promise<boolean> {
	const db = getDb();
	const [row] = await db
		.select({ id: graphCommunity.id })
		.from(graphCommunity)
		.where(and(eq(graphCommunity.id, communityId), eq(graphCommunity.userId, userId)))
		.limit(1);
	return Boolean(row);
}

export function formatCommunitySummaryDetail(stats: CommunitySummaryStats): string {
	if (stats.total === 0) return 'no communities';
	const base = `${stats.summarized} of ${stats.total} summarized`;
	if (stats.pending > 0) return `${base}, ${stats.pending} pending`;
	return base;
}

export async function getCommunitySummaryStats(userId: string): Promise<CommunitySummaryStats> {
	const db = getDb();
	const [totalRow] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId));
	const total = totalRow?.n ?? 0;
	if (total === 0) return { total: 0, pending: 0, summarized: 0 };

	const [pendingRow] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(graphCommunity)
		.leftJoin(communitySummary, eq(communitySummary.communityId, graphCommunity.id))
		.where(and(eq(graphCommunity.userId, userId), sql`${communitySummary.communityId} IS NULL`));
	const pending = pendingRow?.n ?? 0;
	return { total, pending, summarized: total - pending };
}

const SUMMARY_SYSTEM = [
	'You write GraphRAG-style community reports for a personal knowledge graph.',
	'Each community is a cluster of related entities and memories discovered by graph structure.',
	'Respond with JSON only: {"title":"...","summary":"..."}',
	'- title: 3–8 word thematic label. Never a comma-separated list of entity names.',
	'- summary: 2–3 concise sentences describing what unifies this cluster thematically.',
	'Write in the same language as the thought samples when present; otherwise English.'
].join(' ');

function summaryTaskForLevel(level: number): string {
	if (level === COMMUNITY_LEAF_LEVEL) {
		return [
			'Leaf cluster (finest granularity).',
			'Describe the concrete topic this tight entity group represents.',
			'Ground the summary in the thought samples; mention key themes, not a name dump.'
		].join(' ');
	}
	if (level === COMMUNITY_MID_LEVEL) {
		return [
			'Domain cluster (mid-level).',
			'Synthesize the child community reports below into one domain-level theme.',
			'Highlight recurring relationships and topics across the sub-clusters.'
		].join(' ');
	}
	return [
		'Root cluster (broadest).',
		'Synthesize the child domain reports into overarching personal themes.',
		'Write the summary in second person (you/your) as interpretive sensemaking.'
	].join(' ');
}

type CommunityContext = {
	communityId: string;
	level: number;
	entityLabels: string[];
	entityTypes: string[];
	relatedThoughts: string[];
	thoughtCount: number;
	childSummaries: string[];
};

async function loadChildCommunitySummaries(
	userId: string,
	communityId: string,
	limit = 8
): Promise<string[]> {
	const db = getDb();
	const rows = await db
		.select({
			title: communitySummary.summaryShort,
			summary: communitySummary.summaryText
		})
		.from(graphCommunity)
		.innerJoin(communitySummary, eq(communitySummary.communityId, graphCommunity.id))
		.where(
			and(
				eq(graphCommunity.userId, userId),
				eq(graphCommunity.parentCommunityId, communityId),
				isNotNull(communitySummary.summaryText)
			)
		)
		.limit(limit);

	return rows
		.map((row) => {
			const title = row.title?.trim();
			const body = row.summary.trim();
			if (title && body) return `${title}: ${body}`;
			return title || body;
		})
		.filter((text) => text.length > 0);
}

async function loadCommunityContext(
	userId: string,
	communityId: string
): Promise<CommunityContext> {
	const db = getDb();

	const members = await db
		.select({
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(communityMember)
		.innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
		.where(
			and(eq(communityMember.communityId, communityId), eq(communityMember.userId, userId))
		)
		.limit(50);

	const [communityRow] = await db
		.select({ level: graphCommunity.level })
		.from(graphCommunity)
		.where(eq(graphCommunity.id, communityId))
		.limit(1);

	const level = communityRow?.level ?? COMMUNITY_LEAF_LEVEL;

	let relatedThoughts: string[] = [];
	let thoughtCount = 0;

	const thoughtIds = await loadCommunityThoughtIds(userId, communityId, 20);
	thoughtCount = thoughtIds.length;

	if (thoughtIds.length > 0) {
		const samples = await db
			.select({ normalizedText: thought.normalizedText })
			.from(thought)
			.where(and(eq(thought.userId, userId), inArray(thought.id, thoughtIds)))
			.limit(8);
		relatedThoughts = samples.map((t) => t.normalizedText.slice(0, 300));
	}

	const childSummaries =
		level < COMMUNITY_LEAF_LEVEL
			? await loadChildCommunitySummaries(userId, communityId)
			: [];

	return {
		communityId,
		level,
		entityLabels: members.map((m) => m.label),
		entityTypes: [...new Set(members.map((m) => m.entityType))],
		relatedThoughts,
		thoughtCount,
		childSummaries
	};
}

function buildSummaryPrompt(ctx: CommunityContext): string {
	const entityList = ctx.entityLabels.slice(0, 12).join(', ');
	const typeList = ctx.entityTypes.join(', ');
	const thoughtSamples = ctx.relatedThoughts
		.map((t, i) => `${i + 1}. ${t}`)
		.join('\n');
	const childBlock =
		ctx.childSummaries.length > 0
			? ['Child community reports:', ...ctx.childSummaries.map((s, i) => `${i + 1}. ${s}`)].join(
					'\n'
				)
			: '';

	return [
		summaryTaskForLevel(ctx.level),
		'',
		`Entity count: ${ctx.entityLabels.length}`,
		entityList ? `Sample entities (context only — do not list in title): ${entityList}` : '',
		typeList ? `Entity types: ${typeList}` : '',
		`Thought count: ${ctx.thoughtCount}`,
		thoughtSamples ? `Thought samples:\n${thoughtSamples}` : '',
		childBlock
	]
		.filter((line) => line.length > 0)
		.join('\n');
}

type ParsedCommunityReport = {
	title: string;
	summary: string;
};

function parseCommunityReport(content: string): ParsedCommunityReport | null {
	const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
	try {
		const parsed = JSON.parse(cleaned) as { title?: unknown; summary?: unknown };
		const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
		const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
		if (!title || !summary) return null;
		return { title: title.slice(0, 120), summary: summary.slice(0, 4000) };
	} catch {
		const trimmed = cleaned.trim();
		if (!trimmed) return null;
		const firstSentence = trimmed.split(/[.!?]/)[0]?.trim() ?? trimmed;
		return {
			title: firstSentence.slice(0, 80),
			summary: trimmed.slice(0, 4000)
		};
	}
}

/**
 * Generate and persist summaries for communities that don't have one yet.
 * Processes communities in batches until none are pending, cancel is requested,
 * or a batch makes no progress.
 */
export async function runCommunitySummaryGeneration(
	userId: string,
	options?: CommunitySummaryOptions
): Promise<CommunitySummaryResult> {
	const batchSize = options?.batchSize ?? SUMMARY_BATCH_SIZE;
	let totalGenerated = 0;
	let last: CommunitySummaryResult = { total: 0, summarized: 0, generated: 0, pending: 0 };

	while (true) {
		if (options?.shouldCancel && (await options.shouldCancel())) break;

		last = await runCommunitySummaryBatch(userId, batchSize);
		totalGenerated += last.generated;

		if (last.pending === 0) break;
		if (last.generated === 0) break;
	}

	return { ...last, generated: totalGenerated };
}

async function runCommunitySummaryBatch(
	userId: string,
	batchSize: number
): Promise<CommunitySummaryResult> {
	const db = getDb();

	const stats = await getCommunitySummaryStats(userId);
	if (stats.total === 0) {
		return { total: 0, summarized: 0, generated: 0, pending: 0 };
	}

	const communities = await db
		.select({ id: graphCommunity.id, level: graphCommunity.level, memberCount: graphCommunity.memberCount })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId))
		.orderBy(sql`${graphCommunity.level} DESC`)
		.limit(batchSize * COMMUNITY_HIERARCHY_DEPTH);

	const existingSummaryIds = await db
		.select({ communityId: communitySummary.communityId })
		.from(communitySummary)
		.where(eq(communitySummary.userId, userId));

	const existingSet = new Set(existingSummaryIds.map((s) => s.communityId));
	const needSummary = communities.filter((c) => !existingSet.has(c.id)).slice(0, batchSize);

	let generated = 0;

	for (const community of needSummary) {
		try {
			const ctx = await loadCommunityContext(userId, community.id);
			const prompt = buildSummaryPrompt(ctx);

			const response = await llmChatCompletion({
				userId,
				messages: [
					{ role: 'system', content: SUMMARY_SYSTEM },
					{ role: 'user', content: prompt }
				],
				temperature: 0,
				maxTokens: 280,
				logContext: 'community_summary'
			});

			const choices = (response as { choices?: unknown }).choices;
			if (!Array.isArray(choices) || choices.length === 0) continue;
			const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
			if (typeof content !== 'string' || !content.trim()) continue;

			const report = parseCommunityReport(content);
			if (!report) continue;

			const summaryShort = report.title.slice(0, 500);
			const summaryText = report.summary;
			const embeddingSource = `${summaryShort}. ${summaryText}`.slice(0, 2000);

			const embedding = await createThoughtEmbedding(userId, embeddingSource);

			if (!(await communityStillExists(userId, community.id))) {
				console.warn('[consolidation.summary] stale community skipped (graph was rebuilt)', {
					communityId: community.id
				});
				continue;
			}

			await db
				.insert(communitySummary)
				.values({
					userId,
					communityId: community.id,
					level: community.level,
					summaryShort,
					summaryText,
					summaryEmbedding: sql`${toPgVectorLiteral(embedding)}::vector`,
					entityCount: ctx.entityLabels.length,
					thoughtCount: ctx.thoughtCount
				})
				.onConflictDoUpdate({
					target: communitySummary.communityId,
					set: {
						summaryShort,
						summaryText,
						summaryEmbedding: sql`${toPgVectorLiteral(embedding)}::vector`,
						entityCount: ctx.entityLabels.length,
						thoughtCount: ctx.thoughtCount,
						generatedAt: sql`now()`
					}
				});

			generated++;
		} catch (err) {
			console.error('[consolidation.summary] failed for community', {
				communityId: community.id,
				message: dbErrorMessage(err)
			});
		}
	}

	const after = await getCommunitySummaryStats(userId);
	return {
		total: after.total,
		summarized: after.summarized,
		generated,
		pending: after.pending
	};
}
