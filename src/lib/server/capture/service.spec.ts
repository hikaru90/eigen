import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureThought, deterministicNormalize, editStoredThought } from './service';

const {
	getDbMock,
	logActivityCallMock,
	createThoughtEmbeddingMock,
	upsertThoughtNodeMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	logActivityCallMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	upsertThoughtNodeMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/graph/falkor', () => ({
	upsertThoughtNode: upsertThoughtNodeMock
}));

describe('deterministicNormalize', () => {
	it('normalizes whitespace and defaults to thought', () => {
		const result = deterministicNormalize('  hello   world  ');
		expect(result.normalized).toBe('hello world');
		expect(result.category).toBe('thought');
	});

	it('maps task/idea/reference categories', () => {
		expect(deterministicNormalize('todo buy milk').category).toBe('task');
		expect(deterministicNormalize('new idea for app').category).toBe('idea');
		expect(deterministicNormalize('reference this link').category).toBe('reference');
	});
});

function makeInsertReturning(value: unknown) {
	return {
		values: vi.fn(() => ({
			returning: vi.fn(async () => [value])
		}))
	};
}

describe('captureThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
	});

	it('stores capture session, thought row, and graph node', async () => {
		const sessionRow = { id: 'session-1' };
		const thoughtRow = {
			id: 'thought-1',
			userId: 'u1',
			rawText: 'raw input',
			normalizedText: 'raw input',
			lexicalText: 'raw input',
			category: 'thought',
			metadata: {}
		};
		const insertCapture = makeInsertReturning(sessionRow);
		const insertThought = makeInsertReturning(thoughtRow);
		const tx = { insert: vi.fn(() => insertThought) };
		const db = {
			insert: vi.fn(() => insertCapture),
			transaction: vi.fn(async (cb: (txArg: unknown) => unknown) => cb(tx))
		};
		getDbMock.mockReturnValue(db);

		const stored = await captureThought('u1', 'raw input');

		expect(stored.id).toBe('thought-1');
		expect(logActivityCallMock).toHaveBeenCalledTimes(1);
		expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'raw input');
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'thought-1',
				userId: 'u1'
			})
		);
	});
});

describe('editStoredThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.5, 0.5]);
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
			category: 'thought',
			normalizedText: 'hello',
			lexicalText: 'hello'
		};
		const updated = {
			...existing,
			rawText: 'hello\n\nEdit request: make shorter',
			normalizedText: 'hello Edit request: make shorter',
			lexicalText: 'hello edit request: make shorter'
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
		expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1);
		expect(upsertThoughtNodeMock).toHaveBeenCalledTimes(1);
	});
});
