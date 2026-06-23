import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { loadIngestKnownEntityHints } from '$lib/server/memory/entity-graph-hints';
import {
	captureThought,
	normalizeThoughtText,
	editStoredThought,
	setThoughtLifecycleStatus,
	relinkThoughtGraph,
	deleteThoughtForUser,
	listThoughts
} from './service';

const {
	queueCaptureMock,
	enrichQueuedThoughtMock,
	getDbMock,
	logActivityCallMock,
	createThoughtEmbeddingMock,
	upsertThoughtNodeMock,
	upsertThoughtRelationMock,
	removeThoughtGraphArtifactsMock,
	pruneCanonicalEntitiesWithNoThoughtLinksMock,
	resolveThoughtCategoryMock,
	enrichThoughtMock,
	reenrichThoughtMock,
	scheduleEnrichThoughtMock,
	applyThoughtEditRequestMock,
	loadThoughtCaptureResultMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	logActivityCallMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	upsertThoughtNodeMock: vi.fn(),
	upsertThoughtRelationMock: vi.fn(),
	removeThoughtGraphArtifactsMock: vi.fn(),
	pruneCanonicalEntitiesWithNoThoughtLinksMock: vi.fn(),
	resolveThoughtCategoryMock: vi.fn(),
	enrichThoughtMock: vi.fn(),
	reenrichThoughtMock: vi.fn(),
	scheduleEnrichThoughtMock: vi.fn(),
	applyThoughtEditRequestMock: vi.fn(),
	loadThoughtCaptureResultMock: vi.fn(),
	queueCaptureMock: vi.fn(),
	enrichQueuedThoughtMock: vi.fn()
}));

const defaultCaptureResult = {
	id: 'thought-1',
	normalizedText: 'raw input',
	category: 'task',
	metadata: { pipeline: 'ontology_llm_v1', categoryConfidence: 0.9, categoryAlternatives: [] },
	memoryType: null,
	cues: [],
	enrichedAt: null,
	entities: [],
	temporalEvents: [],
	linkedThoughts: [],
	attachedFiles: [],
	enrichmentComplete: false,
	queueStatus: 'pending' as const
};

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	encryptTenantValue: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
	decryptTenantValue: vi.fn(async ({ ciphertext }: { ciphertext: string }) =>
		ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext
	)
}));

vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/graph/age', () => ({
	upsertThoughtNode: upsertThoughtNodeMock,
	upsertThoughtRelation: upsertThoughtRelationMock,
	removeThoughtGraphArtifacts: removeThoughtGraphArtifactsMock
}));

vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
	pruneCanonicalEntitiesWithNoThoughtLinks: pruneCanonicalEntitiesWithNoThoughtLinksMock
}));

vi.mock('$lib/server/ontology', () => ({
	resolveThoughtCategory: resolveThoughtCategoryMock,
	maybeRefreshUserOntology: vi.fn()
}));

vi.mock('$lib/server/capture/apply-thought-edit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/capture/apply-thought-edit')>();
	return {
		...actual,
		applyThoughtEditRequest: applyThoughtEditRequestMock
	};
});

vi.mock('$lib/server/billing/usage-gate', () => ({
	assertCapturePipelineAffordable: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/memory/entity-graph-hints', () => ({
	loadIngestKnownEntityHints: vi.fn(async () => [])
}));

/**
 * Enrichment is mocked here; pipeline behavior is tested in enrich.spec.ts.
 */
vi.mock('$lib/server/capture/enrich', () => ({
	enrichThought: enrichThoughtMock,
	reenrichThought: reenrichThoughtMock,
	scheduleEnrichThought: scheduleEnrichThoughtMock
}));

vi.mock('$lib/server/capture/capture-result', () => ({
	loadThoughtCaptureResult: loadThoughtCaptureResultMock
}));

vi.mock('$lib/server/memory/project-next-action', () => ({
	clearNextActionIfCompleted: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/capture/queue-capture', () => ({
	queueCapture: queueCaptureMock
}));

vi.mock('$lib/server/capture/enrich-queued-thought', () => ({
	enrichQueuedThought: enrichQueuedThoughtMock
}));

describe('normalizeThoughtText', () => {
	it('normalizes whitespace and sets pipeline metadata', () => {
		const result = normalizeThoughtText('  hello   world  ');
		expect(result.normalized).toBe('hello world');
		expect(result.metadata.pipeline).toBe('ontology_llm_v1');
	});
});

function makeInsertReturning(value: unknown) {
	return {
		values: vi.fn(() => ({
			returning: vi.fn(async () => [value])
		}))
	};
}

function makeCaptureDb(
	overrides: {
		thoughtCountAfterInsert?: number;
		nearestDuplicate?: { id: string; normalizedText: string; distance: number };
		dedupFails?: boolean;
	} = {}
) {
	const thoughtCount = overrides.thoughtCountAfterInsert ?? 1;
	const sessionRow = { id: 'session-1' };
	const thoughtRow = {
		id: 'thought-1',
		userId: 'u1',
		rawText: 'raw input',
		normalizedText: 'raw input',
		lexicalText: 'raw input',
		category: 'task',
		metadata: {}
	};
	const insertCapture = makeInsertReturning(sessionRow);
	const insertThought = makeInsertReturning(thoughtRow);
	const tx = {
		insert: vi.fn((table: unknown) => {
			if (table && typeof table === 'object' && 'sourceThoughtId' in (table as Record<string, unknown>)) {
				return { values: vi.fn(async () => []) };
			}
			return insertThought;
		}),
		delete: vi.fn(() => ({ where: vi.fn(async () => []) }))
	};
	const dedupLimit = vi.fn(async () => {
		if (overrides.dedupFails) {
			throw new Error('dedup query failed');
		}
		return overrides.nearestDuplicate ? [overrides.nearestDuplicate] : [];
	});
	return {
		insert: vi.fn(() => insertCapture),
		transaction: vi.fn(async (cb: (txArg: unknown) => unknown) => cb(tx)),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => {
					const countResult = thoughtCount > 0 ? [{ n: thoughtCount }] : [];
					return {
						orderBy: vi.fn().mockReturnValue({
							limit: dedupLimit
						}),
						limit: vi.fn(async () => countResult),
						then: (onfulfilled: (v: typeof countResult) => unknown) =>
							Promise.resolve(countResult).then(onfulfilled)
					};
				})
			}))
		}))
	};
}

describe('captureThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queueCaptureMock.mockResolvedValue({
			thoughtId: 'thought-1',
			status: 'queued',
			normalizedText: 'raw input'
		});
		enrichQueuedThoughtMock.mockResolvedValue(undefined);
		loadThoughtCaptureResultMock.mockImplementation(async (_userId: string, thoughtId: string) => ({
			...defaultCaptureResult,
			id: thoughtId
		}));
	});

	it('queues capture and schedules background enrich by default', async () => {
		const stored = await captureThought('u1', 'raw input');

		expect(stored.id).toBe('thought-1');
		expect(queueCaptureMock).toHaveBeenCalledWith('u1', 'raw input', {
			source: 'api',
			skipWorker: false
		});
		expect(enrichQueuedThoughtMock).not.toHaveBeenCalled();
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 'thought-1');
	});

	it('awaits enrichQueuedThought when awaitEnrichment is true', async () => {
		await captureThought('u1', 'raw input', { awaitEnrichment: true });
		expect(queueCaptureMock).toHaveBeenCalledWith('u1', 'raw input', {
			source: 'api',
			skipWorker: true
		});
		expect(enrichQueuedThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			expect.objectContaining({ onProgress: undefined })
		);
	});

	it('emits tier-1 progress events on queue path', async () => {
		const phases: string[] = [];
		await captureThought('u1', 'raw input', {
			onProgress: async (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			}
		});

		expect(phases).toEqual(['accounting', 'session', 'persist', 'graph']);
	});

	it('returns capture result from loadThoughtCaptureResult', async () => {
		loadThoughtCaptureResultMock.mockResolvedValue({
			...defaultCaptureResult,
			normalizedText: 'captured normalized',
			metadata: { pipeline: 'ontology_llm_v1' }
		});

		const stored = await captureThought('u1', 'captured raw');

		expect(stored.normalizedText).toBe('captured normalized');
		expect(stored.metadata).toEqual(expect.objectContaining({ pipeline: 'ontology_llm_v1' }));
	});
});

describe('editStoredThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.5, 0.5]);
		resolveThoughtCategoryMock.mockResolvedValue({ key: 'task', ontologyEntityKindId: 'ek-1', confidence: 0.9, alternatives: [] });
		reenrichThoughtMock.mockResolvedValue(undefined);
		loadThoughtCaptureResultMock.mockImplementation(async (_userId: string, thoughtId: string) => ({
			...defaultCaptureResult,
			id: thoughtId,
			normalizedText: 'make shorter'
		}));
		applyThoughtEditRequestMock.mockImplementation(async (input: { existingRawText: string; editRequest: string }) => ({
			rawText: input.editRequest.includes('complete') ? input.existingRawText : input.editRequest,
			status: input.editRequest.includes('complete') ? ('completed' as const) : null,
			summary: input.editRequest.includes('complete') ? 'Marked complete' : 'Text updated'
		}));
	});

	it('returns not_found when thought does not exist', async () => {
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const result = await editStoredThought('u1', 'missing', 'edit me');
		expect(result).toEqual({ ok: false, reason: 'not_found' });
	});

	it('updates and returns edited thought after awaiting reenrichThought', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'hello',
			metadata: {},
			category: 'task',
			normalizedText: 'hello',
			lexicalText: 'hello'
		};
		const updated = {
			...existing,
			rawText: 'make shorter',
			normalizedText: 'make shorter',
			lexicalText: 'make shorter'
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const result = await editStoredThought('u1', 't1', 'make shorter');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.thought.id).toBe('t1');
		}
		expect(resolveThoughtCategoryMock).toHaveBeenCalledWith({
			userId: 'u1',
			normalized: 'make shorter',
			rawText: 'make shorter'
		});
		expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1);
		expect(upsertThoughtNodeMock).toHaveBeenCalledTimes(1);
		expect(reenrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			't1',
			'make shorter',
			expect.objectContaining({ thoughtEmbedding: [0.5, 0.5] })
		);
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 't1');
	});

	it('merges metadata when existing row has null decrypted metadata', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'Buy milk',
			metadata: null,
			metadataEncrypted: 'enc:null',
			category: 'task',
			normalizedText: 'Buy milk',
			lexicalText: 'buy milk'
		};
		const updated = { ...existing, metadata: { status: 'completed', lastEditSummary: 'Marked complete' } };
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		applyThoughtEditRequestMock.mockResolvedValue({
			rawText: 'Buy milk',
			status: 'completed',
			summary: 'Marked complete'
		});

		const result = await editStoredThought('u1', 't1', 'mark as completed');
		expect(result.ok).toBe(true);
		expect(applyThoughtEditRequestMock).not.toHaveBeenCalled();
	});

	it('merges metadata when existing row has null metadata', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'Buy milk',
			metadata: null,
			category: 'task',
			normalizedText: 'Buy milk',
			lexicalText: 'buy milk'
		};
		const updated = { ...existing, metadata: { status: 'completed', lastEditSummary: 'Marked complete' } };
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		applyThoughtEditRequestMock.mockResolvedValue({
			rawText: 'Buy milk',
			status: 'completed',
			summary: 'Marked complete'
		});

		const result = await editStoredThought('u1', 't1', 'mark as completed');
		expect(result.ok).toBe(true);
		expect(applyThoughtEditRequestMock).not.toHaveBeenCalled();
	});

	it('skips re-embed when completion-only edit leaves text unchanged', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'Buy milk',
			metadata: { status: 'open' },
			category: 'task',
			normalizedText: 'Buy milk',
			lexicalText: 'buy milk'
		};
		const updated = { ...existing, metadata: { status: 'completed', lastEditSummary: 'Marked complete' } };
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		applyThoughtEditRequestMock.mockResolvedValue({
			rawText: 'Buy milk',
			status: 'completed',
			summary: 'Marked complete'
		});

		const result = await editStoredThought('u1', 't1', 'mark as completed');
		expect(result.ok).toBe(true);
		expect(applyThoughtEditRequestMock).not.toHaveBeenCalled();
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(reenrichThoughtMock).not.toHaveBeenCalled();
		expect(upsertThoughtNodeMock).not.toHaveBeenCalled();
		expect(removeThoughtGraphArtifactsMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', thoughtId: 't1' })
		);
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 't1');
	});

	it('skips reenrich when LLM rewrites raw text but normalized body is unchanged on status change', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'Buy  milk',
			metadata: { status: 'open' },
			category: 'task',
			normalizedText: 'Buy milk',
			lexicalText: 'buy milk'
		};
		const updated = { ...existing, metadata: { status: 'completed', lastEditSummary: 'Marked complete' } };
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		applyThoughtEditRequestMock.mockResolvedValue({
			rawText: 'Buy milk',
			status: 'completed',
			summary: 'Marked complete'
		});

		const result = await editStoredThought('u1', 't1', 'please shorten and mark done');
		expect(result.ok).toBe(true);
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(reenrichThoughtMock).not.toHaveBeenCalled();
	});

	it('reports fast-path ingest phases for edits when onProgress is provided', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'hello',
			metadata: {},
			category: 'task',
			normalizedText: 'hello',
			lexicalText: 'hello'
		};
		const updated = {
			...existing,
			rawText: 'make shorter',
			normalizedText: 'make shorter',
			lexicalText: 'make shorter'
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		const result = await editStoredThought('u1', 't1', 'make shorter', {
			onProgress: async (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			}
		});
		expect(result.ok).toBe(true);
		expect(phases).toEqual(['accounting', 'ontology', 'embedding', 'persist', 'graph']);
		expect(reenrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			't1',
			'make shorter',
			expect.objectContaining({ onProgress: expect.any(Function), thoughtEmbedding: [0.5, 0.5] })
		);
	});

	it('returns capture result from loadThoughtCaptureResult after text edit', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'plain',
			rawTextEncrypted: 'enc:hello',
			normalizedText: 'plain',
			normalizedTextEncrypted: 'enc:hello',
			metadata: null,
			metadataEncrypted: 'enc:{"status":"open"}',
			category: 'task',
			lexicalText: 'hello'
		};
		const updated = {
			...existing,
			rawText: 'make shorter',
			rawTextEncrypted: 'enc:make shorter',
			normalizedText: 'make shorter',
			normalizedTextEncrypted: 'enc:make shorter',
			lexicalText: 'make shorter',
			metadata: { status: 'open' }
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		loadThoughtCaptureResultMock.mockResolvedValue({
			...defaultCaptureResult,
			id: 't1',
			normalizedText: 'make shorter'
		});

		const result = await editStoredThought('u1', 't1', 'make shorter');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.thought.normalizedText).toBe('make shorter');
		}
	});
});

describe('setThoughtLifecycleStatus', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns not_found when thought is missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		});

		const result = await setThoughtLifecycleStatus('u1', 'missing', 'completed');
		expect(result).toEqual({ ok: false, reason: 'not_found' });
	});

	it('sets completed status and completedAt without LLM or re-embed', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'Buy milk',
			metadata: { status: 'open' },
			category: 'task',
			normalizedText: 'Buy milk',
			lexicalText: 'buy milk'
		};
		const updated = { ...existing, metadata: { status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' } };
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		loadThoughtCaptureResultMock.mockResolvedValue({
			...defaultCaptureResult,
			id: 't1',
			metadata: { status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' }
		});

		const result = await setThoughtLifecycleStatus('u1', 't1', 'completed');
		expect(result.ok).toBe(true);
		expect(applyThoughtEditRequestMock).not.toHaveBeenCalled();
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(reenrichThoughtMock).not.toHaveBeenCalled();
		expect(upsertThoughtNodeMock).not.toHaveBeenCalled();
		expect(removeThoughtGraphArtifactsMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', thoughtId: 't1' })
		);
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 't1');
	});

	it('reopens and clears completedAt', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'Buy milk',
			metadata: { status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' },
			category: 'task',
			normalizedText: 'Buy milk',
			lexicalText: 'buy milk'
		};
		const updated = { ...existing, metadata: { status: 'open' } };
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [updated])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		loadThoughtCaptureResultMock.mockResolvedValue({
			...defaultCaptureResult,
			id: 't1',
			metadata: { status: 'open' }
		});

		const result = await setThoughtLifecycleStatus('u1', 't1', 'open');
		expect(result.ok).toBe(true);
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 't1', userId: 'u1', category: 'task' })
		);
		expect(removeThoughtGraphArtifactsMock).not.toHaveBeenCalled();
		const updateCall = db.update.mock.results[0]?.value;
		const setArg = updateCall?.set.mock.calls[0]?.[0];
		expect(setArg.metadata.status).toBe('open');
		expect(setArg.metadata.completedAt).toBeUndefined();
	});
});

describe('relinkThoughtGraph', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reenrichThoughtMock.mockResolvedValue(undefined);
		loadThoughtCaptureResultMock.mockResolvedValue({
			...defaultCaptureResult,
			id: 't1',
			normalizedText: 'hello'
		});
	});

	it('returns not_found when thought does not exist', async () => {
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const result = await relinkThoughtGraph('u1', 'missing');
		expect(result).toEqual({ ok: false, reason: 'not_found' });
	});

	it('upserts node and awaits reenrichThought', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'hello',
			normalizedText: 'hello',
			lexicalText: 'hello',
			category: 'task',
			metadata: {}
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const result = await relinkThoughtGraph('u1', 't1');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.thought.normalizedText).toBe('hello');
		}
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 't1', userId: 'u1' })
		);
		expect(reenrichThoughtMock).toHaveBeenCalledWith('u1', 't1', 'hello', expect.any(Object));
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 't1');
	});

	it('reports fast-path ingest phases when onProgress is provided', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'x',
			normalizedText: 'x',
			lexicalText: 'x',
			category: 'task',
			metadata: {}
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await relinkThoughtGraph('u1', 't1', {
			onProgress: async (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			}
		});
		expect(phases).toEqual(['accounting', 'graph']);
		expect(reenrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			't1',
			'x',
			expect.objectContaining({ onProgress: expect.any(Function) })
		);
	});
});

describe('deleteThoughtForUser', () => {
	it('returns not_found when thought does not exist', async () => {
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);

		const result = await deleteThoughtForUser('u1', 'missing');
		expect(result).toEqual({ ok: false, reason: 'not_found' });
		expect(removeThoughtGraphArtifactsMock).not.toHaveBeenCalled();
	});

	it('removes graph artifacts, deletes Postgres row, and prunes orphan entities', async () => {
		const deleteWhere = vi.fn(async () => undefined);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [{ id: 't1' }])
					}))
				}))
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(async () => [{ entityId: 'e1' }, { entityId: 'e2' }])
				}))
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(async () => [{ id: 'ev1', graphNodeId: 'ev-graph-1' }])
				}))
			});
		const db = {
			select,
			delete: vi.fn(() => ({
				where: deleteWhere
			}))
		};
		getDbMock.mockReturnValue(db);
		removeThoughtGraphArtifactsMock.mockResolvedValue(undefined);
		pruneCanonicalEntitiesWithNoThoughtLinksMock.mockResolvedValue(2);

		const result = await deleteThoughtForUser('u1', 't1');
		expect(result).toEqual({ ok: true });
		expect(removeThoughtGraphArtifactsMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			temporalEventGraphIds: ['ev-graph-1']
		});
		expect(deleteWhere).toHaveBeenCalled();
		expect(pruneCanonicalEntitiesWithNoThoughtLinksMock).toHaveBeenCalledWith('u1', ['e1', 'e2']);
	});
});

describe('listThoughts', () => {
	function makeListDb(rows: unknown[]) {
		const limitSpy = vi.fn(async () => rows);
		return {
			db: {
				select: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: limitSpy
							}))
						}))
					}))
				}))
			},
			limitSpy
		};
	}

	it('clamps limit and applies ordering', async () => {
		const { db, limitSpy } = makeListDb([]);
		getDbMock.mockReturnValue(db);
		await listThoughts('u1', { limit: 999 });
		expect(limitSpy).toHaveBeenCalledWith(100);
	});

	it('applies cursor branch when cursor is provided', async () => {
		const { db, limitSpy } = makeListDb([]);
		getDbMock.mockReturnValue(db);
		await listThoughts('u1', { cursor: { createdAt: new Date('2026-01-01T00:00:00Z'), id: 't1' } });
		expect(limitSpy).toHaveBeenCalledWith(20);
	});

	it('returns decrypted full rows', async () => {
		const createdAt = new Date('2026-06-01T12:00:00.000Z');
		const { db } = makeListDb([
			{
				id: 't1',
				userId: 'u1',
				rawText: 'plain',
				rawTextEncrypted: 'enc:secret raw',
				normalizedText: 'plain',
				normalizedTextEncrypted: 'enc:secret normalized',
				category: 'task',
				metadata: null,
				metadataEncrypted: 'enc:{"status":"open"}',
				memoryType: 'fact',
				createdAt,
				updatedAt: createdAt
			}
		]);
		getDbMock.mockReturnValue(db);

		const rows = await listThoughts('u1');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual(
			expect.objectContaining({
				id: 't1',
				rawText: 'secret raw',
				normalizedText: 'secret normalized',
				metadata: { status: 'open' }
			})
		);
	});

	it('returns plain snippet rows without encrypted ciphertext', async () => {
		const createdAt = new Date('2026-06-01T12:00:00.000Z');
		const { db } = makeListDb([
			{
				id: 't1',
				normalizedText: 'plain snippet',
				category: 'task',
				memoryType: 'fact',
				createdAt
			}
		]);
		getDbMock.mockReturnValue(db);

		const rows = await listThoughts('u1', { fields: 'snippet', limit: 3 });
		expect(rows).toEqual([
			expect.objectContaining({
				id: 't1',
				normalizedText: 'plain snippet'
			})
		]);
	});

	it('returns decrypted snippet rows when fields is snippet', async () => {
		const createdAt = new Date('2026-06-01T12:00:00.000Z');
		const { db, limitSpy } = makeListDb([
			{
				id: 't1',
				normalizedText: 'plain',
				normalizedTextEncrypted: 'enc:snippet text',
				category: 'task',
				memoryType: 'fact',
				createdAt
			}
		]);
		getDbMock.mockReturnValue(db);

		const rows = await listThoughts('u1', {
			fields: 'snippet',
			limit: 5,
			cursor: { createdAt, id: 't0' }
		});

		expect(limitSpy).toHaveBeenCalledWith(5);
		expect(rows).toEqual([
			expect.objectContaining({
				id: 't1',
				normalizedText: 'snippet text'
			})
		]);
	});
});
