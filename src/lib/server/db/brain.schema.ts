import {
	boolean,
	customType,
	date,
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
		rawInputEncrypted: text('raw_input_encrypted'),
		normalizedPreview: text('normalized_preview').notNull().default(''),
		normalizedPreviewEncrypted: text('normalized_preview_encrypted'),
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

export const enrichQueueStatusEnum = ['pending', 'processing', 'complete', 'failed'] as const;
export type EnrichQueueStatus = (typeof enrichQueueStatusEnum)[number];

export const captureSourceEnum = ['mcp', 'ui', 'api', 'eval', 'agent'] as const;
export type CaptureSource = (typeof captureSourceEnum)[number];

export const thought = pgTable(
	'thought',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rawText: text('raw_text').notNull(),
		rawTextEncrypted: text('raw_text_encrypted'),
		normalizedText: text('normalized_text').notNull(),
		normalizedTextEncrypted: text('normalized_text_encrypted'),
		/** NFKC-folded, lowercased, whitespace-collapsed — feed for `tsvector` / BM25-style search. */
		lexicalText: text('lexical_text').notNull().default(''),
		lexicalTsv: tsvector('lexical_tsv')
			.notNull()
			.generatedAlwaysAs(sql`to_tsvector('simple', coalesce(lexical_text, ''))`),
		category: text('category').notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		metadataEncrypted: text('metadata_encrypted'),
		// metadata.neverStale: true — exempt from Q&A staleness and salience decay
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
		cuesEncrypted: text('cues_encrypted'),
		/**
		 * Importance signal: starts at 1.0, boosted on retrieval access; consolidation
		 * recomputes decay/open-loop floors from elapsed time (see compute-salience.ts).
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
		/** Background enrich worker queue state (null = legacy row pre-tiered ingest). */
		enrichQueueStatus: text('enrich_queue_status').$type<EnrichQueueStatus>(),
		/** Set when enrich_queue_status is failed after retry exhaustion. */
		enrichQueueError: text('enrich_queue_error'),
		/** Surface that queued this row (mcp, ui, api, eval). */
		captureSource: text('capture_source').$type<CaptureSource>(),
		/** Incremented each time enrichment re-runs (e.g. relink). */
		enrichmentVersion: integer('enrichment_version').notNull().default(0),
		/** Pre-truncated excerpt for listwise rerank (set at enrich). */
		rerankSnippet: text('rerank_snippet'),
		/** Communities this thought is most associated with (L1–L2), set at consolidation. */
		primaryCommunityIds: uuid('primary_community_ids')
			.array()
			.notNull()
			.default(sql`ARRAY[]::uuid[]`),
		entityCentralityMax: real('entity_centrality_max').notNull().default(0),
		specificityScore: real('specificity_score').notNull().default(0),
		recencyBucket: real('recency_bucket').notNull().default(0),
		bundleRank: real('bundle_rank').notNull().default(0),
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
		index('thought_enrich_queue_idx').on(t.userId, t.enrichQueueStatus),
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

/**
 * User-scoped text documents (Keep-style notes). Not enriched like thoughts — no embedding,
 * category, or graph pipeline. Optionally linked to thoughts via `thought_text_file`.
 */
export const textFile = pgTable(
	'text_file',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull().default(''),
		bodyText: text('body_text').notNull(),
		bodyTextEncrypted: text('body_text_encrypted'),
		lexicalText: text('lexical_text').notNull().default(''),
		lexicalTsv: tsvector('lexical_tsv')
			.notNull()
			.generatedAlwaysAs(sql`to_tsvector('simple', coalesce(lexical_text, ''))`),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('text_file_user_updated_idx').on(t.userId, t.updatedAt),
		index('text_file_lexical_tsv_idx').using('gin', t.lexicalTsv)
	]
);

/** Many-to-many link between thoughts and user text files. */
export const thoughtTextFile = pgTable(
	'thought_text_file',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		thoughtId: uuid('thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		textFileId: uuid('text_file_id')
			.notNull()
			.references(() => textFile.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.thoughtId, t.textFileId], name: 'thought_text_file_pk' }),
		index('thought_text_file_user_idx').on(t.userId),
		index('thought_text_file_text_file_idx').on(t.textFileId)
	]
);

export type TextFile = typeof textFile.$inferSelect;

/** Prepaid Eigen platform credits per user (1000 credits = $1 USD). */
export const userWallet = pgTable('user_wallet', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	availableCredits: integer('available_credits').notNull().default(0),
	reservedCredits: integer('reserved_credits').notNull().default(0),
	/** Sub-cent USD charges accumulate here until whole credits are debited. */
	pendingBillingMicroUsd: integer('pending_billing_micro_usd').notNull().default(0),
	/** Audit only; PayPal settles in USD. Not shown in UI. */
	currency: text('currency').notNull().default('USD'),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

export const walletLedgerKindEnum = [
	'top_up',
	'usage_debit',
	'reservation_hold',
	'reservation_release',
	'adjustment'
] as const;
export type WalletLedgerKind = (typeof walletLedgerKindEnum)[number];

/** Append-only wallet ledger (credits positive, debits negative). */
export const walletLedgerEntry = pgTable(
	'wallet_ledger_entry',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<WalletLedgerKind>().notNull(),
		amountCredits: integer('amount_credits').notNull(),
		currency: text('currency').notNull(),
		referenceType: text('reference_type'),
		referenceId: text('reference_id'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('wallet_ledger_entry_user_idx').on(t.userId),
		index('wallet_ledger_entry_user_created_idx').on(t.userId, t.createdAt)
	]
);

export const paymentOrderStatusEnum = [
	'created',
	'approved',
	'captured',
	'failed',
	'cancelled'
] as const;
export type PaymentOrderStatus = (typeof paymentOrderStatusEnum)[number];

/** PayPal checkout orders for credit top-ups. */
export const paymentOrder = pgTable(
	'payment_order',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull().default('paypal'),
		paypalOrderId: text('paypal_order_id').notNull(),
		status: text('status').$type<PaymentOrderStatus>().notNull().default('created'),
		requestedCredits: integer('requested_credits').notNull(),
		capturedCredits: integer('captured_credits'),
		/** PayPal gross charge quoted at checkout (USD decimal string). */
		chargedGrossUsd: text('charged_gross_usd'),
		/** Base + platform markup target net before PayPal fees (USD decimal string). */
		platformSubtotalUsd: text('platform_subtotal_usd'),
		/** Estimated PayPal fee at order creation (USD decimal string). */
		estimatedPaypalFeeUsd: text('estimated_paypal_fee_usd'),
		/** Actual PayPal fee from capture breakdown (USD decimal string). */
		actualPaypalFeeUsd: text('actual_paypal_fee_usd'),
		/** Net USD received after PayPal fees (USD decimal string). */
		netReceivedUsd: text('net_received_usd'),
		currency: text('currency').notNull(),
		payerEmail: text('payer_email'),
		rawCapture: jsonb('raw_capture').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		uniqueIndex('payment_order_paypal_order_id_uidx').on(t.paypalOrderId),
		index('payment_order_user_idx').on(t.userId)
	]
);

export type PaymentOrder = typeof paymentOrder.$inferSelect;

/** Per-call pricing transparency (AC-013, AC-014). Amounts stored as decimal strings in USD. */
export const activityCallLog = pgTable(
	'activity_call_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		/** Hostname of the billable LLM gateway base URL (e.g. openrouter.ai); null for legacy rows. */
		gatewayHost: text('gateway_host'),
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

export const billingModeEnum = ['platform_credits', 'byok'] as const;
export type BillingMode = (typeof billingModeEnum)[number];

/** Per-user app preferences (settings page). */
export const userPreference = pgTable(
	'user_preference',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		preferredLanguage: text('preferred_language').notNull().default('en'),
		/** Paraglide UI locale (`en`, `de`, …). */
		preferredUiLocale: text('preferred_ui_locale').notNull().default('en'),
		preferredTranscriptionQuality: text('preferred_transcription_quality')
			.notNull()
			.default('low'),
		/** `platform_credits` (default) bills Eigen wallet; `byok` uses user gateway keys. */
		billingMode: text('billing_mode').$type<BillingMode>().notNull().default('platform_credits'),
		/** ISO 4217 currency code fallback when PayPal does not infer checkout currency. */
		defaultBillingCurrency: text('default_billing_currency').notNull().default('USD'),
		/** IANA timezone for temporal anchoring, agenda grouping, and reminders. */
		preferredTimezone: text('preferred_timezone'),
		eventNotificationsEnabled: boolean('event_notifications_enabled').notNull().default(false),
		eventReminderLeadMinutes: integer('event_reminder_lead_minutes').notNull().default(10),
		eventReminderKinds: jsonb('event_reminder_kinds')
			.$type<string[]>()
			.notNull()
			.default(['appointment', 'reminder', 'deadline']),
		/** Daily scheduling capacity for plan-week guardrails (default 8h). */
		dailyWorkMinutes: integer('daily_work_minutes').notNull().default(480),
		/** Morning timeline summary push at this local time (minutes from midnight). */
		dailySummaryEnabled: boolean('daily_summary_enabled').notNull().default(false),
		dailySummaryMinutesLocal: integer('daily_summary_minutes_local').notNull().default(480),
		/** YYYY-MM-DD in preferred timezone — last daily summary push sent. */
		lastDailySummaryLocalDate: text('last_daily_summary_local_date'),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('user_preference_language_idx').on(t.preferredLanguage),
		index('user_preference_ui_locale_idx').on(t.preferredUiLocale),
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

/**
 * Explicit user self-knowledge from grounding conversations (work, values, psychology, etc.).
 */
export const userGroundingProfile = pgTable('user_grounding_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	narrativeSummaryEncrypted: text('narrative_summary_encrypted'),
	facets: jsonb('facets').$type<Record<string, string>>().notNull().default({}),
	initialCompletedAt: timestamp('initial_completed_at'),
	lastSessionAt: timestamp('last_session_at'),
	sessionCount: integer('session_count').notNull().default(0),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

export type UserGroundingProfile = InferSelectModel<typeof userGroundingProfile>;

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

/** Materialized thought→entity links (from enrich); replaces AGE MENTIONS at query time. */
export const thoughtEntity = pgTable(
	'thought_entity',
	{
		thoughtId: uuid('thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => canonicalEntity.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		salience: real('salience').notNull().default(1),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.thoughtId, t.entityId], name: 'thought_entity_pk' }),
		index('thought_entity_user_idx').on(t.userId),
		index('thought_entity_entity_idx').on(t.entityId)
	]
);

export const projectStatusValues = ['active', 'someday', 'completed'] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];

export const projectProfileSourceValues = ['grounding', 'capture', 'manual'] as const;
export type ProjectProfileSource = (typeof projectProfileSourceValues)[number];

/** GTD project metadata keyed by canonical project entity. */
export const projectProfile = pgTable(
	'project_profile',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		projectEntityId: uuid('project_entity_id')
			.notNull()
			.references(() => canonicalEntity.id, { onDelete: 'cascade' }),
		status: text('status', { enum: projectStatusValues }).notNull().default('active'),
		source: text('source', { enum: projectProfileSourceValues }).notNull().default('capture'),
		nextActionThoughtId: uuid('next_action_thought_id').references(() => thought.id, {
			onDelete: 'set null'
		}),
		designatedAt: timestamp('designated_at'),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.projectEntityId], name: 'project_profile_pk' }),
		index('project_profile_user_idx').on(t.userId),
		index('project_profile_next_action_idx').on(t.nextActionThoughtId)
	]
);

/** Materialized 1-hop thought neighbors (from thought_relation); replaces AGE RELATES_TO at query time. */
export const thoughtNeighbor = pgTable(
	'thought_neighbor',
	{
		thoughtId: uuid('thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		neighborId: uuid('neighbor_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		weight: real('weight').notNull().default(1),
		relationType: text('relation_type').notNull().default('RELATES_TO'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.thoughtId, t.neighborId], name: 'thought_neighbor_pk' }),
		index('thought_neighbor_user_idx').on(t.userId),
		index('thought_neighbor_neighbor_idx').on(t.neighborId)
	]
);

/** Pre-ranked thoughts per entity for zero-traversal entity expansion. */
export const entityTopThoughts = pgTable(
	'entity_top_thoughts',
	{
		entityId: uuid('entity_id')
			.primaryKey()
			.references(() => canonicalEntity.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		thoughtIds: uuid('thought_ids')
			.array()
			.notNull()
			.default(sql`ARRAY[]::uuid[]`),
		ranks: real('ranks')
			.array()
			.notNull()
			.default(sql`ARRAY[]::real[]`),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('entity_top_thoughts_user_idx').on(t.userId)]
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
export const chatSessionModeEnum = ['default', 'grounding'] as const;
export type ChatSessionMode = (typeof chatSessionModeEnum)[number];

export const chatSession = pgTable(
	'chat_session',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull().default(''),
		mode: text('mode', { enum: chatSessionModeEnum }).notNull().default('default'),
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
	apiKeyEncrypted: text('api_key_encrypted'),
	/** EUrouter only: routing rule UUID for chat completions. */
	ruleChat: text('rule_chat'),
	/** EUrouter only: routing rule UUID for embeddings. */
	ruleEmbedding: text('rule_embedding'),
	/** OpenRouter only: model name for chat completions (e.g. openai/gpt-4o). */
	modelChat: text('model_chat'),
	/** OpenRouter only: model name for embeddings (e.g. qwen/qwen3-embedding-8b). */
	modelEmbedding: text('model_embedding'),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
}, (t) => [primaryKey({ columns: [t.userId, t.provider], name: 'llm_provider_config_pk' })]);

export const tenantDataKey = pgTable('tenant_data_key', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	wrappedDek: text('wrapped_dek').notNull(),
	dekVersion: integer('dek_version').notNull().default(1),
	kekProvider: text('kek_provider').notNull(),
	kekKeyId: text('kek_key_id').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

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
// Temporal memory (Postgres time-keeper + AGE context weaver)
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

export const temporalEventLifecycleStatusEnum = [
	'open',
	'completed',
	'cancelled',
	'dismissed'
] as const;
export type TemporalEventLifecycleStatus = (typeof temporalEventLifecycleStatusEnum)[number];

export const temporalTimePrecisionEnum = ['exact', 'day', 'week', 'month', 'fuzzy'] as const;
export type TemporalTimePrecision = (typeof temporalTimePrecisionEnum)[number];

export const temporalEnergyLevelEnum = ['light', 'medium', 'deep'] as const;
export type TemporalEnergyLevel = (typeof temporalEnergyLevelEnum)[number];

export const temporalPriorityQuadrantEnum = [
	'urgent_important',
	'not_urgent_important',
	'urgent_not_important',
	'neither'
] as const;
export type TemporalPriorityQuadrant = (typeof temporalPriorityQuadrantEnum)[number];

/**
 * Structured temporal facts extracted from thoughts. `active_period` is the
 * canonical overlap key for timeline slicing; AGE `Event` nodes mirror these rows.
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
		/** AGE Event node id; set when graph sync succeeds (defaults to row id). */
		graphNodeId: text('graph_node_id'),
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
		/** Scalar bounds for AGE graph reference (derived from active_period). */
		startAt: timestamp('start_at'),
		endAt: timestamp('end_at'),
		graphSyncStatus: text('graph_sync_status').notNull().default('pending'),
		graphSyncError: text('graph_sync_error'),
		lifecycleStatus: text('lifecycle_status')
			.$type<TemporalEventLifecycleStatus>()
			.notNull()
			.default('open'),
		lifecycleUpdatedAt: timestamp('lifecycle_updated_at').defaultNow().notNull(),
		snoozedUntil: timestamp('snoozed_until'),
		durationMinutes: integer('duration_minutes'),
		energyLevel: text('energy_level').$type<TemporalEnergyLevel>(),
		priorityQuadrant: text('priority_quadrant').$type<TemporalPriorityQuadrant>(),
		contextTags: text('context_tags').array(),
		parentEventId: uuid('parent_event_id'),
		focusRank: integer('focus_rank'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('temporal_event_user_idx').on(t.userId),
		index('temporal_event_lifecycle_idx').on(t.userId, t.lifecycleStatus),
		index('temporal_event_thought_idx').on(t.thoughtId),
		index('temporal_event_active_period_idx').using('gist', t.activePeriod),
		index('temporal_event_lexical_tsv_idx').using('gin', t.lexicalTsv),
		index('temporal_event_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
		index('temporal_event_graph_sync_idx').on(t.userId, t.graphSyncStatus)
	]
);

export type TemporalEvent = typeof temporalEvent.$inferSelect;

export const eventReminderScheduleStatusEnum = [
	'pending',
	'sent',
	'skipped',
	'cancelled'
] as const;
export type EventReminderScheduleStatus = (typeof eventReminderScheduleStatusEnum)[number];

/** Durable reminder fire times for proactive push notifications. */
export const eventReminderSchedule = pgTable(
	'event_reminder_schedule',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		temporalEventId: uuid('temporal_event_id')
			.notNull()
			.references(() => temporalEvent.id, { onDelete: 'cascade' }),
		fireAt: timestamp('fire_at').notNull(),
		leadMinutes: integer('lead_minutes').notNull(),
		status: text('status').$type<EventReminderScheduleStatus>().notNull().default('pending'),
		sentAt: timestamp('sent_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		uniqueIndex('event_reminder_schedule_event_lead_uidx').on(t.temporalEventId, t.leadMinutes),
		index('event_reminder_schedule_fire_idx').on(t.status, t.fireAt),
		index('event_reminder_schedule_user_idx').on(t.userId)
	]
);

export type EventReminderSchedule = typeof eventReminderSchedule.$inferSelect;

export const graphSyncJobStatusEnum = ['pending', 'processing', 'completed', 'failed'] as const;
export type GraphSyncJobStatus = (typeof graphSyncJobStatusEnum)[number];

export const graphSyncJobOperationEnum = ['upsert_temporal_event', 'delete_temporal_event'] as const;
export type GraphSyncJobOperation = (typeof graphSyncJobOperationEnum)[number];

/** Outbox for AGE graph writes after Postgres commit (deterministic retries). */
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
 * AGE entity graph. Level 0 = root (broadest), level 2 = leaf (tightest).
 * Generated by the nightly consolidation job.
 */
export const graphCommunity = pgTable(
	'graph_community',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** 0 = root/interpretive, 1 = domain/structural, 2 = leaf/factual */
		level: integer('level').notNull(),
		parentCommunityId: uuid('parent_community_id'),
		memberCount: integer('member_count').notNull().default(0),
		/** Set when membership changes; triggers incremental bundle/summary refresh. */
		dirtyAt: timestamp('dirty_at'),
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
 * Materialized community retrieval package — zero-traversal expansion at query time.
 */
export const communityBundle = pgTable(
	'community_bundle',
	{
		communityId: uuid('community_id')
			.primaryKey()
			.references(() => graphCommunity.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		level: integer('level').notNull(),
		topThoughtIds: uuid('top_thought_ids')
			.array()
			.notNull()
			.default(sql`ARRAY[]::uuid[]`),
		topEntityIds: uuid('top_entity_ids')
			.array()
			.notNull()
			.default(sql`ARRAY[]::uuid[]`),
		adjacentCommunityIds: uuid('adjacent_community_ids')
			.array()
			.notNull()
			.default(sql`ARRAY[]::uuid[]`),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		index('community_bundle_user_idx').on(t.userId),
		index('community_bundle_user_level_idx').on(t.userId, t.level)
	]
);

export type CommunityBundle = typeof communityBundle.$inferSelect;

/**
 * LLM-generated summaries for each community level.
 * L2 (leaf): factual — concrete themes from member thoughts.
 * L1 (domain): structural — synthesised from child leaf reports.
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
		/** Short routing summary (1–2 sentences); embedded in summary_embedding for ANN. */
		summaryShort: text('summary_short'),
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
// Nightly consolidation run ledger (no RLS — system operational metadata)
// ---------------------------------------------------------------------------

export const consolidationRunStatusEnum = ['running', 'completed', 'failed'] as const;
export type ConsolidationRunStatus = (typeof consolidationRunStatusEnum)[number];

/**
 * One row per calendar night (in consolidation cron TZ) for the global nightly sleep run.
 * Idempotency guard for pg_cron double-fires.
 */
export const consolidationRun = pgTable(
	'consolidation_run',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Calendar date in CONSOLIDATION_CRON_TZ when the nightly run started. */
		runNight: date('run_night').notNull(),
		status: text('status').$type<ConsolidationRunStatus>().notNull(),
		jobs: jsonb('jobs').$type<Record<string, unknown>>(),
		errorMessage: text('error_message'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		finishedAt: timestamp('finished_at')
	},
	(t) => [unique('consolidation_run_nightly_uidx').on(t.runNight)]
);

export type ConsolidationRun = typeof consolidationRun.$inferSelect;

// ---------------------------------------------------------------------------
// Per-user heartbeat run history (RLS — manual "Run now" + user-visible status)
// ---------------------------------------------------------------------------

export const heartbeatRunStatusEnum = ['running', 'completed', 'failed', 'cancelled'] as const;
export type HeartbeatRunStatus = (typeof heartbeatRunStatusEnum)[number];

export const heartbeatRun = pgTable(
	'heartbeat_run',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		status: text('status').$type<HeartbeatRunStatus>().notNull(),
		/** Ordered job names planned for this run (for progress UI). */
		plannedJobs: jsonb('planned_jobs').$type<string[]>(),
		/** Job name currently executing, if any. */
		currentJob: text('current_job'),
		cancelRequested: boolean('cancel_requested').notNull().default(false),
		jobs: jsonb('jobs').$type<Record<string, unknown>[]>().notNull().default([]),
		totalDurationMs: integer('total_duration_ms').notNull().default(0),
		errorMessage: text('error_message'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		finishedAt: timestamp('finished_at')
	},
	(t) => [index('heartbeat_run_user_started_idx').on(t.userId, t.startedAt)]
);

export type HeartbeatRun = typeof heartbeatRun.$inferSelect;

// ---------------------------------------------------------------------------
// Per-user scheduled tasks + job queue (app-defined; global ticker drains queue)
// ---------------------------------------------------------------------------

export const userScheduledTaskTypeEnum = ['overnight_consolidation'] as const;
export type UserScheduledTaskType = (typeof userScheduledTaskTypeEnum)[number];

/** Per-user schedule preferences stored in Postgres (not env / pg_cron). */
export const userScheduledTask = pgTable(
	'user_scheduled_task',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		taskType: text('task_type').$type<UserScheduledTaskType>().notNull(),
		/** Local hour (0–23) when the task should enqueue. */
		runHour: integer('run_hour').notNull().default(2),
		runMinute: integer('run_minute').notNull().default(0),
		timezone: text('timezone').notNull().default('UTC'),
		paused: boolean('paused').notNull().default(false),
		/** Last calendar night (in task timezone) we enqueued an overnight job. */
		lastEnqueuedNight: date('last_enqueued_night'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		unique('user_scheduled_task_user_type_uidx').on(t.userId, t.taskType),
		index('user_scheduled_task_user_idx').on(t.userId)
	]
);

export type UserScheduledTask = typeof userScheduledTask.$inferSelect;

export const userJobQueueStatusEnum = [
	'pending',
	'running',
	'completed',
	'failed',
	'cancelled'
] as const;
export type UserJobQueueStatus = (typeof userJobQueueStatusEnum)[number];

export const userJobTypeEnum = ['overnight_consolidation', 'webhook_delivery'] as const;
export type UserJobType = (typeof userJobTypeEnum)[number];

// ---------------------------------------------------------------------------
// Connected agents (Eigenmesh orchestration)
// ---------------------------------------------------------------------------

export const agentWebhookEventTypeEnum = [
	'thought.created',
	'thought.enriched',
	'thought.updated',
	'thought.deleted',
	'agent.task.assigned',
	'webhook.test'
] as const;
export type AgentWebhookEventType = (typeof agentWebhookEventTypeEnum)[number];

/** Subscribable thought-change events (excludes task assignment + test). */
export const agentSubscribableEventTypeEnum = [
	'thought.created',
	'thought.enriched',
	'thought.updated',
	'thought.deleted'
] as const;
export type AgentSubscribableEventType = (typeof agentSubscribableEventTypeEnum)[number];

/** User-registered external agent webhook endpoint. */
export const connectedAgent = pgTable(
	'connected_agent',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		webhookUrl: text('webhook_url').notNull(),
		subscribedEvents: text('subscribed_events')
			.array()
			.$type<AgentSubscribableEventType[]>()
			.notNull()
			.default([]),
		signingSecretEncrypted: text('signing_secret_encrypted').notNull(),
		signingSecretPrefix: text('signing_secret_prefix').notNull(),
		callbackTokenHash: text('callback_token_hash').notNull(),
		callbackTokenPrefix: text('callback_token_prefix').notNull(),
		enabled: boolean('enabled').notNull().default(true),
		lastDeliveryAt: timestamp('last_delivery_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('connected_agent_user_idx').on(t.userId)]
);

export type ConnectedAgent = typeof connectedAgent.$inferSelect;

export const agentTaskAssignmentStatusEnum = [
	'pending',
	'delivered',
	'in_progress',
	'completed',
	'failed'
] as const;
export type AgentTaskAssignmentStatus = (typeof agentTaskAssignmentStatusEnum)[number];

/** Links a thought (task) to a connected agent for orchestrated work. */
export const agentTaskAssignment = pgTable(
	'agent_task_assignment',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id')
			.notNull()
			.references(() => connectedAgent.id, { onDelete: 'cascade' }),
		thoughtId: uuid('thought_id')
			.notNull()
			.references(() => thought.id, { onDelete: 'cascade' }),
		status: text('status').$type<AgentTaskAssignmentStatus>().notNull().default('pending'),
		assignedAt: timestamp('assigned_at').defaultNow().notNull(),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		resultSummary: text('result_summary'),
		resultThoughtId: uuid('result_thought_id').references(() => thought.id, {
			onDelete: 'set null'
		}),
		lastError: text('last_error')
	},
	(t) => [
		index('agent_task_assignment_user_idx').on(t.userId),
		index('agent_task_assignment_agent_idx').on(t.agentId),
		index('agent_task_assignment_thought_idx').on(t.thoughtId)
	]
);

export type AgentTaskAssignment = typeof agentTaskAssignment.$inferSelect;

export const webhookDeliveryStatusEnum = ['pending', 'delivered', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatusEnum)[number];

/** Outbound webhook delivery ledger per agent event. */
export const webhookDelivery = pgTable(
	'webhook_delivery',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id')
			.notNull()
			.references(() => connectedAgent.id, { onDelete: 'cascade' }),
		eventType: text('event_type').$type<AgentWebhookEventType>().notNull(),
		eventId: text('event_id').notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
		attemptCount: integer('attempt_count').notNull().default(0),
		httpStatus: integer('http_status'),
		lastError: text('last_error'),
		deliveredAt: timestamp('delivered_at'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('webhook_delivery_user_idx').on(t.userId),
		index('webhook_delivery_agent_idx').on(t.agentId),
		index('webhook_delivery_status_idx').on(t.status, t.createdAt)
	]
);

export type WebhookDelivery = typeof webhookDelivery.$inferSelect;

/** Links an agent to specific projects — agents with bindings only receive events from bound projects. */
export const agentProjectBinding = pgTable(
	'agent_project_binding',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id')
			.notNull()
			.references(() => connectedAgent.id, { onDelete: 'cascade' }),
		projectEntityId: uuid('project_entity_id')
			.notNull()
			.references(() => canonicalEntity.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('agent_project_binding_user_idx').on(t.userId),
		index('agent_project_binding_agent_idx').on(t.agentId),
		index('agent_project_binding_project_idx').on(t.projectEntityId)
	]
);

export type AgentProjectBinding = typeof agentProjectBinding.$inferSelect;

/** Per-user background work queue drained by the global app ticker. */
export const userJobQueue = pgTable(
	'user_job_queue',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		jobType: text('job_type').$type<UserJobType>().notNull(),
		status: text('status').$type<UserJobQueueStatus>().notNull().default('pending'),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		runAfter: timestamp('run_after').notNull(),
		/** Idempotency key (e.g. overnight:2026-06-23). */
		dedupeKey: text('dedupe_key'),
		attemptCount: integer('attempt_count').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(3),
		lastError: text('last_error'),
		heartbeatRunId: uuid('heartbeat_run_id').references(() => heartbeatRun.id, {
			onDelete: 'set null'
		}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at')
	},
	(t) => [
		index('user_job_queue_pending_idx').on(t.status, t.runAfter),
		index('user_job_queue_user_status_idx').on(t.userId, t.status, t.createdAt),
		uniqueIndex('user_job_queue_active_dedupe_uidx')
			.on(t.userId, t.dedupeKey)
			.where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} IN ('pending', 'running')`)
	]
);

export type UserJobQueue = typeof userJobQueue.$inferSelect;

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
		/** Shared corpus brain tenant; thoughts persist across runs for this operator. */
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

/** Web Push subscription for a user device (VAPID). */
export const pushSubscription = pgTable(
	'push_subscription',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		uniqueIndex('push_subscription_endpoint_uidx').on(t.endpoint),
		index('push_subscription_user_idx').on(t.userId)
	]
);

export type PushSubscription = typeof pushSubscription.$inferSelect;
