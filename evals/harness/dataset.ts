import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RETRIEVAL_DATASET_DIR = resolve(__dirname, '../datasets/retrieval');
export const ANSWER_DATASET_DIR = resolve(__dirname, '../datasets/answer');
export const AGENT_DATASET_DIR = resolve(__dirname, '../datasets/agent');
export const RETRIEVAL_EMBEDDING_CACHE_PATH = resolve(
	RETRIEVAL_DATASET_DIR,
	'embeddings.cache.json'
);

export type CorpusThought = {
	id: string;
	rawText: string;
	category: string;
};

export type CorpusFile = {
	thoughts: CorpusThought[];
};

export type RelationEdge = {
	source: string;
	target: string;
	type: string;
};

export type RelationsFile = {
	relations: RelationEdge[];
};

export type GradedRelevance = { id: string; grade: 0 | 1 | 2 | 3 };

export type QueryCategory = 'semantic_paraphrase' | 'entity_relation' | 'hybrid';

export type EvalQuery = {
	id: string;
	category: QueryCategory;
	text: string;
	relevant: GradedRelevance[];
};

export type QueriesFile = {
	queries: EvalQuery[];
};

export type AnswerCase = {
	id: string;
	question: string;
	expectedFacts: string[];
};

export type AnswerCasesFile = {
	cases: AnswerCase[];
};

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

export function loadCorpus(): CorpusFile {
	return loadYaml<CorpusFile>(resolve(RETRIEVAL_DATASET_DIR, 'corpus.yaml'));
}

export function loadRelations(): RelationsFile {
	return loadYaml<RelationsFile>(resolve(RETRIEVAL_DATASET_DIR, 'relations.yaml'));
}

export function loadQueries(): QueriesFile {
	return loadYaml<QueriesFile>(resolve(RETRIEVAL_DATASET_DIR, 'queries.yaml'));
}

export function loadAnswerCases(): AnswerCasesFile {
	const file = loadYaml<{ cases: Array<{ id: string; question: string; expected_facts: string[] }> }>(
		resolve(ANSWER_DATASET_DIR, 'qa-cases.yaml')
	);
	return {
		cases: file.cases.map((c) => ({
			id: c.id,
			question: c.question,
			expectedFacts: c.expected_facts
		}))
	};
}

// ---------------------------------------------------------------------------
// Agent ingest eval dataset types
// ---------------------------------------------------------------------------

export type AgentThought = {
	id: string;
	rawText: string;
	category: string;
};

export type AgentThoughtsFile = {
	thoughts: AgentThought[];
};

export type AgentProbeCategory = 'direct_recall' | 'entity_relation';

export type AgentRetrievalProbe = {
	id: string;
	category: AgentProbeCategory;
	text: string;
	relevant: Array<{ id: string; grade: 0 | 1 | 2 | 3 }>;
};

export type AgentQaProbe = {
	id: string;
	question: string;
	expectedFacts: string[];
};

export type AgentProbesFile = {
	retrieval: AgentRetrievalProbe[];
	qa: AgentQaProbe[];
};

export function loadAgentThoughts(): AgentThoughtsFile {
	return loadYaml<AgentThoughtsFile>(resolve(AGENT_DATASET_DIR, 'thoughts-10.yaml'));
}

export function loadAgentProbes(): AgentProbesFile {
	const raw = loadYaml<{
		retrieval: Array<{
			id: string;
			category: AgentProbeCategory;
			text: string;
			relevant: Array<{ id: string; grade: 0 | 1 | 2 | 3 }>;
		}>;
		qa: Array<{
			id: string;
			question: string;
			expected_facts: string[];
		}>;
	}>(resolve(AGENT_DATASET_DIR, 'probes.yaml'));
	return {
		retrieval: raw.retrieval,
		qa: raw.qa.map((c) => ({
			id: c.id,
			question: c.question,
			expectedFacts: c.expected_facts
		}))
	};
}

export type EmbeddingCache = Record<string, number[]>;

export function loadEmbeddingCache(): EmbeddingCache {
	if (!existsSync(RETRIEVAL_EMBEDDING_CACHE_PATH)) return {};
	try {
		const raw = readFileSync(RETRIEVAL_EMBEDDING_CACHE_PATH, 'utf-8');
		return JSON.parse(raw) as EmbeddingCache;
	} catch (err) {
		throw new Error(
			`[eval] embeddings cache exists but is unreadable at ${RETRIEVAL_EMBEDDING_CACHE_PATH}: ${
				err instanceof Error ? err.message : String(err)
			}. Delete the file to regenerate.`
		);
	}
}

export function saveEmbeddingCache(cache: EmbeddingCache): void {
	mkdirSync(dirname(RETRIEVAL_EMBEDDING_CACHE_PATH), { recursive: true });
	writeFileSync(RETRIEVAL_EMBEDDING_CACHE_PATH, JSON.stringify(cache, null, 2));
}
