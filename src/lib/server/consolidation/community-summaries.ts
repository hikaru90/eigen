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
	thought,
	thoughtRelation
} from '$lib/server/db/schema';
import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';

const SUMMARY_BATCH_SIZE = 20;

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
		relatedThoughts = matching.slice(0, 8).map((t) => t.normalizedText.slice(0, 200));
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

	if (ctx.level === 3) {
		// Leaf: factual, structural.
		return [
			'Write a factual summary of this memory cluster. Be concise and specific.',
			'List: the key entities, their types, how they relate, and when they appeared.',
			'No interpretation. Facts only.',
			'',
			`Entities (${ctx.entityLabels.length}): ${entityList}`,
			`Types: ${typeList}`,
			`Related thought samples (${ctx.thoughtCount} total):`,
			thoughtSamples || '(none)',
			'',
			'Write the summary in 2-4 sentences.'
		].join('\n');
	}

	if (ctx.level === 1 || ctx.level === 2) {
		// Mid: structural with light interpretation.
		return [
			'Write a structural summary of this memory cluster.',
			'Describe how the entities relate to each other, which relationships are strongest,',
			'and the main topics connecting them. Stay close to the evidence.',
			'',
			`Entities (${ctx.entityLabels.length}): ${entityList}`,
			`Types: ${typeList}`,
			`Related thought samples (${ctx.thoughtCount} total):`,
			thoughtSamples || '(none)',
			'',
			'Write the summary in 3-5 sentences.'
		].join('\n');
	}

	// Root (level 0): interpretive, second person.
	return [
		'Write a personal memory pattern summary for the user. Use second person ("you", "your").',
		'Identify patterns, recurring themes, tensions, unresolved concerns, and relationship dynamics.',
		'Be honest and insightful. Focus on what matters most about this cluster of memories.',
		'',
		`Entities (${ctx.entityLabels.length}): ${entityList}`,
		`Types: ${typeList}`,
		`Related thought samples (${ctx.thoughtCount} total):`,
		thoughtSamples || '(none)',
		'',
		'Write the summary in 4-6 sentences. Be direct and specific.'
	].join('\n');
}

/**
 * Generate and persist summaries for communities that don't have one yet.
 * Processes up to `batchSize` communities per run.
 *
 * Returns the number of summaries generated.
 */
export async function runCommunitySummaryGeneration(
	userId: string,
	batchSize = SUMMARY_BATCH_SIZE
): Promise<number> {
	const db = getDb();

	// Find communities without summaries.
	const communities = await db
		.select({ id: graphCommunity.id, level: graphCommunity.level, memberCount: graphCommunity.memberCount })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId))
		.orderBy(sql`${graphCommunity.level} DESC`) // leaf first, then up
		.limit(batchSize * 4); // fetch more to filter by missing summaries

	if (communities.length === 0) return 0;

	// Filter to communities without summaries.
	const communityIds = communities.map((c) => c.id);
	const existingSummaryIds = await db
		.select({ communityId: communitySummary.communityId })
		.from(communitySummary)
		.where(eq(communitySummary.userId, userId));

	const existingSet = new Set(existingSummaryIds.map((s) => s.communityId));
	const needSummary = communities
		.filter((c) => !existingSet.has(c.id) && c.memberCount >= 2)
		.slice(0, batchSize);

	let generated = 0;

	for (const community of needSummary) {
		try {
			const ctx = await loadCommunityContext(userId, community.id);
			const prompt = buildSummaryPrompt(ctx);

			const response = await llmChatCompletion({
				userId,
				messages: [
					{
						role: 'system',
						content: community.level === 0
							? 'You write insightful personal memory summaries. Be honest, specific, and direct.'
							: 'You write factual memory cluster summaries. Be precise and evidence-based.'
					},
					{ role: 'user', content: prompt }
				],
				temperature: community.level === 0 ? 0.4 : 0
			});

			const choices = (response as { choices?: unknown }).choices;
			if (!Array.isArray(choices) || choices.length === 0) continue;
			const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
			if (typeof content !== 'string' || !content.trim()) continue;

			const summaryText = content.trim().slice(0, 4000);

			// Embed the summary.
			const embedding = await createThoughtEmbedding(userId, summaryText);

			// Upsert summary.
			await db
				.insert(communitySummary)
				.values({
					userId,
					communityId: community.id,
					level: community.level,
					summaryText,
					summaryEmbedding: sql`${`[${embedding.join(',')}]`}::vector`,
					entityCount: ctx.entityLabels.length,
					thoughtCount: ctx.thoughtCount
				})
				.onConflictDoUpdate({
					target: communitySummary.communityId,
					set: {
						summaryText,
						summaryEmbedding: sql`EXCLUDED.summary_embedding`,
						entityCount: ctx.entityLabels.length,
						thoughtCount: ctx.thoughtCount,
						generatedAt: new Date()
					}
				});

			generated++;
		} catch (err) {
			console.error('[consolidation.summary] failed for community', {
				communityId: community.id,
				message: err instanceof Error ? err.message : String(err)
			});
			// Continue with next community.
		}
	}

	return generated;
}
