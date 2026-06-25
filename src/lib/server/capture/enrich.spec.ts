import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichThought, reenrichThought, scheduleEnrichThought, scheduleReenrichThought } from './enrich';

const {
	getDbMock,
	withDbUserMock,
	extractRelationsMock,
	syncEntityGraphFromThoughtMock,
	syncTemporalEventsFromThoughtMock,
	extractThoughtMetadataMock,
	maybeRefreshUserOntologyMock,
	upsertThoughtRelationMock,
	deleteThoughtOutgoingGraphEdgesMock,
	deleteThoughtOutgoingRelatesToEdgesMock,
	materializeRetrievalLinksForThoughtMock,
	scheduleIncrementalConsolidationMock,
	syncThoughtNeighborLinksMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	withDbUserMock: vi.fn(),
	extractRelationsMock: vi.fn(),
	syncEntityGraphFromThoughtMock: vi.fn(),
	syncTemporalEventsFromThoughtMock: vi.fn(),
	extractThoughtMetadataMock: vi.fn(),
	maybeRefreshUserOntologyMock: vi.fn(),
	upsertThoughtRelationMock: vi.fn(),
	deleteThoughtOutgoingGraphEdgesMock: vi.fn(),
	deleteThoughtOutgoingRelatesToEdgesMock: vi.fn(),
	materializeRetrievalLinksForThoughtMock: vi.fn(),
	scheduleIncrementalConsolidationMock: vi.fn(),
	syncThoughtNeighborLinksMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock,
	withDbUser: withDbUserMock
}));
vi.mock('$lib/server/memory/relation-extraction', () => ({ extractRelations: extractRelationsMock }));
vi.mock('$lib/server/memory/entity-graph-sync', () => ({ syncEntityGraphFromThought: syncEntityGraphFromThoughtMock }));
vi.mock('$lib/server/memory/temporal-graph-sync', () => ({
	syncTemporalEventsFromThought: syncTemporalEventsFromThoughtMock
}));
vi.mock('$lib/server/memory/extract-thought-metadata', () => ({
	extractThoughtMetadata: extractThoughtMetadataMock
}));
vi.mock('$lib/server/ontology', () => ({ maybeRefreshUserOntology: maybeRefreshUserOntologyMock }));
vi.mock('$lib/server/graph/age', () => ({
	upsertThoughtRelation: upsertThoughtRelationMock,
	deleteThoughtOutgoingGraphEdges: deleteThoughtOutgoingGraphEdgesMock,
	deleteThoughtOutgoingRelatesToEdges: deleteThoughtOutgoingRelatesToEdgesMock
}));
vi.mock('$lib/server/retrieval/materialize-links', () => ({
	materializeRetrievalLinksForThought: materializeRetrievalLinksForThoughtMock,
	syncThoughtNeighborLinks: syncThoughtNeighborLinksMock
}));
vi.mock('$lib/server/consolidation/incremental-consolidation', () => ({
	scheduleIncrementalConsolidation: scheduleIncrementalConsolidationMock
}));

function makeDb(overrides: Partial<{
	updateResult: unknown;
	transactionResult: unknown;
	createdAt: Date | null;
	updateThrowsOnCall?: number[];
	updateThrowsReasonOnCall?: Record<number, unknown>;
	updateThrowsOnEnrichedAtNull?: boolean;
}> = {}) {
	let updateCall = 0;
	const updateChain = {
		set: vi.fn((values: Record<string, unknown>) => ({
			where: vi.fn(async () => {
				updateCall += 1;
				if (overrides.updateThrowsOnEnrichedAtNull && values.enrichedAt === null) {
					throw new Error('failed to clear enriched_at');
				}
				const reason = overrides.updateThrowsReasonOnCall?.[updateCall];
				if (reason !== undefined) {
					throw reason;
				}
				if (overrides.updateThrowsOnCall?.includes(updateCall)) {
					throw new Error(`update failed on call ${updateCall}`);
				}
				return overrides.updateResult ?? undefined;
			})
		}))
	};
	const selectLimit = vi.fn(async () =>
		overrides.createdAt === null
			? []
			: [{ createdAt: overrides.createdAt ?? new Date('2026-06-02T09:00:00.000Z') }]
	);
	const selectWhere = vi.fn(() => ({ limit: selectLimit }));
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const selectFn = vi.fn(() => ({ from: selectFrom }));
	return {
		update: vi.fn(() => updateChain),
		select: selectFn,
		transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
			cb({
				delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
				insert: vi.fn(() => ({ values: vi.fn(async () => []) }))
			})
		)
	};
}

describe('enrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 1, projectLikeEntities: [] });
		syncTemporalEventsFromThoughtMock.mockResolvedValue(undefined);
		extractThoughtMetadataMock.mockResolvedValue({
			memoryType: 'episode',
			cues: ['cue one', 'cue two']
		});
		maybeRefreshUserOntologyMock.mockResolvedValue(undefined);
		materializeRetrievalLinksForThoughtMock.mockResolvedValue(undefined);
		syncThoughtNeighborLinksMock.mockResolvedValue(0);
		deleteThoughtOutgoingRelatesToEdgesMock.mockResolvedValue(undefined);
		withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => fn());
	});

	it('increments enrichment_version on entry regardless of step outcomes', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello world');

		// First update call is the enrichment_version bump
		expect(db.update).toHaveBeenCalled();
	});

	it('clears outgoing RELATES_TO edges during scheduled relation extraction', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello world');

		await vi.waitFor(() => {
			expect(deleteThoughtOutgoingRelatesToEdgesMock).toHaveBeenCalledWith({
				userId: 'u1',
				thoughtId: 't1'
			});
		});
	});

	it('runs temporal sync after entity sync completes', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const order: string[] = [];
		syncEntityGraphFromThoughtMock.mockImplementation(async () => {
			order.push('entities');
			return { mentionCount: 1, projectLikeEntities: [] };
		});
		syncTemporalEventsFromThoughtMock.mockImplementation(async () => {
			order.push('temporal');
		});

		await enrichThought('u1', 't1', 'hello world');

		expect(order.indexOf('entities')).toBeGreaterThanOrEqual(0);
		expect(order.indexOf('temporal')).toBeGreaterThan(order.indexOf('entities'));
	});

	it('passes thought.createdAt as capturedAt to temporal sync', async () => {
		const capturedAt = new Date('2026-06-02T09:00:00.000Z');
		const db = makeDb({ createdAt: capturedAt });
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'ich würde heute nachmittag die app trennen');

		expect(syncTemporalEventsFromThoughtMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				thoughtId: 't1',
				capturedAt,
				timezone: 'Europe/Berlin'
			})
		);
	});

	it('awaits relation extraction after core enrich completes', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractRelationsMock.mockResolvedValue([
			{ targetId: 'target-1', relationType: 'related_to' }
		]);

		await enrichThought('u1', 't1', 'hello world');

		expect(extractRelationsMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello world'
		});
		expect(upsertThoughtRelationMock).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: 't1', targetId: 'target-1' })
		);
		expect(syncThoughtNeighborLinksMock).toHaveBeenCalledWith('u1', 't1');
	});

	it('calls entity graph sync', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello world', { thoughtEmbedding: [0.1, 0.2] });

		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello world'
		});
	});

	it('extracts and persists bundled metadata (memory type + cues)', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractThoughtMetadataMock.mockResolvedValue({
			memoryType: 'decision',
			cues: ['option B decision', 'choice made']
		});

		await enrichThought('u1', 't1', 'I decided to go with option B');

		expect(extractThoughtMetadataMock).toHaveBeenCalledWith({
			userId: 'u1',
			normalizedText: 'I decided to go with option B'
		});
	});

	it('triggers ontology refresh when thoughtCountAfterInsert is provided', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello', { thoughtCountAfterInsert: 10 });

		expect(maybeRefreshUserOntologyMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', thoughtCountAfterInsert: 10 })
		);
	});

	it('does not call ontology refresh when thoughtCountAfterInsert is absent', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello');

		expect(maybeRefreshUserOntologyMock).not.toHaveBeenCalled();
	});

	it('sets enriched_at when all steps succeed', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello');

		// The last update call sets enriched_at (allOk=true path)
		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const enrichedAtCall = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				'enrichedAt' in (args[0] as Record<string, unknown>)
		);
		expect(enrichedAtCall).toBeDefined();
	});

	it('clears enriched_at when entity sync fails on substantive text', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 0, projectLikeEntities: [] });
		const longText =
			'MIS TLIF L4-L5 after intraoperative AP fluoroscopy degraded. StealthArray navigation: registration anchored on paired L4 transverse processes with RMS error 1.6 mm.';

		await expect(enrichThought('u1', 't1', longText)).rejects.toThrow(/Enrichment step\(s\) failed/);

		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const enrichedAtSet = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				'enrichedAt' in (args[0] as Record<string, unknown>) &&
				(args[0] as { enrichedAt?: unknown }).enrichedAt !== null
		);
		expect(enrichedAtSet).toBeUndefined();
		const cleared = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				(args[0] as { enrichedAt?: unknown }).enrichedAt === null
		);
		expect(cleared).toBeDefined();
	});

	it('does not set enriched_at when a step fails', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractThoughtMetadataMock.mockRejectedValue(new Error('boom'));

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(
			/Enrichment step\(s\) failed:.*metadata: boom/
		);

		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const enrichedAtCall = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				'enrichedAt' in (args[0] as Record<string, unknown>)
		);
		expect(enrichedAtCall).toBeUndefined();
	});

	it('emits progress phases for each enrichment step', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await enrichThought('u1', 't1', 'hello', {
			onProgress: async (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			},
			thoughtCountAfterInsert: 10
		});
		maybeRefreshUserOntologyMock.mock.calls[0]?.[0]?.onBeforeEval?.();

		expect(phases).toContain('relations');
		expect(phases).toContain('entities');
		expect(phases).toContain('memory_type');
		expect(phases).toContain('cues');
	});

	it('continues enriching remaining steps when one step throws', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractThoughtMetadataMock.mockRejectedValue(new Error('metadata failed'));

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(/metadata failed/);

		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalled();
		expect(syncTemporalEventsFromThoughtMock).toHaveBeenCalled();
	});

	it('continues when enrichment_version bump fails', async () => {
		const db = makeDb({ updateThrowsOnCall: [1] });
		getDbMock.mockReturnValue(db);

		await enrichThought('u1', 't1', 'hello');

		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalled();
	});

	it('falls back to current time when thought row is missing', async () => {
		const db = makeDb({ createdAt: null });
		getDbMock.mockReturnValue(db);
		const before = Date.now();

		await enrichThought('u1', 't1', 'hello world');

		const call = syncTemporalEventsFromThoughtMock.mock.calls[0]?.[0];
		expect(call?.capturedAt).toBeInstanceOf(Date);
		expect(call!.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
	});

	it('logs relation extraction failures without aborting enrich', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		extractRelationsMock.mockRejectedValueOnce(new Error('relations failed'));

		await enrichThought('u1', 't1', 'hello');

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] relation extraction failed',
			expect.objectContaining({ message: 'relations failed' })
		);
		errorSpy.mockRestore();
	});

	it('continues when clearing enriched_at after entity failure also fails', async () => {
		const db = makeDb({ updateThrowsOnEnrichedAtNull: true });
		getDbMock.mockReturnValue(db);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 0, projectLikeEntities: [] });
		const longText =
			'MIS TLIF L4-L5 after intraoperative AP fluoroscopy degraded. StealthArray navigation: registration anchored on paired L4 transverse processes with RMS error 1.6 mm.';

		await expect(enrichThought('u1', 't1', longText)).rejects.toThrow(/Enrichment step\(s\) failed/);

		expect(warnSpy).toHaveBeenCalledWith(
			'[enrich] failed to clear enriched_at after entity step failure',
			expect.objectContaining({ thoughtId: 't1' })
		);
		warnSpy.mockRestore();
	});

	it('continues when ontology refresh fails', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		maybeRefreshUserOntologyMock.mockRejectedValue(new Error('ontology boom'));

		await enrichThought('u1', 't1', 'hello', { thoughtCountAfterInsert: 10 });

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] ontology refresh failed',
			expect.objectContaining({ thoughtId: 't1' })
		);
		errorSpy.mockRestore();
	});

	it('continues when retrieval link materialization fails', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		materializeRetrievalLinksForThoughtMock.mockRejectedValue('materialize failed');

		await enrichThought('u1', 't1', 'hello');

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] retrieval link materialization failed',
			expect.objectContaining({ message: 'materialize failed' })
		);
		expect(scheduleIncrementalConsolidationMock).toHaveBeenCalledWith('u1', 't1');
		errorSpy.mockRestore();
	});

	it('throws when enriched_at write fails after successful steps', async () => {
		const db = makeDb({ updateThrowsOnCall: [3] });
		getDbMock.mockReturnValue(db);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(
			/Failed to persist enriched_at/
		);

		expect(warnSpy).toHaveBeenCalledWith(
			'[enrich] enriched_at write failed (migration pending?)',
			expect.objectContaining({ thoughtId: 't1' })
		);
		expect(scheduleIncrementalConsolidationMock).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('omits cues from metadata update when extraction returns none', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		extractThoughtMetadataMock.mockResolvedValue({ memoryType: 'fact', cues: [] });

		await enrichThought('u1', 't1', 'hello');

		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const metadataUpdate = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				'memoryType' in (args[0] as Record<string, unknown>)
		);
		expect(metadataUpdate?.[0]).toEqual({ memoryType: 'fact' });
	});

	it('passes preloadedKnownEntities to entity graph sync', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const hints = [{ label: 'Marcus', entityType: 'person' }];

		await enrichThought('u1', 't1', 'hello', { preloadedKnownEntities: hints });

		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'hello',
			preloadedKnownEntities: hints
		});
	});

	it('passes thoughtEmbedding through scheduled relations and temporal sync', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const embedding = [0.1, 0.2, 0.3];

		await enrichThought('u1', 't1', 'hello world', { thoughtEmbedding: embedding });

		await vi.waitFor(() => {
			expect(extractRelationsMock).toHaveBeenCalledWith({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'hello world',
				embedding
			});
		});
		expect(syncTemporalEventsFromThoughtMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				thoughtId: 't1',
				thoughtEmbedding: embedding
			})
		);
	});

	it('does not fail entity step for short text with zero mentions', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 0, projectLikeEntities: [] });

		await enrichThought('u1', 't1', 'hi');

		const setCalls = (db.update().set as ReturnType<typeof vi.fn>).mock.calls;
		const cleared = setCalls.find(
			(args: unknown[]) =>
				args[0] &&
				typeof args[0] === 'object' &&
				(args[0] as { enrichedAt?: unknown }).enrichedAt === null
		);
		expect(cleared).toBeUndefined();
	});

	it('logs temporal step failure and throws', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		syncTemporalEventsFromThoughtMock.mockRejectedValue('temporal failed');

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(/temporal failed/);

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] temporal step failed',
			expect.objectContaining({ message: 'temporal failed' })
		);
		errorSpy.mockRestore();
	});

	it('logs metadata step failure and throws', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		extractThoughtMetadataMock.mockRejectedValue('metadata failed');

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(/metadata failed/);

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] metadata step failed',
			expect.objectContaining({ message: 'metadata failed' })
		);
		errorSpy.mockRestore();
	});

	it('logs non-Error enrichment_version bump failures', async () => {
		const db = makeDb({ updateThrowsReasonOnCall: { 1: 'version bump failed' } });
		getDbMock.mockReturnValue(db);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await enrichThought('u1', 't1', 'hello');

		expect(warnSpy).toHaveBeenCalledWith(
			'[enrich] enrichment_version bump failed (migration pending?)',
			expect.objectContaining({ message: 'version bump failed' })
		);
		warnSpy.mockRestore();
	});

	it('logs non-Error ontology refresh failures', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		maybeRefreshUserOntologyMock.mockRejectedValue('ontology string fail');

		await enrichThought('u1', 't1', 'hello', { thoughtCountAfterInsert: 10 });

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] ontology refresh failed',
			expect.objectContaining({ message: 'ontology string fail' })
		);
		errorSpy.mockRestore();
	});

	it('skips retrieval materialization when any enrichment step failed', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		syncTemporalEventsFromThoughtMock.mockRejectedValue(new Error('temporal boom'));

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(/temporal boom/);

		expect(materializeRetrievalLinksForThoughtMock).not.toHaveBeenCalled();
		expect(scheduleIncrementalConsolidationMock).not.toHaveBeenCalled();
	});

	it('logs non-Error failures when clearing enriched_at after entity failure', async () => {
		const db = makeDb({ updateThrowsReasonOnCall: { 3: 'clear failed' } });
		getDbMock.mockReturnValue(db);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 0, projectLikeEntities: [] });
		const longText =
			'MIS TLIF L4-L5 after intraoperative AP fluoroscopy degraded. StealthArray navigation: registration anchored on paired L4 transverse processes with RMS error 1.6 mm.';

		await expect(enrichThought('u1', 't1', longText)).rejects.toThrow(/Enrichment step\(s\) failed/);

		expect(warnSpy).toHaveBeenCalledWith(
			'[enrich] failed to clear enriched_at after entity step failure',
			expect.objectContaining({ message: 'clear failed' })
		);
		warnSpy.mockRestore();
	});

	it('logs non-Error retrieval materialization failures', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		materializeRetrievalLinksForThoughtMock.mockRejectedValue('materialize string fail');

		await enrichThought('u1', 't1', 'hello');

		expect(errorSpy).toHaveBeenCalledWith(
			'[enrich] retrieval link materialization failed',
			expect.objectContaining({ message: 'materialize string fail' })
		);
		expect(scheduleIncrementalConsolidationMock).toHaveBeenCalledWith('u1', 't1');
		errorSpy.mockRestore();
	});

	it('logs non-Error enriched_at write failures after successful steps', async () => {
		const db = makeDb({ updateThrowsReasonOnCall: { 3: 'enriched_at write failed' } });
		getDbMock.mockReturnValue(db);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(enrichThought('u1', 't1', 'hello')).rejects.toThrow(
			/Failed to persist enriched_at/
		);

		expect(warnSpy).toHaveBeenCalledWith(
			'[enrich] enriched_at write failed (migration pending?)',
			expect.objectContaining({ message: 'enriched_at write failed' })
		);
		expect(scheduleIncrementalConsolidationMock).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe('scheduleEnrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => fn());
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 1, projectLikeEntities: [] });
		syncTemporalEventsFromThoughtMock.mockResolvedValue(undefined);
		extractThoughtMetadataMock.mockResolvedValue({ memoryType: 'fact', cues: [] });
		materializeRetrievalLinksForThoughtMock.mockResolvedValue(undefined);
		getDbMock.mockReturnValue(makeDb());
	});

	it('runs enrichment on a dedicated RLS-scoped connection', async () => {
		scheduleEnrichThought('u1', 't1', 'hello');

		await vi.waitFor(() => {
			expect(withDbUserMock).toHaveBeenCalledWith('u1', expect.any(Function));
		});
		await vi.waitFor(() => {
			expect(extractRelationsMock).toHaveBeenCalled();
		});
	});

	it('logs when scheduled enrichment fails', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		withDbUserMock.mockRejectedValue('scheduled failed');

		scheduleEnrichThought('u1', 't1', 'hello');

		await vi.waitFor(() => {
			expect(errorSpy).toHaveBeenCalledWith(
				'[enrich] scheduled enrichment failed',
				expect.objectContaining({ message: 'scheduled failed' })
			);
		});
		errorSpy.mockRestore();
	});
});

describe('reenrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 1, projectLikeEntities: [] });
		syncTemporalEventsFromThoughtMock.mockResolvedValue(undefined);
		extractThoughtMetadataMock.mockResolvedValue({ memoryType: 'fact', cues: [] });
		maybeRefreshUserOntologyMock.mockResolvedValue(undefined);
		materializeRetrievalLinksForThoughtMock.mockResolvedValue(undefined);
		withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => fn());
		getDbMock.mockReturnValue(makeDb());
	});

	it('clears outgoing graph edges before enriching', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => fn());

		await reenrichThought('u1', 't1', 'hello world');

		expect(deleteThoughtOutgoingGraphEdgesMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1'
		});
		await vi.waitFor(() => {
			expect(extractRelationsMock).toHaveBeenCalled();
		});
	});

	it('runs edge clearing before scheduled relation extraction', async () => {
		const db = makeDb();
		getDbMock.mockReturnValue(db);
		withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => fn());

		const callOrder: string[] = [];
		deleteThoughtOutgoingGraphEdgesMock.mockImplementation(async () => {
			callOrder.push('delete_edges');
		});
		extractRelationsMock.mockImplementation(async () => {
			callOrder.push('relations');
			return [];
		});

		await reenrichThought('u1', 't1', 'hello world');

		await vi.waitFor(() => {
			expect(callOrder).toEqual(['delete_edges', 'relations']);
		});
	});
});

describe('scheduleReenrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => fn());
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue({ mentionCount: 1, projectLikeEntities: [] });
		syncTemporalEventsFromThoughtMock.mockResolvedValue(undefined);
		extractThoughtMetadataMock.mockResolvedValue({ memoryType: 'fact', cues: [] });
		materializeRetrievalLinksForThoughtMock.mockResolvedValue(undefined);
		getDbMock.mockReturnValue(makeDb());
	});

	it('runs re-enrichment on a dedicated RLS-scoped connection', async () => {
		scheduleReenrichThought('u1', 't1', 'hello');

		await vi.waitFor(() => {
			expect(withDbUserMock).toHaveBeenCalledWith('u1', expect.any(Function));
		});
		await vi.waitFor(() => {
			expect(deleteThoughtOutgoingGraphEdgesMock).toHaveBeenCalledWith({
				userId: 'u1',
				thoughtId: 't1'
			});
		});
	});

	it('logs when scheduled re-enrichment fails', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		withDbUserMock.mockRejectedValue(new Error('scheduled reenrich failed'));

		scheduleReenrichThought('u1', 't1', 'hello');

		await vi.waitFor(() => {
			expect(errorSpy).toHaveBeenCalledWith(
				'[enrich] scheduled re-enrichment failed',
				expect.objectContaining({ message: 'scheduled reenrich failed' })
			);
		});
		errorSpy.mockRestore();
	});

	it('logs non-Error when scheduled re-enrichment fails', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		withDbUserMock.mockRejectedValue('reenrich string fail');

		scheduleReenrichThought('u1', 't1', 'hello');

		await vi.waitFor(() => {
			expect(errorSpy).toHaveBeenCalledWith(
				'[enrich] scheduled re-enrichment failed',
				expect.objectContaining({ message: 'reenrich string fail' })
			);
		});
		errorSpy.mockRestore();
	});
});

