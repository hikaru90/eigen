import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { formatToolResultForDisplay } from '$lib/chat/chat-stream-types';
import { agentChat } from '$lib/server/llm/agent-loop';
import type { ChatMessage } from '$lib/server/llm/llm-client';
import { getDb } from '$lib/server/db';
import { chatSession, chatMessage } from '$lib/server/db/brain.schema';
import { eq, sql } from 'drizzle-orm';
import { runWithTrace } from '$lib/server/activity/trace-context';
import { getRuntimeDatabaseUrl } from '$lib/server/db/runtime-url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '$lib/server/db/schema';

function collectErrorMessages(input: unknown): string[] {
	const parts: string[] = [];
	let current = input;
	let guard = 0;
	while (current && guard < 8) {
		guard += 1;
		if (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
			continue;
		}
		if (typeof current === 'object' && current) {
			const msg = 'message' in current ? (current as { message?: unknown }).message : undefined;
			if (typeof msg === 'string' && msg.trim().length > 0) {
				parts.push(msg);
			}
			current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
			continue;
		}
		break;
	}
	return parts.filter((v, i, arr) => v && arr.indexOf(v) === i);
}

async function getOrCreateSession(db: ReturnType<typeof getDb>, userId: string, sessionId: string | null) {
	if (!sessionId) {
		const [s] = await db
			.insert(chatSession)
			.values({ userId })
			.returning({ id: chatSession.id });
		return s.id;
	}
	const [existing] = await db
		.select({ id: chatSession.id })
		.from(chatSession)
		.where(eq(chatSession.id, sessionId))
		.limit(1);
	if (!existing) error(404, 'Session not found');
	return sessionId;
}

async function persistAssistantMessage(db: ReturnType<typeof getDb>, sessionId: string, userId: string, content: string, metadata?: Record<string, unknown> | null) {
	const [msg] = await db
		.insert(chatMessage)
		.values({ sessionId, userId, role: 'assistant', content, ...(metadata ? { metadata } : {}) })
		.returning({ id: chatMessage.id });
	return msg.id;
}

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		console.error('[api/chat] no user');
		error(401, 'Unauthorized');
	}

	let body: unknown;
	try {
		body = await event.request.json();
	} catch (parseErr) {
		console.error('[api/chat] invalid JSON body', { parseErr });
		error(400, 'Invalid JSON');
	}

	const b =
		typeof body === 'object' && body
			? (body as { message?: unknown; history?: unknown; sessionId?: unknown })
			: {};
	const message = typeof b.message === 'string' ? b.message.trim() : '';
	if (!message) {
		console.error('[api/chat] empty message');
		error(400, 'message is required');
	}

	const rawHistory = Array.isArray(b.history) ? b.history : [];
	const history: ChatMessage[] = [];
	for (const entry of rawHistory) {
		if (
			typeof entry === 'object' &&
			entry &&
			typeof (entry as { role?: unknown }).role === 'string' &&
			typeof (entry as { content?: unknown }).content === 'string'
		) {
			history.push(entry as ChatMessage);
		}
	}

	const db = getDb();
	const sessionId = await getOrCreateSession(db, user.id, typeof b.sessionId === 'string' && b.sessionId.trim() ? b.sessionId.trim() : null);

	await db.insert(chatMessage).values({
		sessionId,
		userId: user.id,
		role: 'user',
		content: message
	});

	const countResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(chatMessage)
		.where(eq(chatMessage.sessionId, sessionId));
	const isFirstMessage = countResult[0]?.count === 1;

	const accept = event.request.headers?.get('accept') ?? '';
	const streamNdjson = accept.includes('application/x-ndjson');

	if (streamNdjson) {
		const encoder = new TextEncoder();
		const streamPg = postgres(getRuntimeDatabaseUrl());
		const streamDb = drizzle(streamPg, { schema });
		const stream = new ReadableStream({
			start(controller) {
				let terminalSent = false;
				let streamClosed = false;

				const line = (payload: unknown): boolean => {
					if (streamClosed) return false;
					try {
						controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
						return true;
					} catch (enqueueErr) {
						console.error('[api/chat] stream enqueue failed', { enqueueErr });
						return false;
					}
				};

				const sendTerminal = (payload: { type: 'done' | 'error'; [key: string]: unknown }) => {
					if (terminalSent) return;
					terminalSent = true;
					line(payload);
				};

				const closeStream = () => {
					if (streamClosed) return;
					streamClosed = true;
					try {
						controller.close();
					} catch {
						// already closed
					}
					streamPg.end().catch(() => {});
				};

				event.request.signal.addEventListener('abort', () => {
					if (!terminalSent) {
						sendTerminal({
							type: 'error',
							error: 'Request cancelled.',
							details: ['client disconnected']
						});
					}
					closeStream();
				});

				// Buffer of intermediate steps to persist together after the run.
				const intermediateSteps: Array<{ content: string; metadata: Record<string, unknown> }> = [];

				runWithTrace(crypto.randomUUID(), () =>
					agentChat({
						userId: user.id,
						messages: [...history, { role: 'user', content: message }],
						onEvent: (evt) => {
							if (streamClosed) return;
							line(evt);
							// Capture intermediate steps for persistence.
							if (evt.type === 'thinking' && evt.content) {
								intermediateSteps.push({
									content: evt.content,
									metadata: { variant: 'thinking' }
								});
							} else if (evt.type === 'tool_call') {
								const args = evt.arguments ?? {};
								intermediateSteps.push({
									content: JSON.stringify({ tool: evt.tool, arguments: args }),
									metadata: { variant: 'tool_call', tool: evt.tool, arguments: args }
								});
							} else if (evt.type === 'tool_result') {
								const preview = evt.preview ?? '';
								const failed = evt.failed === true;
								intermediateSteps.push({
									content: preview,
									metadata: {
										variant: 'tool_result',
										tool: evt.tool,
										failed,
										displaySummary: formatToolResultForDisplay(evt.tool, preview)
									}
								});
							}
						},
						db: streamDb
					})
				)
					.then(async (result) => {
						if (streamClosed) return;
						// Persist intermediate steps first (preserves display order on reload).
						for (const step of intermediateSteps) {
							await streamDb.insert(chatMessage).values({
								sessionId,
								userId: user.id,
								role: 'assistant',
								content: step.content,
								metadata: step.metadata
							});
						}
						const responseText =
							typeof result.response === 'string' && result.response.trim().length > 0
								? result.response
								: 'The assistant did not produce a response.';
						const messageId = await persistAssistantMessage(
							streamDb,
							sessionId,
							user.id,
							responseText
						);
						if (isFirstMessage) {
							const title = message.length > 80 ? message.slice(0, 77) + '...' : message;
							await streamDb
								.update(chatSession)
								.set({ title })
								.where(eq(chatSession.id, sessionId));
						}
						sendTerminal({ type: 'done', response: responseText, sessionId, messageId });
					})
					.catch((err) => {
						const details = collectErrorMessages(err);
						const msg = details[0] ?? 'An unexpected error occurred.';
						console.error('[api/chat] agentChat threw', { error: msg, details });
						sendTerminal({ type: 'error', error: msg, details });
					})
					.finally(() => {
						if (!terminalSent && !streamClosed) {
							sendTerminal({
								type: 'error',
								error: 'Chat ended before a response was received.',
								details: ['stream closed without terminal event']
							});
						}
						closeStream();
					});
			}
		});

		return new Response(stream, {
			headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
		});
	}

	console.error('[api/chat] starting agentChat', { userId: user.id, userMessage: message.slice(0, 100) });
	try {
		const result = await runWithTrace(crypto.randomUUID(), () => agentChat({
			userId: user.id,
			messages: [...history, { role: 'user', content: message }]
		}));

		const messageId = await persistAssistantMessage(db, sessionId, user.id, result.response);

		if (isFirstMessage) {
			const title = message.length > 80 ? message.slice(0, 77) + '...' : message;
			await db
				.update(chatSession)
				.set({ title })
				.where(eq(chatSession.id, sessionId));
		}

		console.error('[api/chat] agentChat complete', { responsePreview: result.response.slice(0, 100) });
		return json({
			response: result.response,
			history: result.messages.filter((m) => m.role !== 'system'),
			sessionId,
			messageId
		});
	} catch (err) {
		console.error('[api/chat] agentChat threw', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
		return json({ response: 'An unexpected error occurred.', history: [], sessionId }, { status: 500 });
	}
};
