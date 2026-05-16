/**
 * Phase: layer-checks
 *
 * Evaluates per-layer ingest quality against the golden subset of the corpus:
 *   1. Entity extraction  — Precision / Recall / F1 vs human-labeled expected.entities
 *   2. Relation extraction — Precision / Recall / F1 vs human-labeled expected.relations
 *   3. Embedding similarity — pairwise cosine similarity matrix over all golden thoughts
 *   4. Community detection — entity count, community structure post-detection
 *
 * Consumes an already-seeded corpus via the manifest (seed-corpus must have run).
 * All analysis uses the EVAL_CORPUS_USER_ID thoughts already in the DB.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
	thought,
	thoughtRelation,
	canonicalEntity,
	entityResolutionLog,
	graphCommunity,
	communityMember
} from '$lib/server/db/brain.schema';
import { runCommunityDetection } from '$lib/server/consolidation/community-detection';
import { fetchGraphVisualizationSnapshot } from '$lib/server/graph/falkor';
import { logEval, withEvalDb } from '../eval-context';
import { EVAL_CORPUS_USER_ID } from '../seed-corpus';
import { loadGoldenThoughts, type SeedManifest } from '../dataset';
import type { GraphVizNode, GraphVizEdge } from '$lib/server/graph/falkor';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntityMetrics = {
	totalExpected: number;
	totalExtracted: number;
	truePositives: number;
	precision: number;
	recall: number;
	f1: number;
};

export type RelationMetrics = {
	totalExpected: number;
	totalExtracted: number;
	correct: number;
	precision: number;
	recall: number;
	f1: number;
};

export type EmbeddingMetrics = {
	avgSimilarity: number;
	minSimilarity: number;
	maxSimilarity: number;
};

export type CommunityMetrics = {
	entityCount: number;
	totalCommunities: number;
	communitiesByLevel: { L0: number; L1: number; L2: number; L3: number };
	avgCommunitySize: number;
};

export type LayerChecksResult = {
	thoughtCount: number;
	entities: {
		summary: EntityMetrics;
		falsePositives: Array<{ thoughtId: string; text: string; extracted: string; extractedType: string }>;
		falseNegatives: Array<{ thoughtId: string; text: string; expected: string; expectedType: string }>;
		perThought: Array<{
			evalId: string;
			rawText: string;
			precision: number;
			recall: number;
			f1: number;
			extractedCount: number;
			expectedCount: number;
			extracted: Array<{ surface: string; type: string }>;
			expected: Array<{ surface: string; type: string }>;
		}>;
	};
	relations: {
		summary: RelationMetrics;
		falsePositives: Array<{
			sourceId: string;
			sourceText: string;
			targetText: string;
			relationType: string;
		}>;
		falseNegatives: Array<{
			sourceId: string;
			sourceText: string;
			expectedTarget: string;
			expectedType: string;
		}>;
		perThought: Array<{
			evalId: string;
			rawText: string;
			extractedCount: number;
			expectedCount: number;
			extracted: Array<{ target: string | undefined; type: string }>;
			expected: Array<{ target: string; type: string }>;
		}>;
	};
	embedding: {
		metrics: EmbeddingMetrics;
		similarityMatrix: Record<string, Record<string, number>>;
		neighbors: Record<string, Array<{ id: string; similarity: number }>>;
	};
	communities: CommunityMetrics & {
		communities: Array<{
			id: string;
			level: number;
			memberCount: number;
			members: Array<{ entityId: string; canonicalKey: string; entityType: string }>;
		}>;
	};
	graphSnapshot: { nodes: GraphVizNode[]; edges: GraphVizEdge[] };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeStr(str: string): string {
	return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

function parseVector(vectorStr: string): number[] {
	return vectorStr
		.replace('[', '')
		.replace(']', '')
		.split(',')
		.map((s) => parseFloat(s.trim()))
		.filter((n) => !isNaN(n));
}

// ── Enrichment poll ───────────────────────────────────────────────────────────

async function pollEnrichment(
	db: Parameters<Parameters<typeof withEvalDb>[1]>[0],
	userId: string,
	thoughtIds: string[],
	timeoutMs = 60_000
): Promise<void> {
	const POLL_INTERVAL_MS = 1000;
	const pollStart = Date.now();

	while (true) {
		const elapsed = Date.now() - pollStart;
		const counts = await Promise.all(
			thoughtIds.map((id) =>
				db
					.select({ id: entityResolutionLog.id })
					.from(entityResolutionLog)
					.where(
						and(
							eq(entityResolutionLog.userId, userId),
							eq(entityResolutionLog.thoughtId, id)
						)
					)
					.limit(1)
					.then((rows) => rows.length)
			)
		);
		const ready = counts.filter((c) => c > 0).length;
		logEval(
			`enrichment poll: ${ready}/${thoughtIds.length} thoughts have entities (${elapsed}ms elapsed)`
		);
		if (ready === thoughtIds.length) {
			logEval('all golden thoughts enriched');
			break;
		}
		if (elapsed >= timeoutMs) {
			const missing = thoughtIds.filter((_, i) => counts[i] === 0);
			throw new Error(
				`[eval] enrichment timeout after ${timeoutMs}ms — ${missing.length} thought(s) never received entities: ${missing.join(', ')}`
			);
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
}

// ── Main phase function ───────────────────────────────────────────────────────

export async function runLayerChecks(manifest: SeedManifest): Promise<LayerChecksResult> {
	logEval('layer-checks phase start');

	const goldenThoughts = loadGoldenThoughts();
	logEval(`golden thoughts: ${goldenThoughts.length}`);

	if (goldenThoughts.length === 0) {
		throw new Error('[eval] no golden thoughts found in corpus — mark thoughts with golden: true');
	}

	// Resolve golden evalIds → UUIDs
	const goldenItems = goldenThoughts.map((t) => {
		const uuid = manifest[t.id];
		if (!uuid) {
			throw new Error(
				`[eval] layer-checks: no manifest entry for golden thought ${t.id}. ` +
					`Run in full mode to re-seed.`
			);
		}
		return { evalId: t.id, uuid, rawText: t.rawText, expected: t.expected! };
	});

	const thoughtIds = goldenItems.map((g) => g.uuid);
	const evalIdToUuid = new Map(goldenItems.map((g) => [g.evalId, g.uuid]));
	const uuidToEvalId = new Map(goldenItems.map((g) => [g.uuid, g.evalId]));

	return await withEvalDb(EVAL_CORPUS_USER_ID, async (db) => {
		// Wait for enrichment to be complete for all golden thoughts
		logEval('waiting for enrichment on golden thoughts...');
		await pollEnrichment(db, EVAL_CORPUS_USER_ID, thoughtIds);

		// ── Entity extraction ───────────────────────────────────────────────────
		logEval('evaluating entity extraction...');

		let totalExpectedEntities = 0;
		let totalExtractedEntities = 0;
		let entityTruePositives = 0;
		const entityFalsePositives: LayerChecksResult['entities']['falsePositives'] = [];
		const entityFalseNegatives: LayerChecksResult['entities']['falseNegatives'] = [];
		const entityPerThought: LayerChecksResult['entities']['perThought'] = [];

		for (const { evalId, uuid, rawText, expected } of goldenItems) {
			const resolutions = await db
				.select({
					surface: entityResolutionLog.mentionSurface,
					entityType: canonicalEntity.entityType
				})
				.from(entityResolutionLog)
				.innerJoin(canonicalEntity, eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id))
				.where(
					and(
						eq(entityResolutionLog.userId, EVAL_CORPUS_USER_ID),
						eq(entityResolutionLog.thoughtId, uuid)
					)
				);

			const extracted = resolutions.map((m) => ({
				surface: m.surface,
				entityType: m.entityType,
				normalized: normalizeStr(m.surface)
			}));

			const expectedEntities = expected.entities.map((e) => ({
				surface: e.surface,
				entityType: e.entity_type,
				normalized: normalizeStr(e.surface)
			}));

			const expectedNorms = new Set(expectedEntities.map((e) => e.normalized));
			const extractedNorms = new Set(extracted.map((e) => e.normalized));

			let tp = 0;
			let fp = 0;
			let fn = 0;

			for (const ext of extracted) {
				if (expectedNorms.has(ext.normalized)) {
					const exp = expectedEntities.find((e) => e.normalized === ext.normalized)!;
					if (ext.entityType === exp.entityType) {
						tp++;
					} else {
						// Partial credit: surface matches but type differs
						tp += 0.5;
						fp += 0.5;
					}
				} else {
					fp++;
					entityFalsePositives.push({
						thoughtId: evalId,
						text: rawText.slice(0, 60),
						extracted: ext.surface,
						extractedType: ext.entityType
					});
				}
			}

			for (const exp of expectedEntities) {
				if (!extractedNorms.has(exp.normalized)) {
					fn++;
					entityFalseNegatives.push({
						thoughtId: evalId,
						text: rawText.slice(0, 60),
						expected: exp.surface,
						expectedType: exp.entityType
					});
				}
			}

			totalExpectedEntities += expectedEntities.length;
			totalExtractedEntities += extracted.length;
			entityTruePositives += tp;

			const p = tp + fp > 0 ? tp / (tp + fp) : 0;
			const r = tp + fn > 0 ? tp / (tp + fn) : 0;
			const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;

			entityPerThought.push({
				evalId,
				rawText: rawText.slice(0, 80),
				precision: p,
				recall: r,
				f1,
				extractedCount: extracted.length,
				expectedCount: expectedEntities.length,
				extracted: extracted.map((e) => ({ surface: e.surface, type: e.entityType })),
				expected: expectedEntities.map((e) => ({ surface: e.surface, type: e.entityType }))
			});
		}

		const entityPrecision =
			totalExtractedEntities > 0 ? entityTruePositives / totalExtractedEntities : 0;
		const entityRecall =
			totalExpectedEntities > 0 ? entityTruePositives / totalExpectedEntities : 0;
		const entityF1 =
			entityPrecision + entityRecall > 0
				? (2 * entityPrecision * entityRecall) / (entityPrecision + entityRecall)
				: 0;

		logEval(
			`entities: P=${entityPrecision.toFixed(3)} R=${entityRecall.toFixed(3)} F1=${entityF1.toFixed(3)}`
		);

		// ── Relation extraction ─────────────────────────────────────────────────
		logEval('evaluating relation extraction...');

		let totalExpectedRelations = 0;
		let totalExtractedRelations = 0;
		let relationCorrect = 0;
		const relationFalsePositives: LayerChecksResult['relations']['falsePositives'] = [];
		const relationFalseNegatives: LayerChecksResult['relations']['falseNegatives'] = [];
		const relationPerThought: LayerChecksResult['relations']['perThought'] = [];

		for (const { evalId, uuid, rawText, expected } of goldenItems) {
			const relations = await db
				.select({
					targetId: thoughtRelation.targetThoughtId,
					relationType: thoughtRelation.relationType
				})
				.from(thoughtRelation)
				.where(
					and(
						eq(thoughtRelation.userId, EVAL_CORPUS_USER_ID),
						eq(thoughtRelation.sourceThoughtId, uuid)
					)
				);

			const extractedRels = relations.map((rel) => {
				const targetEvalId = uuidToEvalId.get(rel.targetId);
				return {
					targetId: rel.targetId,
					targetEvalId,
					relationType: rel.relationType
				};
			});

			const expectedRels = expected.relations.map((r) => ({
				targetEvalId: r.target_id,
				targetId: evalIdToUuid.get(r.target_id),
				relationType: r.type
			}));

			const expectedSet = new Set(
				expectedRels.map((r) => `${r.targetEvalId}:${r.relationType}`)
			);
			const extractedSet = new Set(
				extractedRels.map((r) => `${r.targetEvalId}:${r.relationType}`)
			);

			for (const rel of extractedRels) {
				const key = `${rel.targetEvalId}:${rel.relationType}`;
				if (expectedSet.has(key)) {
					relationCorrect++;
				} else {
					// Only count as FP if the target is another golden thought
					if (rel.targetEvalId) {
						relationFalsePositives.push({
							sourceId: evalId,
							sourceText: rawText.slice(0, 60),
							targetText: rel.targetEvalId,
							relationType: rel.relationType
						});
					}
				}
			}

			for (const rel of expectedRels) {
				const key = `${rel.targetEvalId}:${rel.relationType}`;
				if (!extractedSet.has(key)) {
					relationFalseNegatives.push({
						sourceId: evalId,
						sourceText: rawText.slice(0, 60),
						expectedTarget: rel.targetEvalId,
						expectedType: rel.relationType
					});
				}
			}

			totalExpectedRelations += expectedRels.length;
			totalExtractedRelations += extractedRels.length;

			relationPerThought.push({
				evalId,
				rawText: rawText.slice(0, 80),
				extractedCount: extractedRels.length,
				expectedCount: expectedRels.length,
				extracted: extractedRels.map((r) => ({
					target: r.targetEvalId,
					type: r.relationType
				})),
				expected: expectedRels.map((r) => ({
					target: r.targetEvalId,
					type: r.relationType
				}))
			});
		}

		const relationPrecision =
			totalExtractedRelations > 0 ? relationCorrect / totalExtractedRelations : 0;
		const relationRecall =
			totalExpectedRelations > 0 ? relationCorrect / totalExpectedRelations : 0;
		const relationF1 =
			relationPrecision + relationRecall > 0
				? (2 * relationPrecision * relationRecall) / (relationPrecision + relationRecall)
				: 0;

		logEval(
			`relations: P=${relationPrecision.toFixed(3)} R=${relationRecall.toFixed(3)} F1=${relationF1.toFixed(3)}`
		);

		// ── Embedding similarity ────────────────────────────────────────────────
		logEval('computing embedding similarity matrix...');

		const embeddings: Array<{ evalId: string; embedding: number[] }> = [];
		for (const { evalId, uuid } of goldenItems) {
			const [row] = await db
				.select({ embedding: sql<string>`embedding::text` })
				.from(thought)
				.where(eq(thought.id, uuid));

			const embedding = parseVector(row?.embedding ?? '[]');
			embeddings.push({ evalId, embedding });
		}

		const simMatrix: Record<string, Record<string, number>> = {};
		for (const a of embeddings) {
			simMatrix[a.evalId] = {};
			for (const b of embeddings) {
				simMatrix[a.evalId][b.evalId] =
					a.evalId === b.evalId ? 1.0 : cosineSimilarity(a.embedding, b.embedding);
			}
		}

		const neighbors: Record<string, Array<{ id: string; similarity: number }>> = {};
		for (const id of Object.keys(simMatrix)) {
			neighbors[id] = Object.entries(simMatrix[id])
				.filter(([k]) => k !== id)
				.map(([k, v]) => ({ id: k, similarity: v }))
				.sort((a, b) => b.similarity - a.similarity)
				.slice(0, 3);
		}

		const similarities: number[] = [];
		const ids = embeddings.map((e) => e.evalId);
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				similarities.push(simMatrix[ids[i]][ids[j]]);
			}
		}

		const embeddingMetrics: EmbeddingMetrics = {
			avgSimilarity: similarities.length > 0
				? similarities.reduce((a, b) => a + b, 0) / similarities.length
				: 0,
			minSimilarity: similarities.length > 0 ? Math.min(...similarities) : 0,
			maxSimilarity: similarities.length > 0 ? Math.max(...similarities) : 0
		};

		logEval(
			`embedding: avg=${embeddingMetrics.avgSimilarity.toFixed(3)} ` +
				`min=${embeddingMetrics.minSimilarity.toFixed(3)} ` +
				`max=${embeddingMetrics.maxSimilarity.toFixed(3)}`
		);

		// ── Community detection ─────────────────────────────────────────────────
		logEval('running community detection...');

		const detectionResult = await runCommunityDetection(EVAL_CORPUS_USER_ID);
		logEval(
			`community detection: ${detectionResult.totalCommunities} communities from ${detectionResult.entityCount} entities`
		);

		const communities = await db
			.select({ id: graphCommunity.id, level: graphCommunity.level, memberCount: graphCommunity.memberCount })
			.from(graphCommunity)
			.where(eq(graphCommunity.userId, EVAL_CORPUS_USER_ID));

		const communityData: LayerChecksResult['communities']['communities'] = [];
		for (const comm of communities) {
			const members = await db
				.select({
					entityId: communityMember.canonicalEntityId,
					canonicalKey: canonicalEntity.canonicalKey,
					entityType: canonicalEntity.entityType
				})
				.from(communityMember)
				.innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
				.where(
					and(
						eq(communityMember.userId, EVAL_CORPUS_USER_ID),
						eq(communityMember.communityId, comm.id)
					)
				);
			communityData.push({
				id: comm.id,
				level: comm.level,
				memberCount: comm.memberCount,
				members: members.map((m) => ({
					entityId: m.entityId,
					canonicalKey: m.canonicalKey,
					entityType: m.entityType
				}))
			});
		}

		const byLevel: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
		for (const c of communityData) {
			byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
		}

		// ── Graph snapshot ──────────────────────────────────────────────────────
		let graphSnapshot: { nodes: GraphVizNode[]; edges: GraphVizEdge[] } = { nodes: [], edges: [] };
		try {
			graphSnapshot = await fetchGraphVisualizationSnapshot({ userId: EVAL_CORPUS_USER_ID });
			logEval(
				`graph snapshot: ${graphSnapshot.nodes.length} nodes, ${graphSnapshot.edges.length} edges`
			);
		} catch (err) {
			logEval(
				`graph snapshot failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
			);
		}

		logEval('layer-checks phase complete');

		return {
			thoughtCount: goldenItems.length,
			entities: {
				summary: {
					totalExpected: totalExpectedEntities,
					totalExtracted: totalExtractedEntities,
					truePositives: entityTruePositives,
					precision: entityPrecision,
					recall: entityRecall,
					f1: entityF1
				},
				falsePositives: entityFalsePositives.slice(0, 20),
				falseNegatives: entityFalseNegatives.slice(0, 20),
				perThought: entityPerThought
			},
			relations: {
				summary: {
					totalExpected: totalExpectedRelations,
					totalExtracted: totalExtractedRelations,
					correct: relationCorrect,
					precision: relationPrecision,
					recall: relationRecall,
					f1: relationF1
				},
				falsePositives: relationFalsePositives.slice(0, 20),
				falseNegatives: relationFalseNegatives.slice(0, 20),
				perThought: relationPerThought
			},
			embedding: {
				metrics: embeddingMetrics,
				similarityMatrix: simMatrix,
				neighbors
			},
			communities: {
				entityCount: detectionResult.entityCount,
				totalCommunities: detectionResult.totalCommunities,
				communitiesByLevel: {
					L0: byLevel[0] ?? 0,
					L1: byLevel[1] ?? 0,
					L2: byLevel[2] ?? 0,
					L3: byLevel[3] ?? 0
				},
				avgCommunitySize:
					detectionResult.totalCommunities > 0
						? detectionResult.entityCount / detectionResult.totalCommunities
						: 0,
				communities: communityData
			},
			graphSnapshot
		};
	});
}
