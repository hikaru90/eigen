import {
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	vector
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema';

const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector';
	}
});

/** Baseline ontology categories from requirements */
export const thoughtCategoryEnum = [
	'thought',
	'task',
	'idea',
	'reference',
	'date',
	'person'
] as const;
export type ThoughtCategory = (typeof thoughtCategoryEnum)[number];

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
		category: text('category').$type<ThoughtCategory>().notNull().default('thought'),
		metadataPreview: jsonb('metadata_preview').$type<Record<string, unknown>>().notNull().default({}),
		revisionCount: integer('revision_count').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('capture_session_user_idx').on(t.userId), index('capture_session_status_idx').on(t.status)]
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
		category: text('category').$type<ThoughtCategory>().notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		embedding: vector('embedding', { dimensions: 1536 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('thought_user_idx').on(t.userId),
		index('thought_lexical_tsv_idx').using('gin', t.lexicalTsv),
		index('thought_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))
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
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('thought_relation_user_idx').on(t.userId),
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
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [index('activity_call_log_user_idx').on(t.userId)]
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
