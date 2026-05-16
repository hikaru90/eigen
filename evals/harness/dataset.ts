import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Path constants ────────────────────────────────────────────────────────────

export const DATASETS_DIR = resolve(__dirname, '../datasets');
export const ANSWER_DATASET_DIR = resolve(__dirname, '../datasets/answer');

/** Corpus YAML with all ec_NNN thoughts. */
export const CORPUS_PATH = resolve(DATASETS_DIR, 'corpus.yaml');

/** Consolidated query file (retrieval ablation probes). */
export const QUERIES_PATH = resolve(DATASETS_DIR, 'queries.yaml');

/** Explicit relation edges wired after ingest for retrieval ablation. */
export const RELATIONS_PATH = resolve(DATASETS_DIR, 'relations.yaml');

/** QA synthesis probes run against the live-ingested corpus. */
export const QA_PROBES_PATH = resolve(DATASETS_DIR, 'qa-probes.yaml');

/**
 * Seed manifest: written by seed-corpus.ts after each full seed run.
 * Maps evalId → UUID so analysis-only runs can resolve corpus IDs
 * without re-ingesting.
 */
export const SEED_MANIFEST_PATH = resolve(DATASETS_DIR, 'seed-manifest.json');

// ── Corpus types ──────────────────────────────────────────────────────────────

export type ExpectedEntity = {
	surface: string;
	entity_type: string;
};

export type ExpectedRelation = {
	target_id: string;
	type: string;
};

export type CorpusThought = {
	id: string;
	rawText: string;
	cluster: string;
	/** True for thoughts that carry human-labeled expected.* ground truth. */
	golden?: boolean;
	/**
	 * Optional ISO-8601 datetime string for the thought's creation timestamp.
	 * When present the seeder overrides the DB created_at so temporal eval
	 * cases get deterministic relative timestamps.
	 */
	createdAt?: string;
	/** Human-labeled ground truth — only present when golden=true. */
	expected?: {
		category: string;
		entities: ExpectedEntity[];
		relations: ExpectedRelation[];
	};
};

export type CorpusFile = {
	thoughts: CorpusThought[];
};

// ── Relation types ────────────────────────────────────────────────────────────

export type RelationEdge = {
	source: string;
	target: string;
	type: string;
};

export type RelationsFile = {
	relations: RelationEdge[];
};

// ── Query types ───────────────────────────────────────────────────────────────

export type GradedRelevance = { id: string; grade: 0 | 1 | 2 | 3 };

export type QueryCategory = 'semantic_paraphrase' | 'entity_relation' | 'hybrid' | 'direct_recall';

export type EvalQuery = {
	id: string;
	category: QueryCategory;
	text: string;
	relevant: GradedRelevance[];
};

export type QueriesFile = {
	queries: EvalQuery[];
};

// ── Answer/QA types ───────────────────────────────────────────────────────────

export type AnswerCase = {
	id: string;
	question: string;
	expectedFacts: string[];
	/** Capability dimension tag from the golden baseline framework. */
	dimension?: string;
};

export type AnswerCasesFile = {
	cases: AnswerCase[];
};

export type QaProbe = {
	id: string;
	question: string;
	expectedFacts: string[];
};

export type QaProbesFile = {
	qa: QaProbe[];
};

// ── Seed manifest ─────────────────────────────────────────────────────────────

export type SeedManifest = Record<string, string>; // evalId → UUID

// ── YAML loader ───────────────────────────────────────────────────────────────

function loadYaml<T>(path: string): T {
	if (!existsSync(path)) {
		throw new Error(`[eval] dataset file missing: ${path}`);
	}
	const raw = readFileSync(path, 'utf-8');
	const parsed = yaml.load(raw);
	if (parsed === undefined || parsed === null) {
		throw new Error(`[eval] dataset file is empty: ${path}`);
	}
	return parsed as T;
}

// ── Loaders ───────────────────────────────────────────────────────────────────

export function loadCorpus(): CorpusFile {
	return loadYaml<CorpusFile>(CORPUS_PATH);
}

/** Return only the golden subset (thoughts with golden=true). */
export function loadGoldenThoughts(): CorpusThought[] {
	return loadCorpus().thoughts.filter((t) => t.golden === true);
}

export function loadRelations(): RelationsFile {
	return loadYaml<RelationsFile>(RELATIONS_PATH);
}

export function loadQueries(): QueriesFile {
	return loadYaml<QueriesFile>(QUERIES_PATH);
}

export function loadAnswerCases(): AnswerCasesFile {
	const file = loadYaml<{
		cases: Array<{
			id: string;
			question: string;
			expected_facts: string[];
			dimension?: string;
		}>;
	}>(resolve(ANSWER_DATASET_DIR, 'qa-cases.yaml'));
	return {
		cases: file.cases.map((c) => ({
			id: c.id,
			question: c.question,
			expectedFacts: c.expected_facts,
			dimension: c.dimension
		}))
	};
}

export function loadQaProbes(): QaProbesFile {
	const file = loadYaml<{
		qa: Array<{
			id: string;
			question: string;
			expected_facts: string[];
		}>;
	}>(QA_PROBES_PATH);
	return {
		qa: file.qa.map((c) => ({
			id: c.id,
			question: c.question,
			expectedFacts: c.expected_facts
		}))
	};
}

// ── Seed manifest helpers ─────────────────────────────────────────────────────

export function loadSeedManifest(): SeedManifest {
	if (!existsSync(SEED_MANIFEST_PATH)) return {};
	try {
		const raw = readFileSync(SEED_MANIFEST_PATH, 'utf-8');
		return JSON.parse(raw) as SeedManifest;
	} catch (err) {
		throw new Error(
			`[eval] seed manifest exists but is unreadable at ${SEED_MANIFEST_PATH}: ${
				err instanceof Error ? err.message : String(err)
			}. Delete the file to force a full re-seed.`
		);
	}
}

export function saveSeedManifest(manifest: SeedManifest): void {
	mkdirSync(dirname(SEED_MANIFEST_PATH), { recursive: true });
	writeFileSync(SEED_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ── Legacy: keep EmbeddingCache exports for the retrieval ablation ────────────
// The ablation still caches embeddings to avoid re-embedding on every run.

export const EMBEDDING_CACHE_PATH = resolve(DATASETS_DIR, 'embeddings.cache.json');

export type EmbeddingCache = Record<string, number[]>;

export function loadEmbeddingCache(): EmbeddingCache {
	if (!existsSync(EMBEDDING_CACHE_PATH)) return {};
	try {
		const raw = readFileSync(EMBEDDING_CACHE_PATH, 'utf-8');
		return JSON.parse(raw) as EmbeddingCache;
	} catch (err) {
		throw new Error(
			`[eval] embeddings cache exists but is unreadable at ${EMBEDDING_CACHE_PATH}: ${
				err instanceof Error ? err.message : String(err)
			}. Delete the file to regenerate.`
		);
	}
}

export function saveEmbeddingCache(cache: EmbeddingCache): void {
	mkdirSync(dirname(EMBEDDING_CACHE_PATH), { recursive: true });
	writeFileSync(EMBEDDING_CACHE_PATH, JSON.stringify(cache, null, 2));
}
