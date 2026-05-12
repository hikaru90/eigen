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
	extractRelationsMock,
	syncEntityGraphFromThoughtMock,
	resolveThoughtCategoryMock,
	maybeRefreshUserOntologyMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	logActivityCallMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	upsertThoughtNodeMock: vi.fn(),
	upsertThoughtRelationMock: vi.fn(),
	deleteThoughtOutgoingGraphEdgesMock: vi.fn(),
	deleteThoughtVertexFromGraphMock: vi.fn(),
	extractRelationsMock: vi.fn(),
	syncEntityGraphFromThoughtMock: vi.fn(),
	resolveThoughtCategoryMock: vi.fn(),
	maybeRefreshUserOntologyMock: vi.fn()
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

vi.mock('$lib/server/memory/relation-extraction', () => ({
	extractRelations: extractRelationsMock
}));

vi.mock('$lib/server/memory/entity-graph-sync', () => ({
	syncEntityGraphFromThought: syncEntityGraphFromThoughtMock
}));

vi.mock('$lib/server/ontology', () => ({
	resolveThoughtCategory: resolveThoughtCategoryMock,
	maybeRefreshUserOntology: maybeRefreshUserOntologyMock
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
		category: 'perception',
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
		extractRelationsMock.mockResolvedValue([]);
		syncEntityGraphFromThoughtMock.mockResolvedValue(undefined);
		resolveThoughtCategoryMock.mockResolvedValue({ key: 'perception', ontologyEntityKindId: 'ek-1' });
		maybeRefreshUserOntologyMock.mockResolvedValue(undefined);
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
		expect(extractRelationsMock).toHaveBeenCalledTimes(1);
		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalledTimes(1);
		expect(maybeRefreshUserOntologyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				thoughtCountAfterInsert: 1
			})
		);
	});

	it('persists extracted relations to sql and falkor', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);
		extractRelationsMock.mockResolvedValue([{ targetId: 'target-1', relationType: 'related_to' }]);

		await captureThought('u1', 'raw input');
		expect(upsertThoughtRelationMock).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: 'thought-1', targetId: 'target-1' })
		);
		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalled();
	});

	it('reports ingest phases in pipeline order when onProgress is provided', async () => {
		const db = makeCaptureDb();
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await captureThought('u1', 'raw input', {
			onProgress: (p) => {
				phases.push(p);
			}
		});

		expect(phases).toEqual([
			'accounting',
			'ontology',
			'session',
			'embedding',
			'persist',
			'graph',
			'relations',
			'entities'
		]);
	});

	it('runs ontology refresh on every 10th thought and emits ontology_eval phase', async () => {
		const db = makeCaptureDb({ thoughtCountAfterInsert: 10 });
		getDbMock.mockReturnValue(db);
		maybeRefreshUserOntologyMock.mockImplementation(async (opts: { onBeforeEval?: () => void }) => {
			opts.onBeforeEval?.();
		});

		const phases: string[] = [];
		await captureThought('u1', 'raw input', {
			onProgress: (p) => phases.push(p)
		});

		expect(maybeRefreshUserOntologyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				thoughtCountAfterInsert: 10
			})
		);
		expect(phases.at(-1)).toBe('ontology_eval');
	});
});

describe('editStoredThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.5, 0.5]);
		extractRelationsMock.mockResolvedValue([]);
		resolveThoughtCategoryMock.mockResolvedValue({ key: 'perception', ontologyEntityKindId: 'ek-1' });
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

	it('updates and returns edited thought', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'hello',
			metadata: {},
			category: 'perception',
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
			})),
			transaction: vi.fn(async (cb: (txArg: unknown) => unknown) =>
				cb({
					delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
					insert: vi.fn(() => ({ values: vi.fn(async () => []) }))
				})
			)
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
		expect(extractRelationsMock).toHaveBeenCalledTimes(1);
		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalledTimes(1);
	});

	it('reports ingest phases for edits when onProgress is provided', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'hello',
			metadata: {},
			category: 'perception',
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
			})),
			transaction: vi.fn(async (cb: (txArg: unknown) => unknown) =>
				cb({
					delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
					insert: vi.fn(() => ({ values: vi.fn(async () => []) }))
				})
			)
		};
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		const result = await editStoredThought('u1', 't1', 'make shorter', {
			onProgress: (p) => phases.push(p)
		});
		expect(result.ok).toBe(true);
		expect(phases).toEqual(['accounting', 'ontology', 'embedding', 'persist', 'graph', 'relations', 'entities']);
	});
});

describe('relinkThoughtGraph', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractRelationsMock.mockResolvedValue([]);
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
		expect(deleteThoughtOutgoingGraphEdgesMock).not.toHaveBeenCalled();
	});

	it('clears Falkor edges, upserts node, and re-syncs relations and entities', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'hello',
			normalizedText: 'hello',
			lexicalText: 'hello',
			category: 'perception',
			metadata: {}
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			transaction: vi.fn(async (cb: (txArg: unknown) => unknown) =>
				cb({
					delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
					insert: vi.fn(() => ({ values: vi.fn(async () => []) }))
				})
			)
		};
		getDbMock.mockReturnValue(db);

		const result = await relinkThoughtGraph('u1', 't1');
		expect(result.ok).toBe(true);
		expect(deleteThoughtOutgoingGraphEdgesMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1'
		});
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 't1', normalizedText: 'hello' })
		);
		expect(extractRelationsMock).toHaveBeenCalledTimes(1);
		expect(syncEntityGraphFromThoughtMock).toHaveBeenCalledTimes(1);
	});

	it('reports ingest phases when onProgress is provided', async () => {
		const existing = {
			id: 't1',
			userId: 'u1',
			rawText: 'x',
			normalizedText: 'x',
			lexicalText: 'x',
			category: 'perception',
			metadata: {}
		};
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [existing])
					}))
				}))
			})),
			transaction: vi.fn(async (cb: (txArg: unknown) => unknown) =>
				cb({
					delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
					insert: vi.fn(() => ({ values: vi.fn(async () => []) }))
				})
			)
		};
		getDbMock.mockReturnValue(db);

		const phases: string[] = [];
		await relinkThoughtGraph('u1', 't1', { onProgress: (p) => phases.push(p) });
		expect(phases).toEqual(['accounting', 'graph', 'relations', 'entities']);
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

	it('deletes Falkor vertex then Postgres row', async () => {
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
