import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	runCaptureThoughtTool,
	runEditThoughtTool,
	runRetrieveThoughtsTool,
	runAnswerQuestionTool
} from '$lib/server/mcp/tools';
import { runWithTrace } from '$lib/server/activity/trace-context';

const TOOL_MAP = {
	capture_thought: runCaptureThoughtTool,
	retrieve_thoughts: runRetrieveThoughtsTool,
	edit_thought: runEditThoughtTool,
	answer_question: runAnswerQuestionTool
} as const;

const TOOL_DEFINITIONS = [
	{
		name: 'capture_thought',
		description: 'Capture and store a raw thought.'
	},
	{
		name: 'retrieve_thoughts',
		description: 'Retrieve thoughts using hybrid vector, lexical, and graph retrieval.'
	},
	{
		name: 'edit_thought',
		description: 'Apply a natural-language edit request to a thought.'
	},
	{
		name: 'answer_question',
		description: 'Answer a question by retrieving relevant thoughts and composing a grounded answer.'
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

	const result = await runWithTrace(crypto.randomUUID(), () => handler(
		{ userId: user.id },
		params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
	));

	return json({
		content: [{ type: 'text', text: JSON.stringify(result) }]
	});
};
