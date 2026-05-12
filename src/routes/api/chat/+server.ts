import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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

async function persistAssistantMessage(db: ReturnType<typeof getDb>, sessionId: string, userId: string, content: string) {
	const [msg] = await db
		.insert(chatMessage)
		.values({ sessionId, userId, role: 'assistant', content })
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
				const line = (payload: unknown) => {
						controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
				};

				runWithTrace(crypto.randomUUID(), () =>
					agentChat({
						userId: user.id,
						messages: [...history, { role: 'user', content: message }],
						onEvent: (evt) => line(evt),
						db: streamDb
					})
				)
					.then(async (result) => {
						const messageId = await persistAssistantMessage(streamDb, sessionId, user.id, result.response);
						if (isFirstMessage) {
							const title = message.length > 80 ? message.slice(0, 77) + '...' : message;
							await streamDb
								.update(chatSession)
								.set({ title })
								.where(eq(chatSession.id, sessionId));
						}
						line({ type: 'done', response: result.response, sessionId, messageId });
					})
					.catch((err) => {
						const details = collectErrorMessages(err);
						const msg = details[0] ?? 'An unexpected error occurred.';
						console.error('[api/chat] agentChat threw', { error: msg, details });
						line({ type: 'error', error: msg, details });
					})
					.finally(() => {
						controller.close();
						streamPg.end().catch(() => {});
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
