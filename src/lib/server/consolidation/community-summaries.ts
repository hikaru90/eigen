/**
 * Community summary generation job.
 *
 * For each community without an up-to-date summary, generates an LLM summary
 * tailored to its level in the hierarchy:
 *
 *   L3 (leaf, level=3): Factual — entity names, co-occurrence counts, date ranges.
 *   L1-L2 (mid, level=1-2): Structural — relationship frequency and patterns.
 *   L0 (root, level=0): Interpretive — personal patterns, written in 2nd person.
 *
 * After generating each summary, embeds it (1536d vector) for HNSW semantic search.
 * Community summaries are the primary index for global sensemaking queries.
 *
 * Cost note: summary generation is one LLM chat call + one embedding call per
 * community. Run only for communities that changed since last generation
 * (checked via community.updatedAt > summary.generatedAt).
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
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
		.where(and(eq(graphCommunity.userId, userId), isNull(communitySummary.communityId)));
	const pending = pendingRow?.n ?? 0;
	return { total, pending, summarized: total - pending };
}

const SUMMARY_SYSTEM =
	'You summarize clusters of related memories for semantic search. Be concise and factual. Output only the summary text — no preamble, labels, or markdown.';

function summaryTaskForLevel(level: number): string {
	if (level === 3) {
		return 'Summarize this leaf cluster: key entities, types, and factual themes. Up to 2 short sentences.';
	}
	if (level === 1 || level === 2) {
		return 'Summarize this mid-level cluster: main topics, strongest entity ties, and recurring links. Up to 3 short sentences.';
	}
	return 'Summarize this root cluster: overarching themes and patterns across these thoughts, in second person (you/your). Up to 3 short sentences.';
}

type CommunityContext = {
	communityId: string;
	level: number;
	entityLabels: string[];
	entityTypes: string[];
	relatedThoughts: string[];
	thoughtCount: number;
};

async function loadCommunityContext(
	userId: string,
	communityId: string
): Promise<CommunityContext> {
	const db = getDb();

	// Load member entities.
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

	// Load a sample of thoughts that mention at least one member entity.
	const memberEntityIds = await db
		.select({ id: canonicalEntity.id })
		.from(communityMember)
		.innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
		.where(
			and(eq(communityMember.communityId, communityId), eq(communityMember.userId, userId))
		)
		.limit(20);

	const [communityRow] = await db
		.select({ level: graphCommunity.level })
		.from(graphCommunity)
		.where(eq(graphCommunity.id, communityId))
		.limit(1);

	let relatedThoughts: string[] = [];
	let thoughtCount = 0;

	if (memberEntityIds.length > 0) {
		const entityIds = memberEntityIds.map((e) => e.id);

		// Use raw SQL to find thoughts mentioning these entities via thought.metadata
		// (entity references are stored there) or via thought text matching.
		// Simple approach: get thoughts that have category/text related to entity labels.
		const memberLabels = members.map((m) => m.label.toLowerCase());
		const allThoughts = await db
			.select({ normalizedText: thought.normalizedText, createdAt: thought.createdAt })
			.from(thought)
			.where(eq(thought.userId, userId))
			.orderBy(sql`${thought.createdAt} DESC`)
			.limit(200);

		// Filter thoughts that mention at least one entity label.
		const matching = allThoughts.filter((t) =>
			memberLabels.some((label) => t.normalizedText.toLowerCase().includes(label))
		);

		thoughtCount = matching.length;
		const seen = new Set<string>();
		relatedThoughts = matching
			.filter((t) => {
				const key = t.normalizedText.toLowerCase();
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, 5)
			.map((t) => t.normalizedText.slice(0, 200));
	}

	return {
		communityId,
		level: communityRow?.level ?? 3,
		entityLabels: members.map((m) => m.label),
		entityTypes: [...new Set(members.map((m) => m.entityType))],
		relatedThoughts,
		thoughtCount
	};
}

function buildSummaryPrompt(ctx: CommunityContext): string {
	const entityList = ctx.entityLabels.slice(0, 20).join(', ');
	const typeList = ctx.entityTypes.join(', ');
	const thoughtSamples = ctx.relatedThoughts
		.map((t, i) => `${i + 1}. ${t}`)
		.join('\n');

	return [
		summaryTaskForLevel(ctx.level),
		'',
		`Entities (${ctx.entityLabels.length}): ${entityList || 'none'}`,
		`Types: ${typeList || 'none'}`,
		`Thought samples (${ctx.thoughtCount} total):`,
		thoughtSamples || '(none)'
	].join('\n');
}

/**
 * Generate and persist summaries for communities that don't have one yet.
 * Processes communities in batches until none are pending, cancel is requested,
 * or a batch makes no progress.
 *
 * Returns generation stats for UI reporting.
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

	// Find communities without summaries (batch window for LLM work).
	const communities = await db
		.select({ id: graphCommunity.id, level: graphCommunity.level, memberCount: graphCommunity.memberCount })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId))
		.orderBy(sql`${graphCommunity.level} DESC`) // leaf first, then up
		.limit(batchSize * 4);

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
				maxTokens: 120,
				logContext: 'community_summary'
			});

			const choices = (response as { choices?: unknown }).choices;
			if (!Array.isArray(choices) || choices.length === 0) continue;
			const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
			if (typeof content !== 'string' || !content.trim()) continue;

			const summaryText = content.trim().slice(0, 4000);

			// Embed the summary.
			const embedding = await createThoughtEmbedding(userId, summaryText);

			if (!(await communityStillExists(userId, community.id))) {
				console.warn('[consolidation.summary] stale community skipped (graph was rebuilt)', {
					communityId: community.id
				});
				continue;
			}

			// Upsert summary.
			await db
				.insert(communitySummary)
				.values({
					userId,
					communityId: community.id,
					level: community.level,
					summaryText,
					summaryEmbedding: sql`${toPgVectorLiteral(embedding)}::vector`,
					entityCount: ctx.entityLabels.length,
					thoughtCount: ctx.thoughtCount
				})
				.onConflictDoUpdate({
					target: communitySummary.communityId,
					set: {
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
			// Continue with next community.
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
