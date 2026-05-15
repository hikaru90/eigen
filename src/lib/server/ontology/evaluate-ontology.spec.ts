import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, llmChatCompletionMock, loadOntologyForUserMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	llmChatCompletionMock: vi.fn(),
	loadOntologyForUserMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/ontology-db', () => ({
	loadOntologyForUser: loadOntologyForUserMock
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

import { maybeRefreshUserOntology, recomputeUserOntologyProfileForUser } from './evaluate-ontology';

const taskRow = {
	id: 'ek1',
	userId: 'u1',
	key: 'task',
	name: 'Task',
	definition: 'Something to do',
	active: true,
	kindType: 'thought_category'
};

function mockLoadedOntology() {
	return {
		entityKinds: [taskRow],
		relationKinds: [],
		entityKindsById: new Map([[taskRow.id, taskRow]]),
		entityKindsByKey: new Map([[taskRow.key, taskRow]]),
		relationKindsById: new Map(),
		relationKindsByKey: new Map()
	};
}

describe('maybeRefreshUserOntology', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadOntologyForUserMock.mockResolvedValue(mockLoadedOntology());
	});

	it('no-ops when thought count is not a positive multiple of 10', async () => {
		await maybeRefreshUserOntology({ userId: 'u1', thoughtCountAfterInsert: 9 });
		expect(getDbMock).not.toHaveBeenCalled();
		await maybeRefreshUserOntology({ userId: 'u1', thoughtCountAfterInsert: 0 });
		expect(getDbMock).not.toHaveBeenCalled();
	});

	it('no-ops when cursor already at or beyond count', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn(async () => [{ profile: {}, evaluatedUpToThoughtCount: 10 }])
					}))
				}))
			}))
		});

		await maybeRefreshUserOntology({ userId: 'u1', thoughtCountAfterInsert: 10 });
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('calls LLM and upserts when count is 10 and cursor is 0', async () => {
		const insertChain = {
			values: vi.fn(() => ({
				onConflictDoUpdate: vi.fn(async () => undefined)
			}))
		};
		let fromN = 0;
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => {
					fromN += 1;
					if (fromN <= 2) {
						return {
							where: vi.fn(() => ({
								limit: vi.fn(async () => [])
							}))
						};
					}
					return {
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(async () => [{ normalizedText: 'hello', category: 'task' }])
							}))
						}))
					};
				})
			})),
			insert: vi.fn(() => insertChain)
		};
		getDbMock.mockReturnValue(db);

		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							version: 2,
							kindGuidance: { task: 'short sensory notes' },
							summary: 'user writes short notes'
						})
					}
				}
			]
		});

		const onBeforeEval = vi.fn();
		await maybeRefreshUserOntology({
			userId: 'u1',
			thoughtCountAfterInsert: 10,
			onBeforeEval
		});

		expect(onBeforeEval).toHaveBeenCalledTimes(1);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
		expect(db.insert).toHaveBeenCalled();
	});
});

describe('recomputeUserOntologyProfileForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadOntologyForUserMock.mockResolvedValue(mockLoadedOntology());
	});

	it('calls LLM and upserts for any positive thought count (not multiple-of-10 gate)', async () => {
		const insertChain = {
			values: vi.fn(() => ({
				onConflictDoUpdate: vi.fn(async () => undefined)
			}))
		};
		let fromN = 0;
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => {
					fromN += 1;
					if (fromN === 1) {
						return {
							where: vi.fn(async () => [{ n: 3 }])
						};
					}
					if (fromN === 2) {
						return {
							where: vi.fn(() => ({
								limit: vi.fn(async () => [])
							}))
						};
					}
					return {
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(async () => [{ normalizedText: 'a', category: 'task' }])
							}))
						}))
					};
				})
			})),
			insert: vi.fn(() => insertChain)
		};
		getDbMock.mockReturnValue(db);

		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							version: 2,
							kindGuidance: { task: 'tasks' },
							summary: 's'
						})
					}
				}
			]
		});

		const onBeforeEval = vi.fn();
		await recomputeUserOntologyProfileForUser('u1', { onBeforeEval });

		expect(onBeforeEval).toHaveBeenCalledTimes(1);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
		expect(db.insert).toHaveBeenCalled();
	});

	it('propagates LLM errors', async () => {
		let fromN = 0;
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => {
					fromN += 1;
					if (fromN === 1) {
						return {
							where: vi.fn(async () => [{ n: 1 }])
						};
					}
					if (fromN === 2) {
						return {
							where: vi.fn(() => ({
								limit: vi.fn(async () => [])
							}))
						};
					}
					return {
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(async () => [{ normalizedText: 'x', category: 'task' }])
							}))
						}))
					};
				})
			}))
		};
		getDbMock.mockReturnValue(db);
		llmChatCompletionMock.mockRejectedValue(new Error('gateway down'));

		await expect(recomputeUserOntologyProfileForUser('u1')).rejects.toThrow('gateway down');
	});

	it('still runs LLM when thought count is zero', async () => {
		const insertChain = {
			values: vi.fn(() => ({
				onConflictDoUpdate: vi.fn(async () => undefined)
			}))
		};
		let fromN = 0;
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => {
					fromN += 1;
					if (fromN === 1) {
						return {
							where: vi.fn(async () => [{ n: 0 }])
						};
					}
					if (fromN === 2) {
						return {
							where: vi.fn(() => ({
								limit: vi.fn(async () => [])
							}))
						};
					}
					return {
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(async () => [])
							}))
						}))
					};
				})
			})),
			insert: vi.fn(() => insertChain)
		};
		getDbMock.mockReturnValue(db);
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							version: 2,
							kindGuidance: { task: 'empty user' }
						})
					}
				}
			]
		});

		await recomputeUserOntologyProfileForUser('u1');
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
		expect(db.insert).toHaveBeenCalled();
	});
});
