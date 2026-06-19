import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { agentChatMock, getDbMock, appSqlMock, createScopedDrizzleMock } = vi.hoisted(() => ({
	agentChatMock: vi.fn(),
	getDbMock: vi.fn(),
	appSqlMock: {
		reserve: vi.fn()
	},
	createScopedDrizzleMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock,
	appSql: appSqlMock,
	appDbAsyncLocal: { run: (_db: unknown, fn: () => unknown) => fn() },
	createScopedDrizzle: createScopedDrizzleMock,
	activateTenantDbSession: vi.fn(async () => undefined),
	deactivateTenantDbSession: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/llm/agent-loop', () => ({ agentChat: agentChatMock }));
vi.mock('$lib/server/activity/trace-context', () => ({
	runWithTrace: (_id: string, fn: () => unknown) => fn()
}));

const SESSION_ID = 'sess-1';
const ASSISTANT_MSG_ID = 'asst-1';

function chatRequest(body: unknown, opts?: { ndjson?: boolean; signal?: AbortSignal }) {
	return {
		json: vi.fn(async () => body),
		headers: {
			get: (name: string) =>
				opts?.ndjson !== false && name.toLowerCase() === 'accept' ? 'application/x-ndjson' : null
		},
		signal: opts?.signal ?? new AbortController().signal
	};
}

function ndjsonRequest(body: unknown, signal?: AbortSignal) {
	return chatRequest(body, { ndjson: true, signal });
}

function jsonRequest(body: unknown) {
	return chatRequest(body, { ndjson: false });
}

function buildMainDb() {
	const insertValues = vi
		.fn()
		.mockReturnValueOnce({
			returning: vi.fn().mockResolvedValue([{ id: SESSION_ID, mode: 'default' }])
		})
		.mockReturnValueOnce({})
		.mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: ASSISTANT_MSG_ID }])
		});
	const insert = vi.fn().mockReturnValue({ values: insertValues });

	const whereForSelect = vi.fn().mockReturnValue({
		limit: vi.fn().mockResolvedValue([{ id: SESSION_ID }])
	});
	const select = vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: whereForSelect
		})
	});

	const update = vi.fn().mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined)
		})
	});

	whereForSelect.mockReturnValueOnce({
		limit: vi.fn().mockResolvedValue([{ id: SESSION_ID, mode: 'default' }])
	});
	whereForSelect.mockResolvedValue([{ count: 1 }]);

	return { insert, select, update };
}

function buildStreamDb() {
	return {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: ASSISTANT_MSG_ID }])
			})
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		})
	};
}

async function readNdjsonLines(res: Response) {
	const text = await res.text();
	return text
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as { type: string; [key: string]: unknown });
}

describe('POST /api/chat', () => {
	beforeEach(() => {
		agentChatMock.mockReset();
		getDbMock.mockReset();
		appSqlMock.reserve.mockReset();
		createScopedDrizzleMock.mockReset();
		getDbMock.mockReturnValue(buildMainDb());
		const streamDb = buildStreamDb();
		createScopedDrizzleMock.mockReturnValue(streamDb);
		appSqlMock.reserve.mockResolvedValue(
			Object.assign(vi.fn().mockResolvedValue(undefined), {
				release: vi.fn().mockResolvedValue(undefined)
			})
		);
	});

	it('rejects bootstrap without briefingPeriod', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: ndjsonRequest({ bootstrap: true })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('requires auth', async () => {
		await expect(
			POST({ locals: { user: null }, request: ndjsonRequest({ message: 'hi' }) } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('rejects empty message', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: ndjsonRequest({ message: '   ' })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects invalid JSON body', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: {
					json: vi.fn(async () => {
						throw new SyntaxError('invalid json');
					}),
					headers: { get: () => null },
					signal: new AbortController().signal
				}
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 404 when sessionId does not exist', async () => {
		const whereForSelect = vi.fn().mockReturnValue({
			limit: vi.fn().mockResolvedValue([])
		});
		getDbMock.mockReturnValue({
			insert: vi.fn(),
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({ where: whereForSelect })
			}),
			update: vi.fn()
		});

		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: ndjsonRequest({ message: 'hello', sessionId: 'missing-session' })
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns JSON response on non-ndjson success', async () => {
		agentChatMock.mockResolvedValue({
			response: 'Plain JSON reply.',
			messages: [{ role: 'assistant', content: 'Plain JSON reply.' }]
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: jsonRequest({ message: 'hello' })
		} as never);

		expect(res.headers.get('content-type')).not.toContain('ndjson');
		expect(await res.json()).toMatchObject({
			response: 'Plain JSON reply.',
			sessionId: SESSION_ID,
			messageId: ASSISTANT_MSG_ID
		});
	});

	it('returns 500 JSON when agentChat throws on non-ndjson path', async () => {
		agentChatMock.mockRejectedValue(new Error('gateway timeout'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: jsonRequest({ message: 'hello' })
		} as never);

		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({
			response: 'An unexpected error occurred.',
			sessionId: SESSION_ID,
			history: []
		});
		consoleSpy.mockRestore();
	});

	it('streams ndjson with done on success', async () => {
		agentChatMock.mockImplementation(async (input: { onEvent?: (e: unknown) => void }) => {
			input.onEvent?.({ type: 'tool_call', tool: 'retrieve_thoughts', arguments: { query: 'coffee' } });
			input.onEvent?.({
				type: 'tool_result',
				tool: 'retrieve_thoughts',
				preview: JSON.stringify({ results: [] })
			});
			return { response: 'You like sweet coffee.', messages: [] };
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ message: 'how do i like my coffee?' })
		} as never);

		expect(res.headers.get('content-type')).toContain('ndjson');
		const lines = await readNdjsonLines(res);
		expect(appSqlMock.reserve).toHaveBeenCalled();
		expect(createScopedDrizzleMock).toHaveBeenCalled();
		expect(lines.some((l) => l.type === 'tool_call')).toBe(true);
		expect(lines.some((l) => l.type === 'tool_result')).toBe(true);
		const last = lines[lines.length - 1];
		expect(last.type).toBe('done');
		expect(last.response).toBe('You like sweet coffee.');
	});

	it('streams parsed answer_question prose in done.response', async () => {
		const composedAnswer =
			'Answer: To cook salmon, whisk miso glaze and broil. [salmon-id]\nEvidence:\n- Recipe steps [salmon-id]\nUnknown:\n- none';
		const preview = JSON.stringify({
			answer: composedAnswer,
			citations: ['salmon-id'],
			retrieved: [{ id: 'salmon-id', snippet: 'Recipe: salmon', category: 'observation' }]
		});
		agentChatMock.mockImplementation(async (input: { onEvent?: (e: unknown) => void }) => {
			input.onEvent?.({
				type: 'tool_call',
				tool: 'answer_question',
				arguments: { question: 'how to cook salmon?' }
			});
			input.onEvent?.({ type: 'tool_executing', tool: 'answer_question' });
			input.onEvent?.({ type: 'tool_result', tool: 'answer_question', preview });
			return { response: composedAnswer, messages: [] };
		});

		const streamDb = buildStreamDb();
		const insertMock = streamDb.insert as ReturnType<typeof vi.fn>;
		createScopedDrizzleMock.mockReturnValue(streamDb);

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ message: 'how to cook salmon?' })
		} as never);

		const lines = await readNdjsonLines(res);
		const done = lines.find((l) => l.type === 'done');
		expect(done?.response).toBe('To cook salmon, whisk miso glaze and broil. [salmon-id]');
		expect(insertMock.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it('streams ndjson error line when agentChat throws', async () => {
		agentChatMock.mockRejectedValue(new Error('embedding failed'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ message: 'hello' })
		} as never);

		const lines = await readNdjsonLines(res);
		const last = lines[lines.length - 1];
		expect(last.type).toBe('error');
		expect(last.error).toBe('embedding failed');
		consoleSpy.mockRestore();
	});

	it('always ends stream with done or error terminal event', async () => {
		agentChatMock.mockResolvedValue({ response: 'ok', messages: [] });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ message: 'hello' })
		} as never);
		const lines = await readNdjsonLines(res);
		const terminal = lines.filter((l) => l.type === 'done' || l.type === 'error');
		expect(terminal).toHaveLength(1);
	});

	function delayedAgentChatMock() {
		agentChatMock.mockImplementation(async (input: { onEvent?: (e: unknown) => void }) => {
			input.onEvent?.({
				type: 'tool_call',
				tool: 'answer_question',
				arguments: { question: 'test' }
			});
			await new Promise((r) => setTimeout(r, 50));
			input.onEvent?.({
				type: 'tool_progress',
				tool: 'answer_question',
				phase: 'searching',
				label: 'Searching memories…'
			});
			input.onEvent?.({
				type: 'tool_result',
				tool: 'answer_question',
				preview: JSON.stringify({ answer: 'ok' })
			});
			return { response: 'Done.', messages: [] };
		});
	}

	function enqueueFailedCalls(spy: ReturnType<typeof vi.spyOn>) {
		return spy.mock.calls.filter(
			(args) =>
				typeof args[0] === 'string' &&
				args[0].includes('[api/chat] stream enqueue failed')
		);
	}

	it('does not log enqueue errors when consumer cancels mid-stream', async () => {
		delayedAgentChatMock();
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ message: 'hello' })
		} as never);

		const reader = res.body?.getReader();
		expect(reader).toBeDefined();
		await reader!.read();
		await reader!.cancel();
		await new Promise((r) => setTimeout(r, 120));

		expect(enqueueFailedCalls(consoleSpy)).toHaveLength(0);
		consoleSpy.mockRestore();
	});

	it('does not log enqueue errors when request aborts mid-stream', async () => {
		delayedAgentChatMock();
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const ac = new AbortController();

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ message: 'hello' }, ac.signal)
		} as never);

		const reader = res.body?.getReader();
		expect(reader).toBeDefined();
		await reader!.read();
		ac.abort();
		await new Promise((r) => setTimeout(r, 120));

		expect(enqueueFailedCalls(consoleSpy)).toHaveLength(0);
		consoleSpy.mockRestore();
	});
});
