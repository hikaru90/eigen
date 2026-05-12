import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { logActivityCall } from '$lib/server/activity/log-call';
import { AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
import { getDb } from '$lib/server/db';
import {
	runEditThoughtTool,
	runRetrieveThoughtsTool,
	runAnswerQuestionTool,
	type McpToolContext
} from '$lib/server/mcp/tools';
import type { ChatStreamEvent } from '$lib/chat/chat-stream-types';

type AgentToolDef = {
	name: string;
	description: string;
	schema: string;
};

const AGENT_TOOLS: AgentToolDef[] = [
	{
		name: 'retrieve_thoughts',
		description: 'Search the user\'s stored thoughts using hybrid semantic, lexical, and graph retrieval.',
		schema: '{"query": "string (required)", "top_k": "number (optional, default 20)", "threshold": "number (optional, 0-1)"}'
	},
	{
		name: 'edit_thought',
		description: 'Edit an existing thought by ID with a natural-language edit request.',
		schema: '{"thought_id": "string (required)", "edit_request": "string (required)"}'
	},
	{
		name: 'answer_question',
		description: 'Answer a question by retrieving relevant thoughts and composing a grounded answer with citations.',
		schema: '{"question": "string (required)", "top_k": "number (optional, default 8)"}'
	}
];

const MAX_ITERATIONS = 10;

const TOOL_MAP: Record<string, (ctx: McpToolContext, args: unknown) => Promise<unknown>> = {
	retrieve_thoughts: runRetrieveThoughtsTool,
	edit_thought: runEditThoughtTool,
	answer_question: runAnswerQuestionTool
};

const TOOL_DESCRIPTION_BLOCK = AGENT_TOOLS.map(
	(t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.schema}`
).join('\n\n');

const SYSTEM_PROMPT = [
	'You are an AI assistant connected to the user\'s personal memory store. The user\'s thoughts, notes, and data are stored in a PostgreSQL database with vector embeddings and a FalkorDB graph. You can search this data using tools.',
	'',
	'=== CRITICAL: YOU MUST USE TOOLS ===',
	'The user expects you to search their actual stored memories. Do NOT answer from your training data. Do NOT say "I don\'t have information about you." Always call retrieve_thoughts or answer_question first.',
	'',
	'=== TOOL CALLING FORMAT ===',
	'Respond with a JSON object. No other text. Two possible formats:',
	'',
	'To call a tool:',
	'{"tool": "<tool_name>", "arguments": {<args>}}',
	'',
	'To give the final answer after receiving tool results:',
	'{"answer": "<your response>"}',
	'',
	'=== AVAILABLE TOOLS ===',
	TOOL_DESCRIPTION_BLOCK,
	'',
	'=== BEHAVIOR RULES ===',
	'- When the user asks about themselves, their memories, or anything they might have stored: ALWAYS call retrieve_thoughts first.',
	'- For factual questions about stored knowledge: call answer_question — it retrieves relevant thoughts and composes a grounded answer with citations automatically.',
	'- Call at most one tool per response. After the tool result comes back, you may call another tool or give the final answer.',
	'- If a tool errors, tell the user clearly what happened in your final answer.',
	'- Do not invent tool names or argument keys.',
	'- Output ONLY the JSON object. No greetings, no explanations, no markdown.'
].join('\n');

type AgentResponse = {
	type: 'tool_call';
	tool: string;
	arguments: Record<string, unknown>;
} | {
	type: 'final';
	content: string;
};

function parseResponse(text: string): AgentResponse {
	let trimmed = text.trim();

	// Strip markdown code fences (```json ... ```) if the LLM wraps the JSON.
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fenceMatch) {
		trimmed = fenceMatch[1].trim();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		console.error('[agent-loop] LLM response is not valid JSON — treating as final answer', {
			preview: trimmed.slice(0, 300)
		});
		return { type: 'final', content: trimmed };
	}

	if (typeof parsed !== 'object' || !parsed) {
		console.error('[agent-loop] LLM response is not a JSON object — treating as final', { parsed });
		return { type: 'final', content: trimmed };
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.tool === 'string' && obj.arguments && typeof obj.arguments === 'object') {
		console.error('[agent-loop] parsed tool_call', { tool: obj.tool, arguments: obj.arguments });
		return {
			type: 'tool_call',
			tool: obj.tool,
			arguments: obj.arguments as Record<string, unknown>
		};
	}

	if (typeof obj.answer === 'string') {
		console.error('[agent-loop] parsed final answer', { preview: obj.answer.slice(0, 80) });
		return { type: 'final', content: obj.answer };
	}

	console.error('[agent-loop] JSON object has neither "tool" nor "answer" key — treating as final', {
		keys: Object.keys(obj),
		preview: trimmed.slice(0, 300)
	});
	return { type: 'final', content: trimmed };
}

export type AgentChatResult = {
	response: string;
	messages: ChatMessage[];
};

export async function agentChat(input: {
	userId: string;
	messages: ChatMessage[];
	onEvent?: (event: ChatStreamEvent) => void;
}): Promise<AgentChatResult> {
	const ctx: McpToolContext = { userId: input.userId };
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		...input.messages
	];

	let formatCorrectionSent = false;

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		console.error('[agent-loop] iteration', { iteration, messageCount: messages.length });

		input.onEvent?.({ type: 'thinking' });

		console.error('[agent-loop] calling llmChatCompletion');
		const raw = await llmChatCompletion({
			userId: input.userId,
			messages,
			temperature: 0
		});

		const response = raw as { choices?: Array<{ message?: { content?: string } }> };
		const content =
			response?.choices?.[0]?.message?.content?.trim() ?? '';

		if (!content) {
			console.error('[agent-loop] LLM returned empty content');
			return { response: 'The assistant did not produce a response.', messages };
		}

		console.error('[agent-loop] LLM raw response', { preview: content.slice(0, 300) });
		const parsed = parseResponse(content);

		if (parsed.type === 'tool_call') {
			input.onEvent?.({ type: 'tool_call', tool: parsed.tool, arguments: parsed.arguments });
			formatCorrectionSent = true;
			const handler = TOOL_MAP[parsed.tool];
			if (!handler) {
				console.error('[agent-loop] unknown tool requested', { tool: parsed.tool });
				messages.push({
					role: 'assistant',
					content: `TOOL: ${parsed.tool}\n{}`
				});
				messages.push({
					role: 'user',
					content: `Error: tool "${parsed.tool}" is not available. Available tools: ${AGENT_TOOLS.map((t) => t.name).join(', ')}`
				});
				continue;
			}

			console.error('[agent-loop] executing tool', { tool: parsed.tool, args: parsed.arguments });
			let result: unknown;
			const toolStart = Date.now();
			try {
				result = await handler(ctx, parsed.arguments);
				const preview = JSON.stringify(result).slice(0, 200);
				input.onEvent?.({ type: 'tool_result', tool: parsed.tool, preview });
				console.error('[agent-loop] tool result', { tool: parsed.tool, result: preview });
				console.error('[agent-loop] logging activity');
				await logActivityCall(getDb(), input.userId, {
					provider: AGENT_TOOL_ACTIVITY_PROVIDER,
					operation: `tool_call.${parsed.tool}`,
					baseCostUsd: 0,
					durationMs: Date.now() - toolStart
				});
				console.error('[agent-loop] activity logged');
			} catch (err) {
				console.error('[agent-loop] tool error', { tool: parsed.tool, error: err instanceof Error ? err.message : String(err) });
				result = { error: err instanceof Error ? err.message : String(err) };
				await logActivityCall(getDb(), input.userId, {
					provider: AGENT_TOOL_ACTIVITY_PROVIDER,
					operation: `tool_error.${parsed.tool}`,
					baseCostUsd: 0,
					durationMs: Date.now() - toolStart
				});
			}

			console.error('[agent-loop] pushing tool messages');
			messages.push({ role: 'assistant', content });
			messages.push({
				role: 'user',
				content: `Tool result for ${parsed.tool}:\n${JSON.stringify(result, null, 2)}`
			});
			console.error('[agent-loop] continuing after tool');
			continue;
		}

		// Response was parsed as "final" — if we haven't corrected the format yet,
		// assume the LLM is answering without using tools and push it to use them.
		if (!formatCorrectionSent) {
			formatCorrectionSent = true;
			messages.push({ role: 'assistant', content });
			messages.push({
				role: 'user',
				content: 'You answered without calling any tool. You MUST search the user\'s stored memories before answering. Call retrieve_thoughts or answer_question now using the JSON format: {"tool": "<tool_name>", "arguments": {...}}'
			});
			continue;
		}

		messages.push({ role: 'assistant', content });
		return { response: parsed.content, messages };
	}

	console.error('[agent-loop] max iterations reached');
	return {
		response: 'The assistant took too many steps to answer. Please try rephrasing your question.',
		messages
	};
}
