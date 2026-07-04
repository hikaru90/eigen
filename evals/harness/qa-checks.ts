import { and, eq } from 'drizzle-orm';
import {
	entityResolutionLog,
	temporalEvent,
	thought,
	thoughtRelation,
	userOntology
} from '$lib/server/db/brain.schema';
import type { AppDatabase } from '$lib/server/db';
import { thoughtExistsInGraph } from '$lib/server/graph/age';
import { loadOntologyForUser } from '$lib/server/ontology-db';
import { parseOntologyProfileJson } from '$lib/server/ontology/types';
import { isPersistedMemoryTypeValid } from '$lib/server/memory/memory-type-catalog';
import type { EvalQaRecord } from '../../src/lib/eval/qa-store';

const DEFAULT_EMBEDDING_DIM = 1536;

export function normalizeChecks(raw: unknown): QaChecks {
	if (!raw || typeof raw !== 'object') return {};
	return raw as QaChecks;
}

/** Baseline structural checks when none configured. */
export function defaultChecksForQa(qa: EvalQaRecord): QaChecks {
	const fixtures = qa.captures.map((c) => c.fixtureId);
	return {
		graph: { requireThoughtNodes: fixtures },
		embedding: { requireVector: fixtures, minLexicalLength: 3, expectedDimensions: DEFAULT_EMBEDDING_DIM },
		ontology: { requireActiveCategories: fixtures },
		extraction: { requireEnriched: fixtures, requireValidMemoryType: fixtures },
		entities: fixtures.map((fixtureId) => ({ fixtureId, minCount: 0 }))
	};
}

export function resolveChecks(qa: EvalQaRecord): QaChecks {
	const explicit = qa.checks;
	if (explicit && Object.keys(explicit).length > 0) {
		return explicit;
	}
	return defaultChecksForQa(qa);
}

/**
 * Structural checks before an edit step: post-edit surface needles (e.g. pecan) are
 * evaluated against the pre-edit capture text, so map them to the prior fact (walnut).
 */
export function checksBeforeEdit(qa: EvalQaRecord): QaChecks {
	const checks = resolveChecks(qa);
	if (!qa.edit) return checks;
	if (!checks.entities?.length) return checks;
	return {
		...checks,
		entities: checks.entities.map((entityCheck) => ({
			...entityCheck,
			surfacesContaining: entityCheck.surfacesContaining?.map((needle) =>
				needle.toLowerCase() === 'pecan' ? 'walnut' : needle
			)
		}))
	};
}

/** Entity/graph checks that must hold after the edit step (e.g. pecan allergy surfaces). */
export function checksAfterEdit(qa: EvalQaRecord): QaChecks | null {
	if (!qa.edit) return null;
	const checks = resolveChecks(qa);
	const postEditEntities = checks.entities?.filter((entityCheck) =>
		entityCheck.surfacesContaining?.some((needle) => needle.toLowerCase() === 'pecan')
	);
	if (!postEditEntities?.length) return null;
	return {
		graph: checks.graph,
		entities: postEditEntities
	};
}

function assertResult(
	id: string,
	label: string,
	passed: boolean,
	evidence: string,
	meta?: { fixtureId?: string; thoughtPreview?: string }
): CheckAssertionResult {
	return { id, label, passed, evidence, ...meta };
}

async function loadThoughtPreview(
	db: AppDatabase,
	userId: string,
	thoughtId: string
): Promise<string> {
	const [row] = await db
		.select({ normalizedText: thought.normalizedText, rawText: thought.rawText })
		.from(thought)
		.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)));
	const text = (row?.normalizedText ?? row?.rawText ?? '').trim();
	if (text.length <= 160) return text;
	return `${text.slice(0, 157)}…`;
}

export async function runStructuralChecks(input: {
	db: AppDatabase;
	userId: string;
	fixtureToUuid: Map<string, string>;
	checks: QaChecks;
}): Promise<CheckEntryResult> {
	const { db, userId, fixtureToUuid, checks } = input;
	const assertions: CheckAssertionResult[] = [];

	const loadedOntology = await loadOntologyForUser(db, userId);
	const activeCategoryKeys = new Set(
		loadedOntology.entityKinds.filter((k) => k.active).map((k) => k.key)
	);

	for (const fixtureId of checks.graph?.requireThoughtNodes ?? []) {
		const thoughtId = fixtureToUuid.get(fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`graph_${fixtureId}`,
					'Linked in knowledge graph',
					false,
					'This thought was not captured in this run.',
					{ fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const exists = await thoughtExistsInGraph(userId, thoughtId);
		assertions.push(
			assertResult(
				`graph_${fixtureId}`,
				'Linked in knowledge graph',
				exists,
				exists
					? 'This thought appears in the relationship graph.'
					: 'This thought is missing from the relationship graph.',
				{ fixtureId, thoughtPreview: preview }
			)
		);
	}

	for (const rel of checks.relations ?? []) {
		const sourceId = fixtureToUuid.get(rel.sourceFixtureId);
		const targetId = fixtureToUuid.get(rel.targetFixtureId);
		if (!sourceId || !targetId) {
			assertions.push(
				assertResult(
					`rel_${rel.sourceFixtureId}_${rel.targetFixtureId}`,
					'Thoughts connected to each other',
					false,
					'One or both thoughts were not captured in this run.'
				)
			);
			continue;
		}
		const rows = await db
			.select({ relationType: thoughtRelation.relationType })
			.from(thoughtRelation)
			.where(
				and(
					eq(thoughtRelation.userId, userId),
					eq(thoughtRelation.sourceThoughtId, sourceId),
					eq(thoughtRelation.targetThoughtId, targetId)
				)
			);
		const reverseRows =
			rows.length > 0
				? []
				: await db
						.select({ relationType: thoughtRelation.relationType })
						.from(thoughtRelation)
						.where(
							and(
								eq(thoughtRelation.userId, userId),
								eq(thoughtRelation.sourceThoughtId, targetId),
								eq(thoughtRelation.targetThoughtId, sourceId)
							)
						);
		const linkedRows = [...rows, ...reverseRows];
		const typeNeedle = rel.typeIncludes?.toLowerCase();
		const typeOk =
			!typeNeedle ||
			linkedRows.some((r) => {
				const relation = r.relationType.toLowerCase();
				if (relation.includes(typeNeedle)) return true;
				// Contradiction pairs are often stored as `contradicts`, not `related_to`.
				return typeNeedle.includes('related') && relation.includes('contradict');
			});
		const passed = linkedRows.length > 0 && typeOk;
		const sourcePreview = await loadThoughtPreview(db, userId, sourceId);
		const targetPreview = await loadThoughtPreview(db, userId, targetId);
		assertions.push(
			assertResult(
				`rel_${rel.sourceFixtureId}_${rel.targetFixtureId}`,
				'Thoughts connected to each other',
				passed,
				passed
					? `Connection found: ${linkedRows.map((r) => r.relationType).join(', ')}.`
					: 'No connection found between these two thoughts.',
				{
					thoughtPreview: [sourcePreview, targetPreview].filter(Boolean).join(' → ')
				}
			)
		);
	}

	for (const temporalCheck of checks.temporal ?? []) {
		const thoughtId = fixtureToUuid.get(temporalCheck.fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`temporal_${temporalCheck.fixtureId}`,
					'Dates and deadlines captured',
					false,
					'This thought was not captured in this run.',
					{ fixtureId: temporalCheck.fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const rows = await db
			.select({ kind: temporalEvent.kind, semanticSummary: temporalEvent.semanticSummary })
			.from(temporalEvent)
			.where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, thoughtId)));
		const min = temporalCheck.minCount ?? 1;
		const kindsOk =
			!temporalCheck.kinds?.length ||
			rows.some((r) => temporalCheck.kinds!.includes(r.kind));
		const passed = rows.length >= min && kindsOk;
		const summary = rows.map((r) => `${r.kind}: ${r.semanticSummary}`).join('; ') || 'none';
		assertions.push(
			assertResult(
				`temporal_${temporalCheck.fixtureId}`,
				'Dates and deadlines captured',
				passed,
				passed
					? `Found ${rows.length} temporal event(s): ${summary}.`
					: `Expected at least ${min} temporal event(s); found ${rows.length}.`,
				{ fixtureId: temporalCheck.fixtureId, thoughtPreview: preview }
			)
		);
	}

	for (const entityCheck of checks.entities ?? []) {
		const thoughtId = fixtureToUuid.get(entityCheck.fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`entities_${entityCheck.fixtureId}`,
					'People, places, and things mentioned',
					false,
					'This thought was not captured in this run.',
					{ fixtureId: entityCheck.fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const logs = await db
			.select({ mentionSurface: entityResolutionLog.mentionSurface })
			.from(entityResolutionLog)
			.where(
				and(eq(entityResolutionLog.userId, userId), eq(entityResolutionLog.thoughtId, thoughtId))
			);
		const count = logs.length;
		const min = entityCheck.minCount ?? 0;
		const max = entityCheck.maxCount ?? Number.MAX_SAFE_INTEGER;
		const surfacesOk =
			!entityCheck.surfacesContaining?.length ||
			entityCheck.surfacesContaining.every((needle) =>
				logs.some((l) => l.mentionSurface.toLowerCase().includes(needle.toLowerCase()))
			);
		const countOk = count >= min && count <= max;
		const passed = countOk && surfacesOk;
		const surfaceList = logs.map((l) => l.mentionSurface).join(', ') || 'nothing detected';
		assertions.push(
			assertResult(
				`entities_${entityCheck.fixtureId}`,
				'People, places, and things mentioned',
				passed,
				count > 0 ? `Detected ${count}: ${surfaceList}.` : 'No entities were extracted from this thought.',
				{ fixtureId: entityCheck.fixtureId, thoughtPreview: preview }
			)
		);
	}

	for (const fixtureId of checks.ontology?.requireActiveCategories ?? []) {
		const thoughtId = fixtureToUuid.get(fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`ontology_cat_${fixtureId}`,
					'Classified with your categories',
					false,
					'This thought was not captured in this run.',
					{ fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const [row] = await db
			.select({ category: thought.category })
			.from(thought)
			.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)));
		const category = row?.category ?? '';
		const categoryLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Unknown';
		const passed = activeCategoryKeys.has(category);
		assertions.push(
			assertResult(
				`ontology_cat_${fixtureId}`,
				'Classified with your categories',
				passed,
				passed
					? `Stored as “${categoryLabel}”, which is an active category in your ontology.`
					: `Stored as “${categoryLabel}”, which is not in your active categories.`,
				{ fixtureId, thoughtPreview: preview }
			)
		);
	}

	if (
		checks.ontology?.requireProfileGuidance ||
		checks.ontology?.minEvaluatedThoughtCount != null
	) {
		const [ontoRow] = await db
			.select({
				profile: userOntology.profile,
				evaluatedUpToThoughtCount: userOntology.evaluatedUpToThoughtCount
			})
			.from(userOntology)
			.where(eq(userOntology.userId, userId));
		const profile = ontoRow?.profile ? parseOntologyProfileJson(ontoRow.profile) : null;
		const guidanceKeys = profile?.kindGuidance ? Object.keys(profile.kindGuidance) : [];
		if (checks.ontology.requireProfileGuidance) {
			const passed = guidanceKeys.length > 0 || Boolean(profile?.summary?.trim());
			assertions.push(
				assertResult(
					'ontology_profile_guidance',
					'Ontology learned from your thoughts',
					passed,
					passed
						? 'Your ontology profile includes guidance derived from captured thoughts.'
						: 'Ontology profile has no guidance yet.'
				)
			);
		}
		if (checks.ontology.minEvaluatedThoughtCount != null) {
			const count = ontoRow?.evaluatedUpToThoughtCount ?? 0;
			const min = checks.ontology.minEvaluatedThoughtCount;
			const passed = count >= min;
			assertions.push(
				assertResult(
					'ontology_evaluated_cursor',
					'Ontology keeps up with new thoughts',
					passed,
					passed
						? `Ontology has been refreshed through ${count} thoughts (required: ${min}).`
						: `Only ${count} thoughts counted toward ontology refresh (need at least ${min}).`
				)
			);
		}
	}

	for (const fixtureId of checks.extraction?.requireEnriched ?? []) {
		const thoughtId = fixtureToUuid.get(fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`enriched_${fixtureId}`,
					'Automatic tags and metadata',
					false,
					'This thought was not captured in this run.',
					{ fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const [row] = await db
			.select({ enrichedAt: thought.enrichedAt, cues: thought.cues })
			.from(thought)
			.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)));
		const enriched = row?.enrichedAt != null;
		const cueCount = row?.cues?.length ?? 0;
		const cuesOk =
			!checks.extraction.requireCues?.length || cueCount > 0;
		const passed = enriched && cuesOk;
		assertions.push(
			assertResult(
				`enriched_${fixtureId}`,
				'Automatic tags and metadata',
				passed,
				enriched
					? `Thought was enriched with ${cueCount} automatic tag${cueCount === 1 ? '' : 's'}.`
					: 'Thought was not fully enriched (missing tags or metadata).',
				{ fixtureId, thoughtPreview: preview }
			)
		);
	}

	for (const fixtureId of checks.extraction?.requireValidMemoryType ?? []) {
		const thoughtId = fixtureToUuid.get(fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`memory_type_${fixtureId}`,
					'Valid memory type (not category label)',
					false,
					'This thought was not captured in this run.',
					{ fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const [row] = await db
			.select({ memoryType: thought.memoryType, enrichedAt: thought.enrichedAt })
			.from(thought)
			.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)));
		const typeOk = isPersistedMemoryTypeValid(row?.memoryType);
		const enriched = row?.enrichedAt != null;
		const passed = enriched && typeOk;
		const rawType = row?.memoryType?.trim() || '(missing)';
		assertions.push(
			assertResult(
				`memory_type_${fixtureId}`,
				'Valid memory type (not category label)',
				passed,
				passed
					? `memoryType is "${rawType}" (canonical storage axis).`
					: enriched
						? `memoryType "${rawType}" is not canonical — likely category.key copied into memoryType (e.g. observation).`
						: 'Thought was not enriched.',
				{ fixtureId, thoughtPreview: preview }
			)
		);
	}

	const expectedDim = checks.embedding?.expectedDimensions ?? DEFAULT_EMBEDDING_DIM;
	const minLex = checks.embedding?.minLexicalLength ?? 1;
	for (const fixtureId of checks.embedding?.requireVector ?? []) {
		const thoughtId = fixtureToUuid.get(fixtureId);
		if (!thoughtId) {
			assertions.push(
				assertResult(
					`embedding_${fixtureId}`,
					'Ready for semantic search',
					false,
					'This thought was not captured in this run.',
					{ fixtureId }
				)
			);
			continue;
		}
		const preview = await loadThoughtPreview(db, userId, thoughtId);
		const [row] = await db
			.select({
				embedding: thought.embedding,
				lexicalText: thought.lexicalText
			})
			.from(thought)
			.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)));
		const vec = row?.embedding;
		const dimOk = Array.isArray(vec) && vec.length === expectedDim && vec.every((n) => Number.isFinite(n));
		const lexOk = (row?.lexicalText?.trim().length ?? 0) >= minLex;
		const passed = dimOk && lexOk;
		assertions.push(
			assertResult(
				`embedding_${fixtureId}`,
				'Ready for semantic search',
				passed,
				passed
					? 'Embedding and keyword index are present so this thought can be found.'
					: 'Embedding or keyword index is missing or incomplete.',
				{ fixtureId, thoughtPreview: preview }
			)
		);
	}

	const passedCount = assertions.filter((a) => a.passed).length;
	const failedCount = assertions.length - passedCount;
	return { assertions, passedCount, failedCount };
}
