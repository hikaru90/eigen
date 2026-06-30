import { and, desc, eq, gte, inArray, lt, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, projectProfile, temporalEvent, thought, thoughtEntity } from '$lib/server/db/schema';
import type { ThoughtLifecycleStatus } from '$lib/server/capture/apply-thought-edit';
import type {
	TemporalEnergyLevel,
	TemporalEventKind,
	TemporalEventLifecycleStatus,
	TemporalPriorityQuadrant
} from '$lib/server/db/brain.schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { computeFocusRank } from '$lib/server/memory/compute-focus-rank';

export const OPEN_LOOP_ITEM_PREFIX = 'open-loop:';

export const RELEVANT_LOOKAHEAD_DAYS = 7;
export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;

export type TimelineItemType = 'event' | 'open_loop';

export type TemporalEventListItem = {
	id: string;
	itemType: TimelineItemType;
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
	recurrenceRule: string | null;
	durationMinutes: number | null;
	energyLevel: TemporalEnergyLevel | null;
	priorityQuadrant: TemporalPriorityQuadrant | null;
	contextTags: string[];
	focusRank: number | null;
	parentEventId: string | null;
	thoughtId: string;
	thoughtText: string;
	thoughtCategory: string;
	thoughtStatus: ThoughtLifecycleStatus;
	memoryType: string | null;
	projectLabel: string | null;
	completedAt: string | null;
	lifecycleUpdatedAt: string | null;
	createdAt: string;
};

export type TemporalEventListQuery = {
	userId: string;
	range?: 'relevant' | 'upcoming' | 'past' | 'all';
	status?: 'open' | 'all';
	kinds?: string[];
	includeOpenLoops?: boolean;
	limit?: number;
	cursorStartAt?: string | null;
	cursorId?: string | null;
	orderBy?: 'ingest' | 'todo';
};

export function isOpenLoopListItem(item: TemporalEventListItem): boolean {
	return item.itemType === 'open_loop' || item.id.startsWith(OPEN_LOOP_ITEM_PREFIX);
}

export function openLoopItemId(thoughtId: string): string {
	return `${OPEN_LOOP_ITEM_PREFIX}${thoughtId}`;
}

export function thoughtIdFromOpenLoopItemId(itemId: string): string | null {
	if (!itemId.startsWith(OPEN_LOOP_ITEM_PREFIX)) return null;
	return itemId.slice(OPEN_LOOP_ITEM_PREFIX.length);
}

function thoughtStatusFromMetadata(metadata: Record<string, unknown>): ThoughtLifecycleStatus {
	return metadata.status === 'completed' ? 'completed' : 'open';
}

function completedAtFromMetadata(metadata: Record<string, unknown>): string | null {
	const raw = metadata.completedAt;
	return typeof raw === 'string' && raw.trim() ? raw : null;
}

async function loadProjectLabelsByThoughtId(
	userId: string,
	thoughtIds: string[]
): Promise<Map<string, string>> {
	if (thoughtIds.length === 0) return new Map();

	const rows = await getDb()
		.select({
			thoughtId: thoughtEntity.thoughtId,
			label: canonicalEntity.label,
			salience: thoughtEntity.salience
		})
		.from(thoughtEntity)
		.innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
		.innerJoin(
			projectProfile,
			and(
				eq(projectProfile.projectEntityId, canonicalEntity.id),
				eq(projectProfile.userId, userId)
			)
		)
		.where(and(eq(thoughtEntity.userId, userId), inArray(thoughtEntity.thoughtId, thoughtIds)))
		.orderBy(desc(thoughtEntity.salience));

	const map = new Map<string, string>();
	for (const row of rows) {
		if (!map.has(row.thoughtId)) map.set(row.thoughtId, row.label);
	}
	return map;
}

function attachProjectLabels(
	items: TemporalEventListItem[],
	labels: Map<string, string>
): TemporalEventListItem[] {
	return items.map((item) => ({
		...item,
		projectLabel: labels.get(item.thoughtId) ?? null
	}));
}

function rangeCondition(range: TemporalEventListQuery['range'], now: Date): SQL | undefined {
	if (!range || range === 'all') return undefined;
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
	return or(
		gte(sql`coalesce(${temporalEvent.endAt}, ${temporalEvent.startAt})`, nowIso),
		and(gte(temporalEvent.startAt, now), lte(temporalEvent.startAt, lookahead))
	);
}

async function listOpenLoopThoughtsForUser(
	userId: string,
	status: TemporalEventListQuery['status']
): Promise<TemporalEventListItem[]> {
	const eventRows = await getDb()
		.select({ thoughtId: temporalEvent.thoughtId })
		.from(temporalEvent)
		.where(eq(temporalEvent.userId, userId));
	const eventThoughtIds = eventRows.map((r) => r.thoughtId);

	const conditions: SQL[] = [
		eq(thought.userId, userId),
		or(eq(thought.memoryType, 'open_loop'), eq(thought.category, 'task'))!
	];
	if (eventThoughtIds.length > 0) {
		conditions.push(notInArray(thought.id, eventThoughtIds));
	}

	const rows = await getDb()
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			category: thought.category,
			memoryType: thought.memoryType,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted,
			createdAt: thought.createdAt,
			updatedAt: thought.updatedAt
		})
		.from(thought)
		.where(and(...conditions))
		.orderBy(desc(thought.createdAt))
		.limit(100);

	const items: TemporalEventListItem[] = [];
	for (const r of rows) {
		const [thoughtText, metadataJson] = await Promise.all([
			r.normalizedTextEncrypted
				? decryptTenantValue({
						userId,
						table: 'thought',
						column: 'normalized_text',
						ciphertext: r.normalizedTextEncrypted
					})
				: Promise.resolve(r.normalizedText),
			r.metadataEncrypted
				? decryptTenantValue({
						userId,
						table: 'thought',
						column: 'metadata',
						ciphertext: r.metadataEncrypted
					})
				: Promise.resolve(JSON.stringify(r.metadata ?? {}))
		]);
		const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
		const thoughtStatus = thoughtStatusFromMetadata(metadata);
		if (status === 'open' && thoughtStatus !== 'open') continue;
		const completedAt = completedAtFromMetadata(metadata);

		const summary =
			thoughtText.length > 120 ? `${thoughtText.slice(0, 117).trim()}…` : thoughtText.trim();

		items.push({
			id: openLoopItemId(r.id),
			itemType: 'open_loop',
			kind: 'reminder',
			semanticSummary: summary,
			sourceTextSpan: null,
			timePrecision: 'fuzzy',
			timezone: 'UTC',
			isAllDay: false,
			confidence: 1,
			startAt: null,
			endAt: null,
			activePeriod: '',
			graphSyncStatus: 'n/a',
			graphSyncError: null,
			lifecycleStatus: thoughtStatus === 'completed' ? 'completed' : 'open',
			snoozedUntil: null,
			recurrenceRule: null,
			durationMinutes: null,
			energyLevel: null,
			priorityQuadrant: null,
			contextTags: [],
			focusRank: null,
			parentEventId: null,
			thoughtId: r.id,
			thoughtText,
			thoughtCategory: r.category,
			thoughtStatus,
			memoryType: r.memoryType,
			projectLabel: null,
			completedAt,
			lifecycleUpdatedAt: r.updatedAt.toISOString(),
			createdAt: r.createdAt.toISOString()
		});
	}
	return items;
}

function mapEventRow(
	r: {
		id: string;
		kind: string;
		semanticSummary: string;
		sourceTextSpan: string | null;
		timePrecision: string;
		timezone: string;
		isAllDay: boolean;
		confidence: number;
		startAt: Date | null;
		endAt: Date | null;
		activePeriod: unknown;
		graphSyncStatus: string;
		graphSyncError: string | null;
		lifecycleStatus: TemporalEventLifecycleStatus;
		snoozedUntil: Date | null;
		recurrenceRule: string | null;
		durationMinutes: number | null;
		energyLevel: TemporalEnergyLevel | null;
		priorityQuadrant: TemporalPriorityQuadrant | null;
		contextTags: string[] | null;
		focusRank: number | null;
		parentEventId: string | null;
		thoughtId: string;
		thoughtText: string;
		thoughtCategory: string;
		thoughtStatus: ThoughtLifecycleStatus;
		memoryType: string | null;
		completedAt: string | null;
		lifecycleUpdatedAt: Date | null;
		createdAt: Date;
	}
): TemporalEventListItem {
	return {
		id: r.id,
		itemType: 'event',
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
		recurrenceRule: r.recurrenceRule,
		durationMinutes: r.durationMinutes,
		energyLevel: r.energyLevel,
		priorityQuadrant: r.priorityQuadrant,
		contextTags: r.contextTags ?? [],
		focusRank: r.focusRank,
		parentEventId: r.parentEventId,
		thoughtId: r.thoughtId,
		thoughtText: r.thoughtText,
		thoughtCategory: r.thoughtCategory,
		thoughtStatus: r.thoughtStatus,
		memoryType: r.memoryType,
		projectLabel: null,
		completedAt: r.completedAt,
		lifecycleUpdatedAt: r.lifecycleUpdatedAt?.toISOString() ?? null,
		createdAt: r.createdAt.toISOString()
	};
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

	const kinds = query.kinds?.filter((k) => k.trim()) as TemporalEventKind[] | undefined;
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
			lifecycleUpdatedAt: temporalEvent.lifecycleUpdatedAt,
			snoozedUntil: temporalEvent.snoozedUntil,
			recurrenceRule: temporalEvent.recurrenceRule,
			durationMinutes: temporalEvent.durationMinutes,
			energyLevel: temporalEvent.energyLevel,
			priorityQuadrant: temporalEvent.priorityQuadrant,
			contextTags: temporalEvent.contextTags,
			focusRank: temporalEvent.focusRank,
			parentEventId: temporalEvent.parentEventId,
			thoughtId: temporalEvent.thoughtId,
			thoughtText: thought.normalizedText,
			thoughtTextEncrypted: thought.normalizedTextEncrypted,
			thoughtCategory: thought.category,
			thoughtMetadata: thought.metadata,
			thoughtMetadataEncrypted: thought.metadataEncrypted,
			thoughtMemoryType: thought.memoryType,
			createdAt: temporalEvent.createdAt
		})
		.from(temporalEvent)
		.innerJoin(thought, eq(temporalEvent.thoughtId, thought.id))
		.where(and(...conditions))
		.orderBy(
			query.orderBy === 'ingest'
				? desc(thought.createdAt)
				: desc(temporalEvent.startAt),
			desc(temporalEvent.id)
		)
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
			return mapEventRow({
				...r,
				thoughtText,
				thoughtStatus: thoughtStatusFromMetadata(metadata),
				memoryType: r.thoughtMemoryType,
				completedAt: completedAtFromMetadata(metadata),
				lifecycleUpdatedAt: r.lifecycleUpdatedAt
			});
		})
	);

	const hasMore = rows.length > limit;
	const last = page[page.length - 1];
	const nextCursor =
		hasMore && last?.startAt ? { startAt: last.startAt.toISOString(), id: last.id } : null;

	let merged = items;
	if (query.includeOpenLoops !== false && !query.cursorStartAt) {
		const openLoops = await listOpenLoopThoughtsForUser(query.userId, query.status ?? 'open');
		merged = [...items, ...openLoops];
	}

	const thoughtIds = [...new Set(merged.map((i) => i.thoughtId))];
	const projectLabels = await loadProjectLabelsByThoughtId(query.userId, thoughtIds);
	return { items: attachProjectLabels(merged, projectLabels), nextCursor };
}

export async function getTemporalEventListItemById(
	userId: string,
	eventId: string
): Promise<TemporalEventListItem | null> {
	const thoughtId = thoughtIdFromOpenLoopItemId(eventId);
	if (thoughtId) {
		const openLoops = await listOpenLoopThoughtsForUser(userId, 'all');
		return openLoops.find((i) => i.thoughtId === thoughtId) ?? null;
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
			lifecycleUpdatedAt: temporalEvent.lifecycleUpdatedAt,
			snoozedUntil: temporalEvent.snoozedUntil,
			recurrenceRule: temporalEvent.recurrenceRule,
			durationMinutes: temporalEvent.durationMinutes,
			energyLevel: temporalEvent.energyLevel,
			priorityQuadrant: temporalEvent.priorityQuadrant,
			contextTags: temporalEvent.contextTags,
			focusRank: temporalEvent.focusRank,
			parentEventId: temporalEvent.parentEventId,
			thoughtId: temporalEvent.thoughtId,
			thoughtText: thought.normalizedText,
			thoughtTextEncrypted: thought.normalizedTextEncrypted,
			thoughtCategory: thought.category,
			thoughtMetadata: thought.metadata,
			thoughtMetadataEncrypted: thought.metadataEncrypted,
			thoughtMemoryType: thought.memoryType,
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
	return mapEventRow({
		...r,
		thoughtText,
		thoughtStatus: thoughtStatusFromMetadata(metadata),
		memoryType: r.thoughtMemoryType,
		completedAt: completedAtFromMetadata(metadata),
		lifecycleUpdatedAt: r.lifecycleUpdatedAt
	});
}

/** Recompute and persist focus_rank for open events (called after enrich). */
export async function refreshFocusRanksForUser(
	userId: string,
	timeZone: string,
	now = new Date()
): Promise<void> {
	const { items } = await listTemporalEventsForUser({
		userId,
		status: 'open',
		range: 'all',
		includeOpenLoops: false
	});

	const db = getDb();
	for (const item of items) {
		if (item.itemType !== 'event') continue;
		const rank = computeFocusRank(item, now, timeZone);
		await db
			.update(temporalEvent)
			.set({ focusRank: rank, updatedAt: now })
			.where(and(eq(temporalEvent.id, item.id), eq(temporalEvent.userId, userId)));
	}
}
