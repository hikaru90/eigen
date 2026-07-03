import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '$lib/server/mcp/server';
import { runWithTrace } from '$lib/server/activity/trace-context';

async function handleMcp(event: Parameters<RequestHandler>[0]): Promise<Response> {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// enableJsonResponse: use Promise-based JSON responses instead of SSE streaming.
	// This fits the stateless-per-request SvelteKit model — no persistent stream to manage.
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});

	const server = createMcpServer({
		userId: user.id,
		authenticatedApiKey: event.locals.apiKeyAuth
	});
	await server.connect(transport);

	// Don't close the server — the transport stream lifecycle manages cleanup.
	// Closing early tears down the server before responses are written.
	return runWithTrace(crypto.randomUUID(), () =>
		transport.handleRequest(event.request)
	);
}

export const GET: RequestHandler = (event) => handleMcp(event);
export const POST: RequestHandler = (event) => handleMcp(event);
export const DELETE: RequestHandler = (event) => handleMcp(event);
