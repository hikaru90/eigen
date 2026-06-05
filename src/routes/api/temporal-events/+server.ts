import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { temporalEvent, thought } from '$lib/server/db/schema';
import type { ThoughtLifecycleStatus } from '$lib/server/capture/apply-thought-edit';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';

const LIST_CAP = 200;

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
	thoughtId: string;
	thoughtText: string;
	thoughtCategory: string;
	thoughtStatus: ThoughtLifecycleStatus;
	createdAt: string;
};

function thoughtStatusFromMetadata(metadata: Record<string, unknown>): ThoughtLifecycleStatus {
	return metadata.status === 'completed' ? 'completed' : 'open';
}

export type TemporalEventsResponse = {
	items: TemporalEventListItem[];
};

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

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
		.where(eq(temporalEvent.userId, user.id))
		.orderBy(desc(temporalEvent.startAt))
		.limit(LIST_CAP);

	const items: TemporalEventListItem[] = await Promise.all(
		rows.map(async (r) => {
			const [thoughtText, metadataJson] = await Promise.all([
				r.thoughtTextEncrypted
					? decryptTenantValue({
							userId: user.id,
							table: 'thought',
							column: 'normalized_text',
							ciphertext: r.thoughtTextEncrypted
						})
					: Promise.resolve(r.thoughtText),
				r.thoughtMetadataEncrypted
					? decryptTenantValue({
							userId: user.id,
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
				thoughtId: r.thoughtId,
				thoughtText,
				thoughtCategory: r.thoughtCategory,
				thoughtStatus: thoughtStatusFromMetadata(metadata),
				createdAt: r.createdAt.toISOString()
			};
		})
	);

	return json({ items } satisfies TemporalEventsResponse);
};
