import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	captureThought,
	normalizeThoughtText,
	editStoredThought,
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
	applyThoughtEditRequestMock
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
	applyThoughtEditRequestMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
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

vi.mock('$lib/server/graph/falkor', () => ({
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

/**
 * Enrich is fire-and-forget in service.ts. We mock the whole module so service
 * unit tests stay focused on the fast path. Enrichment pipeline is tested
 * separately in enrich.spec.ts.
 */
vi.mock('$lib/server/capture/enrich', () => ({
	enrichThought: enrichThoughtMock,
	reenrichThought: reenrichThoughtMock
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

function makeCaptureDb(overrides: { thoughtCountAfterInsert?: number } = {}) {
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
	return {
		insert: vi.fn(() => insertCapture),
		transaction: vi.fn(async (cb: (txArg: unknown) => unknown) => cb(tx)),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => {
					const result = [{ n: thoughtCount }];
					return {
						limit: vi.fn(async () => result),
						then: (onfulfilled: (v: typeof result) => unknown) => Promise.resolve(result).then(onfulfilled)
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
	});

	it('stores capture session, thought row, and graph node', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		const stored = await captureThought('u1', 'raw input');

		expect(stored.id).toBe('thought-1');
		expect(logActivityCallMock).toHaveBeenCalledTimes(1);
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
	});

	it('fires enrichThought as a side effect after persist', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		await captureThought('u1', 'raw input');

		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ thoughtEmbedding: [0.1, 0.2, 0.3] })
		);
	});

	it('awaits enrichment when onProgress is provided (UI path), emits fast-path phases', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await captureThought('u1', 'raw input', {
			onProgress: async (e) => {
				if (e.parallel) phases.push(...e.phases);
				else phases.push(e.phase);
			}
		});

		// Fast-path phases only (enrichment mock does not emit phases).
		// In production with onProgress, enrichThought is awaited and will add
		// relations/entities/memory_type/cues phases too.
		expect(phases).toEqual([
			'accounting',
			'ontology',
			'embedding',
			'session',
			'persist',
			'graph'
		]);
		// Verify enrichment was awaited (mock called synchronously before return).
		expect(enrichThoughtMock).toHaveBeenCalledWith(
			'u1',
			'thought-1',
			'raw input',
			expect.objectContaining({ onProgress: expect.any(Function) })
		);
	});
});

describe('editStoredThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.5, 0.5]);
		resolveThoughtCategoryMock.mockResolvedValue({ key: 'task', ontologyEntityKindId: 'ek-1', confidence: 0.9, alternatives: [] });
		reenrichThoughtMock.mockResolvedValue(undefined);
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

	it('updates and returns edited thought, fires reenrichThought', async () => {
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
	});
});

describe('relinkThoughtGraph', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reenrichThoughtMock.mockResolvedValue(undefined);
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

	it('upserts node and fires reenrichThought', async () => {
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
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 't1', userId: 'u1' })
		);
		expect(reenrichThoughtMock).toHaveBeenCalledWith('u1', 't1', 'hello');
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
	it('clamps limit and applies ordering', async () => {
		const limitSpy = vi.fn(async () => []);
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: limitSpy
						}))
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		await listThoughts('u1', { limit: 999 });
		expect(limitSpy).toHaveBeenCalledWith(100);
	});

	it('applies cursor branch when cursor is provided', async () => {
		const limitSpy = vi.fn(async () => []);
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: limitSpy
						}))
					}))
				}))
			}))
		};
		getDbMock.mockReturnValue(db);
		await listThoughts('u1', { cursor: { createdAt: new Date('2026-01-01T00:00:00Z'), id: 't1' } });
		expect(limitSpy).toHaveBeenCalledWith(20);
	});
});
