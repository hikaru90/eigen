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
	getDbMock,
	logActivityCallMock,
	createThoughtEmbeddingMock,
	upsertThoughtNodeMock,
	upsertThoughtRelationMock,
	deleteThoughtOutgoingGraphEdgesMock,
	deleteThoughtVertexFromGraphMock,
	resolveThoughtCategoryMock,
	enrichThoughtMock,
	reenrichThoughtMock,
	applyThoughtEditRequestMock,
	loadThoughtCaptureResultMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	logActivityCallMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	upsertThoughtNodeMock: vi.fn(),
	upsertThoughtRelationMock: vi.fn(),
	deleteThoughtOutgoingGraphEdgesMock: vi.fn(),
	deleteThoughtVertexFromGraphMock: vi.fn(),
	resolveThoughtCategoryMock: vi.fn(),
	enrichThoughtMock: vi.fn(),
	reenrichThoughtMock: vi.fn(),
	applyThoughtEditRequestMock: vi.fn(),
	loadThoughtCaptureResultMock: vi.fn()
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
	enrichmentComplete: false
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
	deleteThoughtOutgoingGraphEdges: deleteThoughtOutgoingGraphEdgesMock,
	deleteThoughtVertexFromGraph: deleteThoughtVertexFromGraphMock
}));

vi.mock('$lib/server/ontology', () => ({
	resolveThoughtCategory: resolveThoughtCategoryMock,
	maybeRefreshUserOntology: vi.fn()
}));

vi.mock('$lib/server/capture/apply-thought-edit', () => ({
	applyThoughtEditRequest: applyThoughtEditRequestMock
}));

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
	reenrichThought: reenrichThoughtMock
}));

vi.mock('$lib/server/capture/capture-result', () => ({
	loadThoughtCaptureResult: loadThoughtCaptureResultMock
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
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
		resolveThoughtCategoryMock.mockResolvedValue({ key: 'task', ontologyEntityKindId: 'ek-1', confidence: 0.9, alternatives: [] });
		enrichThoughtMock.mockResolvedValue(undefined);
		loadThoughtCaptureResultMock.mockImplementation(async (_userId: string, thoughtId: string) => ({
			...defaultCaptureResult,
			id: thoughtId
		}));
	});

	it('stores capture session, thought row, and graph node', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		const stored = await captureThought('u1', 'raw input');

		expect(stored.id).toBe('thought-1');
		expect(resolveThoughtCategoryMock).toHaveBeenCalledWith({
			userId: 'u1',
			normalized: 'raw input',
			rawText: 'raw input'
		});
		expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'raw input');
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'thought-1',
				userId: 'u1'
			})
		);
		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ thoughtEmbedding: [0.1, 0.2, 0.3] })
		);
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 'thought-1');
	});

	it('always awaits enrichThought before returning capture result', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');
		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ thoughtEmbedding: [0.1, 0.2, 0.3] })
		);
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 'thought-1');
	});

	it('forwards onProgress to enrichment when provided', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await captureThought('u1', 'raw input', {
			onProgress: async (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			}
		});

		expect(phases).toEqual([
			'accounting',
			'ontology',
			'embedding',
			'session',
			'persist',
			'graph'
		]);
		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ onProgress: expect.any(Function) })
		);
	});

	it('proceeds when dedup check fails', async () => {
		const db = makeCaptureDb({ dedupFails: true });
		getDbMock.mockReturnValue(db);

		const stored = await captureThought('u1', 'raw input');

		expect(stored.id).toBe('thought-1');
		expect(enrichThoughtMock).toHaveBeenCalled();
	});

	it('records near-duplicate metadata when a close neighbor exists', async () => {
		const db = makeCaptureDb({
			nearestDuplicate: {
				id: 'existing-1',
				normalizedText: 'raw input duplicate preview text',
				distance: 0.03
			}
		});
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');

		const metadataCall = vi.mocked(encryptTenantValue).mock.calls.find(
			(call) => call[0].table === 'thought' && call[0].column === 'metadata'
		);
		expect(metadataCall).toBeDefined();
		const metadata = JSON.parse(metadataCall![0].plaintext) as Record<string, unknown>;
		expect(metadata.nearDuplicate).toEqual(
			expect.objectContaining({
				id: 'existing-1',
				distance: 0.03,
				preview: 'raw input duplicate preview text'
			})
		);
	});

	it('returns capture result from loadThoughtCaptureResult', async () => {
		const thoughtRow = {
			id: 'thought-1',
			userId: 'u1',
			rawText: 'plain',
			rawTextEncrypted: 'enc:captured raw',
			normalizedText: 'plain',
			normalizedTextEncrypted: 'enc:captured normalized',
			lexicalText: 'captured normalized',
			category: 'task',
			metadata: null,
			metadataEncrypted: 'enc:{"pipeline":"ontology_llm_v1"}'
		};
		const insertThought = makeInsertReturning(thoughtRow);
		const db = makeCaptureDb();
		db.transaction = vi.fn(async (cb: (txArg: unknown) => unknown) => {
			const tx = {
				insert: vi.fn(() => insertThought),
				delete: vi.fn(() => ({ where: vi.fn(async () => []) }))
			};
			return cb(tx);
		});
		getDbMock.mockReturnValue(db);
		loadThoughtCaptureResultMock.mockResolvedValue({
			...defaultCaptureResult,
			normalizedText: 'captured normalized',
			metadata: { pipeline: 'ontology_llm_v1' }
		});

		const stored = await captureThought('u1', 'captured raw');

		expect(stored.normalizedText).toBe('captured normalized');
		expect(stored.metadata).toEqual(expect.objectContaining({ pipeline: 'ontology_llm_v1' }));
	});

	it('omits near-duplicate metadata when closest neighbor is outside threshold', async () => {
		const db = makeCaptureDb({
			nearestDuplicate: {
				id: 'existing-1',
				normalizedText: 'similar text',
				distance: 0.2
			}
		});
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');

		const metadataCall = vi.mocked(encryptTenantValue).mock.calls.find(
			(call) => call[0].table === 'thought' && call[0].column === 'metadata'
		);
		const metadata = JSON.parse(metadataCall![0].plaintext) as Record<string, unknown>;
		expect(metadata.nearDuplicate).toBeUndefined();
	});

	it('stringifies non-Error dedup failures in the warning log', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const db = makeCaptureDb();
		const dedupLimit = vi.fn(async () => {
			throw 'dedup string fail';
		});
		db.select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					orderBy: vi.fn().mockReturnValue({ limit: dedupLimit }),
					limit: vi.fn(async () => [{ n: 1 }]),
					then: (onfulfilled: (v: { n: number }[]) => unknown) =>
						Promise.resolve([{ n: 1 }]).then(onfulfilled)
				}))
			}))
		}));
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');

		expect(warnSpy).toHaveBeenCalledWith(
			'[capture.dedup] dedup check failed, proceeding',
			expect.objectContaining({ message: 'dedup string fail' })
		);
		warnSpy.mockRestore();
	});

	it('passes zero thought count to enrichment when count query returns no row', async () => {
		const db = makeCaptureDb({ thoughtCountAfterInsert: 0 });
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');

		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ thoughtCountAfterInsert: 0 })
		);
	});

	it('passes ingest known entities to category resolution when hints exist', async () => {
		const hints = [{ label: 'Marcus', entityType: 'person' }];
		vi.mocked(loadIngestKnownEntityHints).mockResolvedValue(hints);
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');

		expect(resolveThoughtCategoryMock).toHaveBeenCalledWith({
			userId: 'u1',
			normalized: 'raw input',
			rawText: 'raw input',
			knownEntities: hints
		});
		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ preloadedKnownEntities: hints })
		);
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
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(reenrichThoughtMock).not.toHaveBeenCalled();
		expect(loadThoughtCaptureResultMock).toHaveBeenCalledWith('u1', 't1');
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
		expect(deleteThoughtVertexFromGraphMock).not.toHaveBeenCalled();
	});

	it('deletes AGE graph vertex then Postgres row', async () => {
		const deleteWhere = vi.fn(async () => undefined);
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [{ id: 't1' }])
					}))
				}))
			})),
			delete: vi.fn(() => ({
				where: deleteWhere
			}))
		};
		getDbMock.mockReturnValue(db);

		const result = await deleteThoughtForUser('u1', 't1');
		expect(result).toEqual({ ok: true });
		expect(deleteThoughtVertexFromGraphMock).toHaveBeenCalledWith({ userId: 'u1', thoughtId: 't1' });
		expect(deleteWhere).toHaveBeenCalled();
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
