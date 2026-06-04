import { buildRelevanceMap, ndcgAtK } from './metrics';
import type { CheckAssertionResult, QaChecks, QaRetrievalRelevant } from './qa-types';

/** Assertion ids that reflect broken ingest / enrichment, not retrieval ranking. */
const INGEST_ASSERTION_PREFIXES = [
	'embedding_',
	'enriched_',
	'extraction_',
	'entities_',
	'graph_',
	'ontology_cat_'
] as const;

export function isIngestStructuralAssertion(assertionId: string): boolean {
	return INGEST_ASSERTION_PREFIXES.some((prefix) => assertionId.startsWith(prefix));
}

/** Fixtures that failed ingest-related checks in a check entry. */
export function ingestBrokenFixtureIdsFromAssertions(
	assertions: CheckAssertionResult[]
): Set<string> {
	const broken = new Set<string>();
	for (const a of assertions) {
		if (a.passed) continue;
		if (!a.fixtureId) continue;
		if (!isIngestStructuralAssertion(a.id)) continue;
		broken.add(a.fixtureId);
	}
	return broken;
}

/**
 * Drop graded relevance labels for captures whose ingest failed.
 * Captures and structural checks are unchanged — only retrieval grading is updated.
 */
/** Ingest failures on these fixtures are not dropped from retrieval grades (needle stays graded). */
export function ingestBrokenEligibleForRetrievalPrune(
	ingestBroken: Iterable<string>,
	needleFixtureId?: string
): Set<string> {
	const eligible = new Set(ingestBroken);
	if (needleFixtureId) eligible.delete(needleFixtureId);
	return eligible;
}

export function pruneRetrievalRelevantForIngestFailures(input: {
	retrievalRelevant: QaRetrievalRelevant[];
	ingestBrokenFixtureIds: Iterable<string>;
	needleFixtureId?: string;
}): { retrievalRelevant: QaRetrievalRelevant[]; removed: string[] } {
	const broken = ingestBrokenEligibleForRetrievalPrune(
		input.ingestBrokenFixtureIds,
		input.needleFixtureId
	);
	const removed: string[] = [];
	const retrievalRelevant = input.retrievalRelevant.filter((row) => {
		if (!broken.has(row.id)) return true;
		removed.push(row.id);
		return false;
	});
	return { retrievalRelevant, removed };
}

/** Clear needle config when the needle was removed from retrieval grades. */
export function adjustChecksAfterRetrievalPrune(checks: QaChecks, removed: Set<string>): QaChecks {
	if (removed.size === 0) return checks;
	const needle = checks.retrieval?.needleFixtureId;
	if (!needle || !removed.has(needle)) return checks;
	const next = { ...checks, retrieval: { ...checks.retrieval } };
	delete next.retrieval!.needleFixtureId;
	return next;
}

export function rankedFixtureIdsToUuids(
	topRankedFixtureIds: string[],
	fixtureToUuid: Map<string, string>
): string[] {
	return topRankedFixtureIds
		.map((fid) => fixtureToUuid.get(fid))
		.filter((id): id is string => Boolean(id));
}

export function ndcgAt10ForRetrievalGrades(input: {
	topRankedFixtureIds: string[];
	retrievalRelevant: QaRetrievalRelevant[];
	fixtureToUuid: Map<string, string>;
}): number | null {
	const scoped = input.retrievalRelevant.filter((r) => input.fixtureToUuid.has(r.id));
	if (scoped.length === 0) return null;
	const rankedUuids = rankedFixtureIdsToUuids(input.topRankedFixtureIds, input.fixtureToUuid);
	const uuidRelevant = scoped
		.map((r) => {
			const uuid = input.fixtureToUuid.get(r.id);
			return uuid ? { id: uuid, grade: r.grade } : null;
		})
		.filter(Boolean) as Array<{ id: string; grade: 0 | 1 | 2 | 3 }>;
	const relevance = buildRelevanceMap(uuidRelevant);
	return ndcgAtK(rankedUuids, relevance, 10);
}

export function previewRetrievalPassAfterPrune(input: {
	topRankedFixtureIds: string[];
	retrievalRelevant: QaRetrievalRelevant[];
	fixtureToUuid: Map<string, string>;
	minNdcgAt10: number;
}): { ndcgAt10: number | null; wouldPass: boolean } {
	const ndcgAt10 = ndcgAt10ForRetrievalGrades(input);
	if (ndcgAt10 == null) return { ndcgAt10: null, wouldPass: false };
	return { ndcgAt10, wouldPass: ndcgAt10 >= input.minNdcgAt10 };
}

export type RetrievalRelevantPrunePlan = {
	removed: string[];
	retrievalRelevantBefore: QaRetrievalRelevant[];
	retrievalRelevantAfter: QaRetrievalRelevant[];
	checksBefore: QaChecks;
	checksAfter: QaChecks;
	ndcgBefore: number | null;
	ndcgAfter: number | null;
	warnings: string[];
};

export function buildRetrievalRelevantPrunePlan(input: {
	retrievalRelevant: QaRetrievalRelevant[];
	checks: QaChecks;
	ingestBrokenFixtureIds: Set<string>;
	topRankedFixtureIds?: string[];
	fixtureToUuid?: Map<string, string>;
	minNdcgAt10?: number;
}): RetrievalRelevantPrunePlan | null {
	const needle = input.checks.retrieval?.needleFixtureId;
	const pruneBroken = ingestBrokenEligibleForRetrievalPrune(
		input.ingestBrokenFixtureIds,
		needle
	);
	const gradedBroken = input.retrievalRelevant
		.filter((r) => pruneBroken.has(r.id))
		.map((r) => r.id);
	if (gradedBroken.length === 0) return null;

	const { retrievalRelevant: retrievalRelevantAfter, removed } = pruneRetrievalRelevantForIngestFailures({
		retrievalRelevant: input.retrievalRelevant,
		ingestBrokenFixtureIds: pruneBroken,
		needleFixtureId: needle
	});
	const removedSet = new Set(removed);
	const checksAfter = adjustChecksAfterRetrievalPrune(input.checks, removedSet);
	const warnings: string[] = [];
	if (needle && input.ingestBrokenFixtureIds.has(needle)) {
		warnings.push(
			`Needle ${needle} ingest failed — kept in retrieval grades; fix entity/embedding checks (not auto-pruned).`
		);
	}

	const minNdcg = input.minNdcgAt10 ?? input.checks.retrieval?.minNdcgAt10 ?? 0.5;
	let ndcgBefore: number | null = null;
	let ndcgAfter: number | null = null;
	if (input.topRankedFixtureIds && input.fixtureToUuid) {
		ndcgBefore = ndcgAt10ForRetrievalGrades({
			topRankedFixtureIds: input.topRankedFixtureIds,
			retrievalRelevant: input.retrievalRelevant,
			fixtureToUuid: input.fixtureToUuid
		});
		ndcgAfter = ndcgAt10ForRetrievalGrades({
			topRankedFixtureIds: input.topRankedFixtureIds,
			retrievalRelevant: retrievalRelevantAfter,
			fixtureToUuid: input.fixtureToUuid
		});
	}

	return {
		removed,
		retrievalRelevantBefore: input.retrievalRelevant,
		retrievalRelevantAfter,
		checksBefore: input.checks,
		checksAfter,
		ndcgBefore,
		ndcgAfter,
		warnings
	};
}
