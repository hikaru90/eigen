import {
	boolean,
	customType,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
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

/**
 * Per-user entity kind definitions (ontology catalog). No TS closed union — keys are data.
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
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		unique('ontology_entity_kind_user_key_uidx').on(t.userId, t.key),
		index('ontology_entity_kind_user_idx').on(t.userId)
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
 * Per-user LLM gateway configuration. Takes priority over environment variables.
 * Stores the EUrouter base URL, API key, and routing rule UUIDs for chat and embeddings.
 */
export const llmConfig = pgTable('llm_config', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	llmBaseUrl: text('llm_base_url').notNull(),
	llmApiKey: text('llm_api_key').notNull(),
	llmRuleChat: text('llm_rule_chat'),
	llmRuleEmbedding: text('llm_rule_embedding'),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});
