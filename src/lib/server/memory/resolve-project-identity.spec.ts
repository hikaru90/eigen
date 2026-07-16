import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	getDbMock,
	llmMock,
	loadProjectsMock,
	upsertHubMock,
	promoteTypeMock,
	fetchEdgesMock,
	upsertEntityNodeMock,
	decryptMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	llmMock: vi.fn(),
	loadProjectsMock: vi.fn(),
	upsertHubMock: vi.fn(),
	promoteTypeMock: vi.fn(),
	fetchEdgesMock: vi.fn(),
	upsertEntityNodeMock: vi.fn(),
	decryptMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }));
vi.mock('$lib/server/memory/project-list', () => ({
	loadEligibleGtdProjects: loadProjectsMock
}));
vi.mock('$lib/server/memory/project-entity', () => ({
	upsertGraphHubEntity: upsertHubMock,
	promoteHubEntityType: promoteTypeMock
}));
vi.mock('$lib/server/graph/age', () => ({
	fetchEntityEdgesForUser: fetchEdgesMock,
	upsertEntityNode: upsertEntityNodeMock
}));
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	decryptTenantValue: decryptMock
}));

import {
	buildIdentityPrompt,
	effectiveMergeEntityIds,
	loadProjectIdentityContext,
	mergeEntityIdsAllowedForMode,
	mergeProjectEntities,
	parseProjectIdentityPayload,
	resolveProjectIdentity,
	type ProjectIdentityContext
} from './resolve-project-identity';

const emptyContext: ProjectIdentityContext = {
	gtdProjects: [],
	hubCandidates: [],
	graphNeighborPairs: []
};

function thenableWhere(limitRows: unknown[], awaitRows: unknown[] = limitRows) {
	const asThenable = {
		limit: vi.fn(async () => limitRows),
		then(
			onFulfilled?: (value: unknown) => unknown,
			onRejected?: (error: unknown) => unknown
		) {
			return Promise.resolve(awaitRows).then(onFulfilled, onRejected);
		}
	};
	return {
		...asThenable,
		orderBy: vi.fn(() => ({
			limit: vi.fn(async () => limitRows),
			then: asThenable.then.bind(asThenable)
		})),
		groupBy: vi.fn(() => ({
			orderBy: vi.fn(() => ({
				limit: vi.fn(async () => awaitRows)
			}))
		})),
		innerJoin: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(async () => limitRows),
				orderBy: vi.fn(() => ({
					limit: vi.fn(async () => limitRows)
				})),
				groupBy: vi.fn(() => ({
					orderBy: vi.fn(() => ({
						limit: vi.fn(async () => awaitRows)
					}))
				})),
				then: asThenable.then.bind(asThenable)
			}))
		}))
	};
}

describe('resolve-project-identity merge policy', () => {
	it('mergeEntityIdsAllowedForMode allows merge only for seed and reconcile', () => {
		expect(mergeEntityIdsAllowedForMode('seed')).toBe(true);
		expect(mergeEntityIdsAllowedForMode('reconcile')).toBe(true);
		expect(mergeEntityIdsAllowedForMode('promote')).toBe(false);
		expect(mergeEntityIdsAllowedForMode('assign')).toBe(false);
	});

	it('effectiveMergeEntityIds strips ids for promote and assign', () => {
		expect(effectiveMergeEntityIds('promote', ['a', 'b'])).toEqual([]);
		expect(effectiveMergeEntityIds('assign', ['a'])).toEqual([]);
		expect(effectiveMergeEntityIds('seed', ['a', 'b'])).toEqual(['a', 'b']);
	});

	it('buildIdentityPrompt omits mergeEntityIds schema for promote mode', () => {
		const prompt = buildIdentityPrompt({
			surfaceLabel: 'Kitchen remodel',
			mode: 'promote',
			context: emptyContext
		});
		expect(prompt).not.toContain('mergeEntityIds');
		expect(prompt).toContain('remain separate projects');
	});

	it('buildIdentityPrompt includes mergeEntityIds schema for seed mode', () => {
		const prompt = buildIdentityPrompt({
			surfaceLabel: 'EigenMesh',
			mode: 'seed',
			context: emptyContext
		});
		expect(prompt).toContain('mergeEntityIds');
		expect(prompt).toContain('SAME multi-step initiative');
	});

	it('buildIdentityPrompt includes catalogs, neighbors, and thought id', () => {
		const prompt = buildIdentityPrompt({
			surfaceLabel: 'Eigen',
			mode: 'reconcile',
			thoughtId: 't1',
			context: {
				hubCandidates: [
					{
						entityId: 'h1',
						label: 'Eigen',
						entityType: 'organization',
						mentionCount: 3,
						linkedThoughtSummaries: ['Ship MVP']
					}
				],
				gtdProjects: [
					{
						entityId: 'p1',
						label: 'EigenMesh',
						status: 'active',
						openTaskCount: 2,
						source: 'capture'
					}
				],
				graphNeighborPairs: [
					{ sourceLabel: 'Eigen', targetLabel: 'Jonas', predicate: 'related_to' }
				]
			}
		});
		expect(prompt).toContain('Thought id: t1');
		expect(prompt).toContain('p1: EigenMesh');
		expect(prompt).toContain('h1: Eigen');
		expect(prompt).toContain('thoughts: Ship MVP');
		expect(prompt).toContain('Eigen --related_to--> Jonas');
	});
});

describe('parseProjectIdentityPayload', () => {
	const allowed = new Set(['e1', 'e2']);

	it('returns create-hub defaults for non-object raw', () => {
		expect(parseProjectIdentityPayload(null, allowed)).toEqual({
			canonicalEntityId: null,
			canonicalLabel: '',
			hubEntityType: 'organization',
			isGtdProject: false,
			shouldCreateHub: true,
			mergeEntityIds: []
		});
	});

	it('accepts snake_case keys and filters merge ids to the allowed set', () => {
		const parsed = parseProjectIdentityPayload(
			{
				canonical_entity_id: 'e1',
				canonical_label: ' EigenMesh ',
				hub_entity_type: 'product',
				is_gtd_project: true,
				should_create_hub: false,
				merge_entity_ids: ['e2', 'missing', 'bad id', 3]
			},
			allowed
		);
		expect(parsed).toEqual({
			canonicalEntityId: 'e1',
			canonicalLabel: 'EigenMesh',
			hubEntityType: 'product',
			isGtdProject: true,
			shouldCreateHub: false,
			mergeEntityIds: ['e2']
		});
	});

	it('rejects invalid canonical entity ids', () => {
		const parsed = parseProjectIdentityPayload(
			{ canonicalEntityId: 'not allowed', isGtdProject: true },
			allowed
		);
		expect(parsed.canonicalEntityId).toBeNull();
		expect(parsed.isGtdProject).toBe(true);
	});
});

describe('loadProjectIdentityContext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadProjectsMock.mockResolvedValue([
			{
				entityId: 'p1',
				label: 'EigenMesh',
				status: 'active',
				openTaskCount: 1,
				source: 'capture'
			}
		]);
		fetchEdgesMock.mockResolvedValue([
			{ sourceId: 'h1', targetId: 'p1', predicate: 'related_to' },
			{ sourceId: 'unknown', targetId: 'p1', predicate: 'mentions' }
		]);
		decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
			ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext
		);
	});

	it('builds hub candidates, hint label, summaries, and labeled neighbor pairs', async () => {
		const mentionRows = [
			{
				entityId: 'h1',
				label: 'Eigen',
				entityType: 'organization',
				mentionCount: 2
			}
		];
		const thoughtRows = [
			{
				normalizedText: null,
				normalizedTextEncrypted: `enc:${'x'.repeat(120)}`
			},
			{ normalizedText: '   ', normalizedTextEncrypted: null },
			{ normalizedText: 'Short note', normalizedTextEncrypted: null }
		];
		const hintRow = {
			entityId: 'hint1',
			label: 'Kitchen remodel',
			entityType: 'project'
		};

		let selectCall = 0;
		getDbMock.mockReturnValue({
			select: vi.fn(() => {
				selectCall += 1;
				if (selectCall === 1) {
					// mention aggregation
					return {
						from: vi.fn(() => ({
							innerJoin: vi.fn(() => ({
								where: vi.fn(() => ({
									groupBy: vi.fn(() => ({
										orderBy: vi.fn(() => ({
											limit: vi.fn(async () => mentionRows)
										}))
									}))
								}))
							}))
						}))
					};
				}
				if (selectCall === 2 || selectCall === 4) {
					// summarizeLinkedThoughts for hub / hint
					return {
						from: vi.fn(() => ({
							innerJoin: vi.fn(() => ({
								where: vi.fn(() => ({
									limit: vi.fn(async () => thoughtRows)
								}))
							}))
						}))
					};
				}
				// hint label lookup
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn(async () => [hintRow])
						}))
					}))
				};
			})
		});

		const ctx = await loadProjectIdentityContext('u1', 'Kitchen remodel');
		expect(ctx.gtdProjects).toHaveLength(1);
		expect(ctx.hubCandidates[0]?.entityId).toBe('hint1');
		expect(ctx.hubCandidates.some((c) => c.entityId === 'h1')).toBe(true);
		expect(ctx.hubCandidates.find((c) => c.entityId === 'h1')?.linkedThoughtSummaries[0]).toMatch(
			/…$/
		);
		expect(ctx.graphNeighborPairs).toEqual([
			{ sourceLabel: 'Eigen', targetLabel: 'EigenMesh', predicate: 'related_to' }
		]);
	});
});

describe('resolveProjectIdentity', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadProjectsMock.mockResolvedValue([]);
		fetchEdgesMock.mockResolvedValue([]);
		upsertHubMock.mockResolvedValue('new-hub');
		promoteTypeMock.mockResolvedValue(undefined);
		upsertEntityNodeMock.mockResolvedValue(undefined);
	});

	it('rejects blank surface labels', async () => {
		await expect(
			resolveProjectIdentity({ userId: 'u1', surfaceLabel: '  ', mode: 'assign' })
		).rejects.toThrow(/surfaceLabel is required/);
	});

	it('uses existing canonical entity id from LLM when present', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							groupBy: vi.fn(() => ({
								orderBy: vi.fn(() => ({
									limit: vi.fn(async () => [
										{
											entityId: 'h1',
											label: 'Eigen',
											entityType: 'organization',
											mentionCount: 1
										}
									])
								}))
							})),
							limit: vi.fn(async () => [
								{ normalizedText: 'note', normalizedTextEncrypted: null }
							])
						}))
					})),
					where: vi.fn(() =>
						thenableWhere([{ entityId: 'h1' }], [{ entityId: 'h1' }])
					)
				}))
			}))
		});
		llmMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							canonicalEntityId: 'h1',
							canonicalLabel: 'Eigen',
							hubEntityType: 'organization',
							isGtdProject: true,
							shouldCreateHub: false,
							mergeEntityIds: ['h1']
						})
					}
				}
			]
		});

		const result = await resolveProjectIdentity({
			userId: 'u1',
			surfaceLabel: 'Eigen',
			mode: 'assign',
			thoughtId: 't1'
		});

		expect(result.entityId).toBe('h1');
		expect(result.isGtdProject).toBe(true);
		expect(result.mergeEntityIds).toEqual([]);
		expect(upsertHubMock).not.toHaveBeenCalled();
	});

	it('creates a hub when LLM returns null canonical id', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							groupBy: vi.fn(() => ({
								orderBy: vi.fn(() => ({
									limit: vi.fn(async () => [])
								}))
							})),
							limit: vi.fn(async () => [])
						}))
					})),
					where: vi.fn(() => thenableWhere([], []))
				}))
			}))
		});
		llmMock.mockResolvedValue({
			choices: [
				{
					message: {
						content:
							'```json\n{"canonicalEntityId":null,"canonicalLabel":"","isGtdProject":false,"shouldCreateHub":true}\n```'
					}
				}
			]
		});

		const result = await resolveProjectIdentity({
			userId: 'u1',
			surfaceLabel: 'New Initiative',
			mode: 'seed'
		});

		expect(upsertHubMock).toHaveBeenCalledWith('u1', 'New Initiative', 'organization');
		expect(result.entityId).toBe('new-hub');
		expect(result.canonicalLabel).toBe('New Initiative');
	});

	it('throws when LLM content is missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							groupBy: vi.fn(() => ({
								orderBy: vi.fn(() => ({
									limit: vi.fn(async () => [])
								}))
							})),
							limit: vi.fn(async () => [])
						}))
					})),
					where: vi.fn(() => thenableWhere([], []))
				}))
			}))
		});
		llmMock.mockResolvedValue({ choices: [{}] });
		await expect(
			resolveProjectIdentity({ userId: 'u1', surfaceLabel: 'X', mode: 'promote' })
		).rejects.toThrow(/missing LLM content/);
	});
});

describe('mergeProjectEntities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		promoteTypeMock.mockResolvedValue(undefined);
		upsertEntityNodeMock.mockResolvedValue(undefined);
	});

	it('no-ops when loser list is empty after filtering winner', async () => {
		await mergeProjectEntities('u1', 'winner', ['winner']);
		expect(getDbMock).not.toHaveBeenCalled();
	});

	it('refuses to merge manual losers and returns when only manuals remain', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						thenableWhere([{ entityId: 'loser1', source: 'manual' }], [
							{ entityId: 'loser1', source: 'manual' }
						])
					)
				}))
			}))
		});

		await mergeProjectEntities('u1', 'winner', ['loser1']);
		expect(errorSpy).toHaveBeenCalledWith(
			'[merge-projects] Refusing to merge manual projects',
			expect.objectContaining({
				manualLosers: ['loser1']
			})
		);
		errorSpy.mockRestore();
	});

	it('throws when winner hub is missing', async () => {
		let selectCall = 0;
		getDbMock.mockReturnValue({
			select: vi.fn(() => {
				selectCall += 1;
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => {
							if (selectCall === 1) {
								return thenableWhere([], []); // no manual losers
							}
							return thenableWhere([], []); // winner missing
						})
					}))
				};
			})
		});

		await expect(mergeProjectEntities('u1', 'winner', ['loser1'])).rejects.toThrow(
			/winner winner not found/
		);
	});

	it('merges non-manual losers: relinks thoughts, aliases, and demotes project status', async () => {
		const insertMock = vi.fn(() => ({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(async () => undefined)
			}))
		}));
		const updateMock = vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async () => undefined)
			}))
		}));
		const deleteMock = vi.fn(() => ({
			where: vi.fn(async () => undefined)
		}));

		let selectCall = 0;
		getDbMock.mockReturnValue({
			select: vi.fn(() => {
				selectCall += 1;
				const n = selectCall;
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => {
							if (n === 1) {
								// manual safeguard query
								return thenableWhere([{ entityId: 'loser1', source: 'capture' }], [
									{ entityId: 'loser1', source: 'capture' }
								]);
							}
							if (n === 2) {
								// winner row
								return thenableWhere(
									[
										{
											id: 'winner',
											label: 'Old',
											canonicalKey: 'old',
											entityType: 'organization',
											source: 'capture'
										}
									],
									[]
								);
							}
							if (n === 3) {
								// loser rows
								return thenableWhere(
									[],
									[
										{
											id: 'loser1',
											canonicalKey: 'eigenmesh',
											label: 'EigenMesh'
										}
									]
								);
							}
							if (n === 4) {
								// thought links
								return thenableWhere([], [{ thoughtId: 't1' }]);
							}
							if (n === 5) {
								// loser project
								return thenableWhere(
									[
										{
											nextActionThoughtId: 'na1',
											status: 'active',
											source: 'capture'
										}
									],
									[]
								);
							}
							// winner project missing -> adopt loser project fields
							return thenableWhere([], []);
						})
					}))
				};
			}),
			insert: insertMock,
			update: updateMock,
			delete: deleteMock
		});

		await mergeProjectEntities('u1', 'winner', ['loser1'], 'Eigen');

		expect(insertMock).toHaveBeenCalled();
		expect(deleteMock).toHaveBeenCalled();
		expect(updateMock).toHaveBeenCalled();
		expect(promoteTypeMock).toHaveBeenCalledWith('u1', 'winner', 'Eigen');
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'winner', label: 'Eigen', entityType: 'project' })
		);
	});
});
