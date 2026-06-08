import { and, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { temporalEvent, thought } from '$lib/server/db/schema';
import type { ThoughtLifecycleStatus } from '$lib/server/capture/apply-thought-edit';
import type { TemporalEventLifecycleStatus } from '$lib/server/db/brain.schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';

export const RELEVANT_LOOKAHEAD_DAYS = 7;
export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;

export type TemporalEventListItem = {
	id: string;
	kind: string;
	semanticSummary: string;
	sourceTextSpan: string | null;
	timePrecision: string;
	timezone: string;
	isAllDay: boolean;
	confidence: number;
	startAt: string | null;
	endAt: string | null;
	activePeriod: string;
	graphSyncStatus: string;
	graphSyncError: string | null;
	lifecycleStatus: TemporalEventLifecycleStatus;
	snoozedUntil: string | null;
	thoughtId: string;
	thoughtText: string;
	thoughtCategory: string;
	thoughtStatus: ThoughtLifecycleStatus;
	createdAt: string;
};

export type TemporalEventListQuery = {
	userId: string;
	range?: 'relevant' | 'upcoming' | 'past' | 'all';
	status?: 'open' | 'all';
	kinds?: string[];
	limit?: number;
	cursorStartAt?: string | null;
	cursorId?: string | null;
};

function thoughtStatusFromMetadata(metadata: Record<string, unknown>): ThoughtLifecycleStatus {
	return metadata.status === 'completed' ? 'completed' : 'open';
}

function rangeCondition(range: TemporalEventListQuery['range'], now: Date): SQL | undefined {
	if (!range || range === 'all') return undefined;
	// postgres-js rejects Date objects embedded in sql`` fragments; use ISO strings there.
	const nowIso = now.toISOString();
	const lookahead = new Date(now.getTime() + RELEVANT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
	if (range === 'past') {
		return lt(sql`coalesce(${temporalEvent.startAt}, ${temporalEvent.createdAt})`, nowIso);
	}
	if (range === 'upcoming') {
		return gte(
			sql`coalesce(${temporalEvent.endAt}, ${temporalEvent.startAt}, ${temporalEvent.createdAt})`,
			nowIso
		);
	}
	// relevant: still active OR starts within the next 7 days
	return or(
		gte(sql`coalesce(${temporalEvent.endAt}, ${temporalEvent.startAt})`, nowIso),
		and(gte(temporalEvent.startAt, now), lte(temporalEvent.startAt, lookahead))
	);
}

export async function listTemporalEventsForUser(
	query: TemporalEventListQuery
): Promise<{ items: TemporalEventListItem[]; nextCursor: { startAt: string; id: string } | null }> {
	const now = new Date();
	const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
	const conditions: SQL[] = [eq(temporalEvent.userId, query.userId)];

	if (query.status === 'open') {
		conditions.push(eq(temporalEvent.lifecycleStatus, 'open'));
	}

	const kinds = query.kinds?.filter((k) => k.trim());
	if (kinds && kinds.length > 0) {
		conditions.push(inArray(temporalEvent.kind, kinds));
	}

	const rangeSql = rangeCondition(query.range ?? 'relevant', now);
	if (rangeSql) conditions.push(rangeSql);

	if (query.cursorStartAt && query.cursorId) {
		const cursorStart = new Date(query.cursorStartAt);
		conditions.push(
			or(
				lt(temporalEvent.startAt, cursorStart),
				and(eq(temporalEvent.startAt, cursorStart), lt(temporalEvent.id, query.cursorId))
			)!
		);
	}

	const rows = await getDb()
		.select({
			id: temporalEvent.id,
			kind: temporalEvent.kind,
			semanticSummary: temporalEvent.semanticSummary,
			sourceTextSpan: temporalEvent.sourceTextSpan,
			timePrecision: temporalEvent.timePrecision,
			timezone: temporalEvent.timezone,
			isAllDay: temporalEvent.isAllDay,
			confidence: temporalEvent.confidence,
			startAt: temporalEvent.startAt,
			endAt: temporalEvent.endAt,
			activePeriod: temporalEvent.activePeriod,
			graphSyncStatus: temporalEvent.graphSyncStatus,
			graphSyncError: temporalEvent.graphSyncError,
			lifecycleStatus: temporalEvent.lifecycleStatus,
			snoozedUntil: temporalEvent.snoozedUntil,
			thoughtId: temporalEvent.thoughtId,
			thoughtText: thought.normalizedText,
			thoughtTextEncrypted: thought.normalizedTextEncrypted,
			thoughtCategory: thought.category,
			thoughtMetadata: thought.metadata,
			thoughtMetadataEncrypted: thought.metadataEncrypted,
			createdAt: temporalEvent.createdAt
		})
		.from(temporalEvent)
		.innerJoin(thought, eq(temporalEvent.thoughtId, thought.id))
		.where(and(...conditions))
		.orderBy(desc(temporalEvent.startAt), desc(temporalEvent.id))
		.limit(limit + 1);

	const page = rows.slice(0, limit);
	const items: TemporalEventListItem[] = await Promise.all(
		page.map(async (r) => {
			const [thoughtText, metadataJson] = await Promise.all([
				r.thoughtTextEncrypted
					? decryptTenantValue({
							userId: query.userId,
							table: 'thought',
							column: 'normalized_text',
							ciphertext: r.thoughtTextEncrypted
						})
					: Promise.resolve(r.thoughtText),
				r.thoughtMetadataEncrypted
					? decryptTenantValue({
							userId: query.userId,
							table: 'thought',
							column: 'metadata',
							ciphertext: r.thoughtMetadataEncrypted
						})
					: Promise.resolve(JSON.stringify(r.thoughtMetadata ?? {}))
			]);
			const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
			return {
				id: r.id,
				kind: r.kind,
				semanticSummary: r.semanticSummary,
				sourceTextSpan: r.sourceTextSpan,
				timePrecision: r.timePrecision,
				timezone: r.timezone,
				isAllDay: r.isAllDay,
				confidence: r.confidence,
				startAt: r.startAt?.toISOString() ?? null,
				endAt: r.endAt?.toISOString() ?? null,
				activePeriod: String(r.activePeriod),
				graphSyncStatus: r.graphSyncStatus,
				graphSyncError: r.graphSyncError,
				lifecycleStatus: r.lifecycleStatus,
				snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
				thoughtId: r.thoughtId,
				thoughtText,
				thoughtCategory: r.thoughtCategory,
				thoughtStatus: thoughtStatusFromMetadata(metadata),
				createdAt: r.createdAt.toISOString()
			};
		})
	);

	const hasMore = rows.length > limit;
	const last = page[page.length - 1];
	const nextCursor =
		hasMore && last?.startAt
			? { startAt: last.startAt.toISOString(), id: last.id }
			: null;

	return { items, nextCursor };
}

export async function getTemporalEventListItemById(
	userId: string,
	eventId: string
): Promise<TemporalEventListItem | null> {
	const rows = await getDb()
		.select({
			id: temporalEvent.id,
			kind: temporalEvent.kind,
			semanticSummary: temporalEvent.semanticSummary,
			sourceTextSpan: temporalEvent.sourceTextSpan,
			timePrecision: temporalEvent.timePrecision,
			timezone: temporalEvent.timezone,
			isAllDay: temporalEvent.isAllDay,
			confidence: temporalEvent.confidence,
			startAt: temporalEvent.startAt,
			endAt: temporalEvent.endAt,
			activePeriod: temporalEvent.activePeriod,
			graphSyncStatus: temporalEvent.graphSyncStatus,
			graphSyncError: temporalEvent.graphSyncError,
			lifecycleStatus: temporalEvent.lifecycleStatus,
			snoozedUntil: temporalEvent.snoozedUntil,
			thoughtId: temporalEvent.thoughtId,
			thoughtText: thought.normalizedText,
			thoughtTextEncrypted: thought.normalizedTextEncrypted,
			thoughtCategory: thought.category,
			thoughtMetadata: thought.metadata,
			thoughtMetadataEncrypted: thought.metadataEncrypted,
			createdAt: temporalEvent.createdAt
		})
		.from(temporalEvent)
		.innerJoin(thought, eq(temporalEvent.thoughtId, thought.id))
		.where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.id, eventId)))
		.limit(1);

	const r = rows[0];
	if (!r) return null;

	const [thoughtText, metadataJson] = await Promise.all([
		r.thoughtTextEncrypted
			? decryptTenantValue({
					userId,
					table: 'thought',
					column: 'normalized_text',
					ciphertext: r.thoughtTextEncrypted
				})
			: Promise.resolve(r.thoughtText),
		r.thoughtMetadataEncrypted
			? decryptTenantValue({
					userId,
					table: 'thought',
					column: 'metadata',
					ciphertext: r.thoughtMetadataEncrypted
				})
			: Promise.resolve(JSON.stringify(r.thoughtMetadata ?? {}))
	]);
	const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
	return {
		id: r.id,
		kind: r.kind,
		semanticSummary: r.semanticSummary,
		sourceTextSpan: r.sourceTextSpan,
		timePrecision: r.timePrecision,
		timezone: r.timezone,
		isAllDay: r.isAllDay,
		confidence: r.confidence,
		startAt: r.startAt?.toISOString() ?? null,
		endAt: r.endAt?.toISOString() ?? null,
		activePeriod: String(r.activePeriod),
		graphSyncStatus: r.graphSyncStatus,
		graphSyncError: r.graphSyncError,
		lifecycleStatus: r.lifecycleStatus,
		snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
		thoughtId: r.thoughtId,
		thoughtText,
		thoughtCategory: r.thoughtCategory,
		thoughtStatus: thoughtStatusFromMetadata(metadata),
		createdAt: r.createdAt.toISOString()
	};
}
