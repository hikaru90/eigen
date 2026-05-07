import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	runCaptureThoughtTool,
	runEditThoughtTool,
	runListThoughtsTool,
	runSearchThoughtsTool
} from '$lib/server/mcp/tools';

const TOOL_MAP = {
	capture_thought: runCaptureThoughtTool,
	list_thoughts: runListThoughtsTool,
	search_thoughts: runSearchThoughtsTool,
	edit_thought: runEditThoughtTool
} as const;

const TOOL_DEFINITIONS = [
	{
		name: 'capture_thought',
		description: 'Capture and store a raw thought.'
	},
	{
		name: 'list_thoughts',
		description: 'List thoughts for the authenticated user.'
	},
	{
		name: 'search_thoughts',
		description: 'Search thoughts with semantic and graph retrieval.'
	},
	{
		name: 'edit_thought',
		description: 'Apply a natural-language edit request to a thought.'
	}
];

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const method = typeof payload.method === 'string' ? payload.method : '';

	if (method === 'tools/list') {
		return json({
			tools: TOOL_DEFINITIONS
		});
	}

	if (method !== 'tools/call') {
		error(400, 'Unsupported method');
	}

	const params =
		payload.params && typeof payload.params === 'object'
			? (payload.params as Record<string, unknown>)
			: {};
	const toolName = typeof params.name === 'string' ? params.name : '';
	const handler = TOOL_MAP[toolName as keyof typeof TOOL_MAP];
	if (!handler) {
		error(400, `Unknown tool: ${toolName}`);
	}

	const result = await handler(
		{ userId: user.id },
		params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
	);

	return json({
		content: [{ type: 'text', text: JSON.stringify(result) }]
	});
};
