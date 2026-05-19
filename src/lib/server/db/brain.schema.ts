import {
	boolean,
	customType,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	vector
} from 'drizzle-orm/pg-core';
import { type InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema';

const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector';
	}
});

/** Postgres `tsrange` literal, e.g. `[2025-10-01,2026-03-01)`. */
const tsrange = customType<{ data: string }>({
	dataType() {
		return 'tsrange';
	}
});

/**
 * Per-user entity kind definitions (ontology catalog). No TS closed union — keys are data.
 * `kind_type` discriminates between thought categories ('thought_category') and real-world
 * entity types ('entity_type') so each can be loaded and validated independently.
 * Committed thought `category` stores the same string as `ontology_entity_kind.key` for the linked row.
 */
export const ontologyEntityKind = pgTable(
	'ontology_entity_kind',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		definition: text('definition').notNull(),
		active: boolean('active').notNull().default(true),
		/**
		 * 'thought_category' — used to classify thoughts (task, idea, observation, …)
		 * 'entity_type'      — used to type real-world entity graph nodes (person, place, …)
		 */
		kindType: text('kind_type').notNull().default('thought_category'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		unique('ontology_entity_kind_user_key_uidx').on(t.userId, t.key),
		index('ontology_entity_kind_user_idx').on(t.userId),
		index('ontology_entity_kind_kind_type_idx').on(t.userId, t.kindType)
	]
);

/**
 * Per-user relation kind definitions; endpoints reference ontology_entity_kind ids.
 */
export const ontologyRelationKind = pgTable(
	'ontology_relation_kind',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		meaning: text('meaning').notNull(),
		fromOntologyEntityKindId: uuid('from_ontology_entity_kind_id')
			.notNull()
			.references(() => ontologyEntityKind.id, { onDelete: 'restrict' }),
		toOntologyEntityKindId: uuid('to_ontology_entity_kind_id')
			.notNull()
			.references(() => ontologyEntityKind.id, { onDelete: 'restrict' }),
		active: boolean('active').notNull().default(true),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		uniqueIndex('ontology_relation_kind_user_key_uidx').on(t.userId, t.key),
		index('ontology_relation_kind_user_idx').on(t.userId),
		index('ontology_relation_kind_from_idx').on(t.fromOntologyEntityKindId),
		index('ontology_relation_kind_to_idx').on(t.toOntologyEntityKindId)
	]
);

export const captureSessionStatusEnum = ['open', 'accepted', 'cancelled'] as const;
export type CaptureSessionStatus = (typeof captureSessionStatusEnum)[number];

/**
 * In-flight capture: preview and revisions live here until explicit accept (AC-001..004).
 */
export const captureSession = pgTable(
	'capture_session',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		status: text('status').$type<CaptureSessionStatus>().notNull().default('open'),
		rawInput: text('raw_input').notNull(),
		normalizedPreview: text('normalized_preview').notNull().default(''),
		category: text('category').notNull().default('perception'),
		metadataPreview: jsonb('metadata_preview').$type<Record<string, unknown>>().notNull().default({}),
		revisionCount: integer('revision_count').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('capture_session_user_idx').on(t.userId),
		index('capture_session_status_idx').on(t.status),
		foreignKey({
			columns: [t.userId, t.category],
			foreignColumns: [ontologyEntityKind.userId, ontologyEntityKind.key],
			name: 'capture_session_user_category_ontology_fk'
		}).onDelete('restrict')
	]
);

/**
 * Committed thoughts only (post-accept, AC-003).
 * Embedding dimensions aligned with common OpenAI-size vectors; adjust if your model differs.
 * `lexical_text`: deterministic pre-normalization for keyword / FTS recall (see AGENTS.md).
 */
/**
 * Structured memory type — classifies what kind of memory the thought represents.
 * Assigned by async enrichment after the fast capture path persists the row.
 */
export const memoryTypeEnum = [
	'episode',
	'fact',
	'decision',
	'concern',
	'open_loop',
	'preference',
	'pattern'
] as const;
export type MemoryType = (typeof memoryTypeEnum)[number];

export const thought = pgTable(
	'thought',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rawText: text('raw_text').notNull(),
		normalizedText: text('normalized_text').notNull(),
		/** NFKC-folded, lowercased, whitespace-collapsed — feed for `tsvector` / BM25-style search. */
		lexicalText: text('lexical_text').notNull().default(''),
		lexicalTsv: tsvector('lexical_tsv')
			.notNull()
			.generatedAlwaysAs(sql`to_tsvector('simple', coalesce(lexical_text, ''))`),
		category: text('category').notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		embedding: vector('embedding', { dimensions: 1536 }),
		/** FK to the ontology row whose `key` matches `category` (set on capture / edit). */
		ontologyEntityKindId: uuid('ontology_entity_kind_id').references(() => ontologyEntityKind.id, {
			onDelete: 'restrict'
		}),
		/**
		 * Structured memory type — set by async enrichment.
		 * null = not yet classified (enrichment pending or not run).
		 */
		memoryType: text('memory_type').$type<MemoryType>(),
		/**
		 * Alternate search phrases generated by enrichment for this thought.
		 * GIN-indexed for lexical search diversification.
		 */
		cues: text('cues').array().notNull().default(sql`ARRAY[]::text[]`),
		/**
		 * Importance signal: starts at 1.0, boosted on retrieval access, decayed nightly.
		 * Used by consolidation jobs and future retrieval weighting.
		 */
		salienceScore: real('salience_score').notNull().default(1.0),
		/** How many times this thought has been returned in a retrieval result. */
		accessCount: integer('access_count').notNull().default(0),
		/** Timestamp of last retrieval hit — used for salience decay calculation. */
		lastAccessedAt: timestamp('last_accessed_at'),
		/**
		 * Set when async enrichment (entity extraction, relations, cues, memory type)
		 * has completed for this thought row. null = enrichment pending.
		 */
		enrichedAt: timestamp('enriched_at'),
		/** Incremented each time enrichment re-runs (e.g. relink). */
		enrichmentVersion: integer('enrichment_version').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('thought_user_idx').on(t.userId),
		index('thought_ontology_entity_kind_idx').on(t.ontologyEntityKindId),
		index('thought_lexical_tsv_idx').using('gin', t.lexicalTsv),
		index('thought_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
		index('thought_cues_gin_idx').using('gin', t.cues),
		index('thought_salience_idx').on(t.userId, t.salienceScore),
		index('thought_enriched_idx').on(t.userId, t.enrichedAt),
		foreignKey({
			columns: [t.userId, t.category],
			foreignColumns: [ontologyEntityKind.userId, ontologyEntityKind.key],
			name: 'thought_user_category_ontology_fk'
		}).onDelete('restrict')
	]
);

/**
 * Simple relational edges (MVP graph layer); AGE can mirror or replace this later.
 */
export const thoughtRelation = pgTable(
	'thought_relation',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		sourceThoughtId: uuid('source_thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		targetThoughtId: uuid('target_thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		relationType: text('relation_type').notNull(),
		/** Optional link to user ontology relation kind row. */
		ontologyRelationKindId: uuid('ontology_relation_kind_id').references(() => ontologyRelationKind.id, {
			onDelete: 'set null'
		}),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('thought_relation_user_idx').on(t.userId),
		index('thought_relation_ontology_kind_idx').on(t.ontologyRelationKindId),
		index('thought_relation_source_idx').on(t.sourceThoughtId),
		index('thought_relation_target_idx').on(t.targetThoughtId)
	]
);

/** Per-call pricing transparency (AC-013, AC-014). Amounts stored as decimal strings in USD. */
export const activityCallLog = pgTable(
	'activity_call_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		operation: text('operation').notNull(),
		/** Brief preview of the content being processed (e.g., first 50 chars of user message) */
		context: text('context'),
		baseCostUsd: text('base_cost_usd').notNull(),
		markupUsd: text('markup_usd').notNull(),
		totalCostUsd: text('total_cost_usd').notNull(),
		markupRate: text('markup_rate').notNull().default('0.20'),
		groupId: uuid('group_id'),
		durationMs: integer('duration_ms'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [index('activity_call_log_user_idx').on(t.userId)]
);

/**
 * Metadata-only hybrid retrieval diagnostics (AC-024). No query text, thought ids, or bodies.
 */
export const retrievalQualityEvent = pgTable(
	'retrieval_quality_event',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** Caller surface: `api` | `mcp` | `compose_answer`. */
		surface: text('surface').notNull(),
		retrievalVersion: text('retrieval_version').notNull().default('1'),
		topK: integer('top_k').notNull(),
		weightVector: doublePrecision('weight_vector').notNull(),
		weightGraph: doublePrecision('weight_graph').notNull(),
		resultCount: integer('result_count').notNull(),
		top1SemanticShare: doublePrecision('top1_semantic_share').notNull(),
		topkMeanSemanticShare: doublePrecision('topk_mean_semantic_share').notNull(),
		top1PrimaryChannel: text('top1_primary_channel').notNull(),
		graphOnlyInTopkCount: integer('graph_only_in_topk_count').notNull()
	},
	(t) => [
		index('retrieval_quality_event_user_idx').on(t.userId),
		index('retrieval_quality_event_user_created_idx').on(t.userId, t.createdAt)
	]
);

/** Per-user app preferences (settings page). */
export const userPreference = pgTable(
	'user_preference',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		preferredLanguage: text('preferred_language').notNull().default('en'),
		preferredTranscriptionQuality: text('preferred_transcription_quality')
			.notNull()
			.default('low'),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('user_preference_language_idx').on(t.preferredLanguage),
		index('user_preference_quality_idx').on(t.preferredTranscriptionQuality)
	]
);

/**
 * Per-user thought ontology profile: classifier guidance refreshed periodically (every 10 new thoughts).
 */
export const userOntology = pgTable(
	'user_ontology',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
		evaluatedUpToThoughtCount: integer('evaluated_up_to_thought_count').notNull().default(0),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('user_ontology_updated_idx').on(t.updatedAt)]
);

/** Canonical entities for Graphiti-style resolution (per-tenant). */
export const canonicalEntity = pgTable(
	'canonical_entity',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** NFKC-folded, lowercased key used for exact dedup (see `computeLexicalText`). */
		canonicalKey: text('canonical_key').notNull(),
		label: text('label').notNull(),
		entityType: text('entity_type').notNull().default('other'),
		embedding: vector('embedding', { dimensions: 1536 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('canonical_entity_user_idx').on(t.userId),
		uniqueIndex('canonical_entity_user_canonical_uidx').on(t.userId, t.canonicalKey),
		index('canonical_entity_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))
	]
);

/** Alternate surfaces mapped to a canonical entity. */
export const entityAlias = pgTable(
	'entity_alias',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		canonicalEntityId: uuid('canonical_entity_id')
			.notNull()
			.references(() => canonicalEntity.id, { onDelete: 'cascade' }),
		aliasText: text('alias_text').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('entity_alias_user_idx').on(t.userId),
		index('entity_alias_canonical_idx').on(t.canonicalEntityId),
		uniqueIndex('entity_alias_user_surface_uidx').on(t.userId, t.aliasText)
	]
);

/** User-facing API keys for MCP / external tool access. */
export const userApiKey = pgTable(
	'user_api_key',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		keyPrefix: text('key_prefix').notNull(),
		keyHash: text('key_hash').notNull(),
		isActive: boolean('is_active').notNull().default(true),
		lastUsedAt: timestamp('last_used_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('user_api_key_user_idx').on(t.userId)]
);

export type UserApiKey = InferSelectModel<typeof userApiKey>;

/**
 * A single chat conversation session.
 */
export const chatSession = pgTable(
	'chat_session',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull().default(''),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('chat_session_user_idx').on(t.userId),
		index('chat_session_updated_idx').on(t.userId, t.updatedAt)
	]
);

export type ChatSession = InferSelectModel<typeof chatSession>;

/**
 * Individual messages within a chat session.
 */
export const chatMessage = pgTable(
	'chat_message',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		sessionId: uuid('session_id')
			.notNull()
			.references(() => chatSession.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
		content: text('content').notNull(),
		/** Stores variant/tool metadata for intermediate agent steps (thinking, tool_call, tool_result). */
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('chat_message_session_idx').on(t.sessionId),
		index('chat_message_user_idx').on(t.userId),
		index('chat_message_created_idx').on(t.sessionId, t.createdAt)
	]
);

export type ChatMessageRow = InferSelectModel<typeof chatMessage>;

/** Audit trail for merge vs create decisions during ingestion. */
export const entityResolutionLog = pgTable(
	'entity_resolution_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		thoughtId: uuid('thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		mentionSurface: text('mention_surface').notNull(),
		canonicalEntityId: uuid('canonical_entity_id').references(() => canonicalEntity.id, {
			onDelete: 'set null'
		}),
		decision: text('decision').notNull(),
		confidence: text('confidence').notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('entity_resolution_log_user_idx').on(t.userId),
		index('entity_resolution_log_thought_idx').on(t.thoughtId)
	]
);

/**
 * Per-user, per-provider LLM credentials. Each provider (eurouter, openrouter, …) gets its own
 * independent row so base URL, API key, and provider-specific fields never bleed across providers.
 *
 * Composite PK: (user_id, provider).
 */
export const llmProviderConfig = pgTable('llm_provider_config', {
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull(), // 'eurouter' | 'openrouter'
	baseUrl: text('base_url').notNull(),
	apiKey: text('api_key').notNull(),
	/** EUrouter only: routing rule UUID for chat completions. */
	ruleChat: text('rule_chat'),
	/** EUrouter only: routing rule UUID for embeddings. */
	ruleEmbedding: text('rule_embedding'),
	/** OpenRouter only: model name for chat completions (e.g. openai/gpt-4o). */
	modelChat: text('model_chat'),
	/** OpenRouter only: model name for embeddings (e.g. openai/text-embedding-3-small). */
	modelEmbedding: text('model_embedding'),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
}, (t) => [primaryKey({ columns: [t.userId, t.provider], name: 'llm_provider_config_pk' })]);

/**
 * Tracks which provider is currently active for a user.
 * Separate from credentials so switching providers never overwrites saved credentials.
 */
export const llmActiveProvider = pgTable('llm_active_provider', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull().default('eurouter'),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

// ---------------------------------------------------------------------------
// Temporal memory (Postgres time-keeper + Falkor context weaver)
// ---------------------------------------------------------------------------

export const temporalEventKindEnum = [
	'deadline',
	'appointment',
	'milestone',
	'period',
	'reminder',
	'inferred_event'
] as const;
export type TemporalEventKind = (typeof temporalEventKindEnum)[number];

export const temporalTimePrecisionEnum = ['exact', 'day', 'week', 'month', 'fuzzy'] as const;
export type TemporalTimePrecision = (typeof temporalTimePrecisionEnum)[number];

/**
 * Structured temporal facts extracted from thoughts. `active_period` is the
 * canonical overlap key for timeline slicing; Falkor `Event` nodes mirror these rows.
 */
export const temporalEvent = pgTable(
	'temporal_event',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		thoughtId: uuid('thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		/** Falkor Event node id; set when graph sync succeeds (defaults to row id). */
		falkordbNodeId: text('falkordb_node_id'),
		kind: text('kind').$type<TemporalEventKind>().notNull(),
		activePeriod: tsrange('active_period').notNull(),
		timePrecision: text('time_precision').$type<TemporalTimePrecision>().notNull(),
		timezone: text('timezone').notNull(),
		isAllDay: boolean('is_all_day').notNull().default(false),
		recurrenceRule: text('recurrence_rule'),
		confidence: real('confidence').notNull(),
		semanticSummary: text('semantic_summary').notNull(),
		embedding: vector('embedding', { dimensions: 1536 }),
		lexicalText: text('lexical_text').notNull().default(''),
		lexicalTsv: tsvector('lexical_tsv')
			.notNull()
			.generatedAlwaysAs(sql`to_tsvector('simple', coalesce(lexical_text, ''))`),
		sourceTextSpan: text('source_text_span'),
		parseMetadata: jsonb('parse_metadata').$type<Record<string, unknown>>().notNull().default({}),
		/** Scalar bounds for Falkor reference (derived from active_period). */
		startAt: timestamp('start_at'),
		endAt: timestamp('end_at'),
		graphSyncStatus: text('graph_sync_status').notNull().default('pending'),
		graphSyncError: text('graph_sync_error'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('temporal_event_user_idx').on(t.userId),
		index('temporal_event_thought_idx').on(t.thoughtId),
		index('temporal_event_active_period_idx').using('gist', t.activePeriod),
		index('temporal_event_lexical_tsv_idx').using('gin', t.lexicalTsv),
		index('temporal_event_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
		index('temporal_event_graph_sync_idx').on(t.userId, t.graphSyncStatus)
	]
);

export type TemporalEvent = typeof temporalEvent.$inferSelect;

export const graphSyncJobStatusEnum = ['pending', 'processing', 'completed', 'failed'] as const;
export type GraphSyncJobStatus = (typeof graphSyncJobStatusEnum)[number];

export const graphSyncJobOperationEnum = ['upsert_temporal_event', 'delete_temporal_event'] as const;
export type GraphSyncJobOperation = (typeof graphSyncJobOperationEnum)[number];

/** Outbox for Falkor graph writes after Postgres commit (deterministic retries). */
export const graphSyncJob = pgTable(
	'graph_sync_job',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		temporalEventId: uuid('temporal_event_id').references(() => temporalEvent.id, {
			onDelete: 'cascade'
		}),
		operation: text('operation').$type<GraphSyncJobOperation>().notNull(),
		status: text('status').$type<GraphSyncJobStatus>().notNull().default('pending'),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		attemptCount: integer('attempt_count').notNull().default(0),
		lastError: text('last_error'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		completedAt: timestamp('completed_at')
	},
	(t) => [
		index('graph_sync_job_user_idx').on(t.userId),
		index('graph_sync_job_status_idx').on(t.status, t.createdAt),
		index('graph_sync_job_temporal_event_idx').on(t.temporalEventId)
	]
);

export type GraphSyncJob = typeof graphSyncJob.$inferSelect;

// ---------------------------------------------------------------------------
// GraphRAG community detection tables
// ---------------------------------------------------------------------------

/**
 * Hierarchical entity communities detected by the Leiden algorithm over the
 * FalkorDB entity graph. Level 0 = root (broadest), level 3 = leaf (tightest).
 * Generated by the nightly consolidation job.
 */
export const graphCommunity = pgTable(
	'graph_community',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** 0 = root/interpretive, 1-2 = mid/structural, 3 = leaf/factual */
		level: integer('level').notNull(),
		parentCommunityId: uuid('parent_community_id'),
		memberCount: integer('member_count').notNull().default(0),
		detectedAt: timestamp('detected_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('graph_community_user_idx').on(t.userId),
		index('graph_community_user_level_idx').on(t.userId, t.level),
		index('graph_community_parent_idx').on(t.parentCommunityId)
	]
);

export type GraphCommunity = typeof graphCommunity.$inferSelect;

/**
 * Membership: which canonical entities belong to which community.
 * An entity belongs to exactly one community per level.
 */
export const communityMember = pgTable(
	'community_member',
	{
		communityId: uuid('community_id')
			.notNull()
			.references(() => graphCommunity.id, { onDelete: 'cascade' }),
		canonicalEntityId: uuid('canonical_entity_id')
			.notNull()
			.references(() => canonicalEntity.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.communityId, t.canonicalEntityId], name: 'community_member_pk' }),
		index('community_member_entity_idx').on(t.canonicalEntityId),
		index('community_member_user_idx').on(t.userId)
	]
);

/**
 * LLM-generated summaries for each community level.
 * L3 (leaf): factual — entity names, co-occurrence counts, date ranges.
 * L1-L2 (mid): structural — relationship frequency and patterns.
 * L0 (root): interpretive — personal patterns, written in second person.
 * summaryEmbedding enables HNSW search for global sensemaking queries.
 */
export const communitySummary = pgTable(
	'community_summary',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		communityId: uuid('community_id')
			.notNull()
			.references(() => graphCommunity.id, { onDelete: 'cascade' }),
		level: integer('level').notNull(),
		summaryText: text('summary_text').notNull(),
		summaryEmbedding: vector('summary_embedding', { dimensions: 1536 }),
		entityCount: integer('entity_count').notNull().default(0),
		thoughtCount: integer('thought_count').notNull().default(0),
		generatedAt: timestamp('generated_at').defaultNow().notNull()
	},
	(t) => [
		index('community_summary_user_idx').on(t.userId),
		index('community_summary_user_level_idx').on(t.userId, t.level),
		index('community_summary_community_idx').on(t.communityId),
		index('community_summary_embedding_hnsw_idx').using(
			'hnsw',
			t.summaryEmbedding.op('vector_cosine_ops')
		),
		unique('community_summary_community_uidx').on(t.communityId)
	]
);

export type CommunitySummary = typeof communitySummary.$inferSelect;

// ---------------------------------------------------------------------------
// Ontology evolution
// ---------------------------------------------------------------------------

export const ontologyProposalStatusEnum = ['candidate', 'promoted', 'rejected'] as const;
export type OntologyProposalStatus = (typeof ontologyProposalStatusEnum)[number];

/**
 * Proposed new ontology kinds surfaced by the consolidation job from clustering
 * low-confidence categories and recurring entity mention patterns.
 * Promoted proposals are copied into `ontology_entity_kind` by the admin flow.
 */
export const ontologyProposal = pgTable(
	'ontology_proposal',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		definition: text('definition').notNull(),
		evidenceCount: integer('evidence_count').notNull().default(0),
		frequencyScore: real('frequency_score').notNull().default(0),
		status: text('status').$type<OntologyProposalStatus>().notNull().default('candidate'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('ontology_proposal_user_idx').on(t.userId),
		index('ontology_proposal_user_status_idx').on(t.userId, t.status),
		unique('ontology_proposal_user_key_uidx').on(t.userId, t.key)
	]
);

export type OntologyProposal = typeof ontologyProposal.$inferSelect;

// ---------------------------------------------------------------------------
// Eval harness (DB-backed runs; operator-scoped via RLS)
// ---------------------------------------------------------------------------

export const evalRunStatusEnum = ['draft', 'running', 'completed', 'failed', 'stopped'] as const;
export type EvalRunStatus = (typeof evalRunStatusEnum)[number];

export const evalEntryKindEnum = ['capture', 'check', 'retrieval', 'answer', 'edit'] as const;
export type EvalEntryKind = (typeof evalEntryKindEnum)[number];

export const evalEntryStatusEnum = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export type EvalEntryStatus = (typeof evalEntryStatusEnum)[number];

/** A composed eval session (QA catalog run). */
export const evalRun = pgTable(
	'eval_run',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Logged-in dev user who owns this run row. */
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Ephemeral brain tenant; thoughts live under this id during the run. */
		evalUserId: text('eval_user_id').notNull(),
		label: text('label').notNull(),
		scenarioId: text('scenario_id'),
		status: text('status').$type<EvalRunStatus>().notNull().default('draft'),
		configJson: jsonb('config_json').$type<Record<string, unknown>>().notNull().default({}),
		synthesisJson: jsonb('synthesis_json').$type<Record<string, unknown>>(),
		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at'),
		error: text('error'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('eval_run_user_idx').on(t.userId),
		index('eval_run_user_created_idx').on(t.userId, t.createdAt)
	]
);

export type EvalRun = typeof evalRun.$inferSelect;

/** Atomic eval step: one capture, one retrieval query (+ sweep), or one answer. */
export const evalEntry = pgTable(
	'eval_entry',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		runId: uuid('run_id')
			.notNull()
			.references(() => evalRun.id, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull(),
		kind: text('kind').$type<EvalEntryKind>().notNull(),
		fixtureRef: text('fixture_ref'),
		inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull().default({}),
		expectedJson: jsonb('expected_json').$type<Record<string, unknown>>().notNull().default({}),
		status: text('status').$type<EvalEntryStatus>().notNull().default('pending'),
		passed: boolean('passed'),
		resultJson: jsonb('result_json').$type<Record<string, unknown>>(),
		error: text('error'),
		durationMs: integer('duration_ms'),
		dependsOnEntryId: uuid('depends_on_entry_id'),
		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at')
	},
	(t) => [
		index('eval_entry_run_idx').on(t.runId),
		index('eval_entry_run_ordinal_idx').on(t.runId, t.ordinal)
	]
);

export type EvalEntry = typeof evalEntry.$inferSelect;

/** Append-only log for a run or entry (no file logs). */
export const evalEvent = pgTable(
	'eval_event',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		runId: uuid('run_id')
			.notNull()
			.references(() => evalRun.id, { onDelete: 'cascade' }),
		entryId: uuid('entry_id').references(() => evalEntry.id, { onDelete: 'cascade' }),
		level: text('level').notNull().default('info'),
		message: text('message').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('eval_event_run_idx').on(t.runId),
		index('eval_event_run_created_idx').on(t.runId, t.createdAt)
	]
);

export type EvalEvent = typeof evalEvent.$inferSelect;

/** Maps fixture ec_NNN ids to thought UUIDs within a run. */
export const evalThoughtMap = pgTable(
	'eval_thought_map',
	{
		runId: uuid('run_id')
			.notNull()
			.references(() => evalRun.id, { onDelete: 'cascade' }),
		fixtureId: text('fixture_id').notNull(),
		thoughtId: uuid('thought_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.runId, t.fixtureId] }),
		index('eval_thought_map_run_idx').on(t.runId)
	]
);

export type EvalThoughtMap = typeof evalThoughtMap.$inferSelect;

/** Reusable eval Q&A probe: captures, optional retrieval, optional edit, answer judge. */
export const evalQa = pgTable('eval_qa', {
	id: text('id').primaryKey(),
	question: text('question').notNull(),
	acceptance: text('acceptance').notNull(),
	capturesJson: jsonb('captures_json').$type<Record<string, unknown>[]>().notNull().default([]),
	retrievalQuery: text('retrieval_query'),
	retrievalRelevantJson: jsonb('retrieval_relevant_json')
		.$type<Array<{ id: string; grade: number }>>()
		.notNull()
		.default([]),
	tagsJson: jsonb('tags_json').$type<string[]>().notNull().default([]),
	editJson: jsonb('edit_json').$type<{ fixtureId: string; newRawText: string } | null>(),
	checksJson: jsonb('checks_json').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export type EvalQa = typeof evalQa.$inferSelect;
