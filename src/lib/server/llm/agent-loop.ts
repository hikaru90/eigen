import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { logActivityCall } from '$lib/server/activity/log-call';
import { AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
import { getDb } from '$lib/server/db';
import {
	buildAgentToolDescriptionBlock,
	MCP_TOOL_DEFINITIONS,
	MCP_TOOL_MAP,
	MCP_TOOL_NAMES
} from '$lib/server/mcp/registry';
import type { McpToolContext } from '$lib/server/mcp/tools';
import type { ChatStreamEvent } from '$lib/chat/chat-stream-types';
import { formatToolResultForDisplay } from '$lib/chat/chat-stream-types';
import {
	formatComposedAnswerForUser,
	type ComposedAnswer
} from '$lib/server/qa/compose-answer';
import { redactForLog } from '$lib/server/observability/redact-for-log';
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings';
import { routeAgentMessage } from '$lib/server/llm/agent-router';
import {
	findUniqueStrongRetrieveMatch,
	formatToolResultForAgentMessage,
	formatToolResultPreview,
	isDeleteIntent
} from '$lib/server/llm/agent-tool-result-compact';

const MAX_ITERATIONS = 10;

const TOOL_DESCRIPTION_BLOCK = buildAgentToolDescriptionBlock();

/** Slim prompt for multi-step agent iterations only (router handles first-hop tool choice). */
const AGENT_SYSTEM_PROMPT = [
	'You are an AI assistant for the user\'s personal memory store. You have MCP tools to capture, search, edit, delete, and answer from stored thoughts.',
	'',
	'Respond with JSON only. To call a tool:',
	'{"tool": "<tool_name>", "arguments": {<args>}}',
	'When done:',
	'{"answer": "<your response>"}',
	'',
	'=== AVAILABLE TOOLS ===',
	TOOL_DESCRIPTION_BLOCK,
	'',
	'=== RULES ===',
	'- Completion reports: retrieve_thoughts first, then edit_thought to mark done or delete_thought if user wants removal.',
	'- Questions and planning: answer_question (not retrieve_thoughts alone).',
	'- Capture only when user explicitly wants to save something new.',
	'- Never claim an edit/delete succeeded unless the tool succeeded in this turn.',
	'- If a tool errors, explain in your final answer.',
	'- Output ONLY the JSON object.'
].join('\n');

type AgentResponse = {
	type: 'tool_call';
	tool: string;
	arguments: Record<string, unknown>;
	thinking: string;
} | {
	type: 'final';
	content: string;
	thinking: string;
};

/** Strips a leading <think>...</think> block from the raw LLM output.
 *  Returns { thinking, rest } where `thinking` is the extracted text (empty string if absent)
 *  and `rest` is the remaining content to parse as JSON. */
function extractThinking(raw: string): { thinking: string; rest: string } {
	const match = raw.match(/^<think>([\s\S]*?)<\/think>\s*/i);
	if (match) {
		return { thinking: match[1].trim(), rest: raw.slice(match[0].length).trim() };
	}
	return { thinking: '', rest: raw };
}

function parseResponse(text: string): AgentResponse {
	const { thinking, rest } = extractThinking(text);
	let trimmed = rest.trim();

	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fenceMatch) {
		trimmed = fenceMatch[1].trim();
	}

	trimmed = trimmed.replace(/```[\s\S]*$/, '').trim();

	function tryParseJson(str: string): unknown {
		try {
			return JSON.parse(str);
		} catch {
			return undefined;
		}
	}

	let parsed: unknown = tryParseJson(trimmed);

	if (!parsed) {
		const firstBrace = trimmed.indexOf('{');
		if (firstBrace >= 0) {
			let depth = 0;
			for (let i = firstBrace; i < trimmed.length; i++) {
				if (trimmed[i] === '{') depth++;
				else if (trimmed[i] === '}') {
					depth--;
					if (depth === 0) {
						parsed = tryParseJson(trimmed.slice(firstBrace, i + 1));
						if (parsed) break;
					}
				}
			}
		}
	}

	if (!parsed) {
		console.error('[agent-loop] LLM response is not valid JSON — treating as final answer', {
			preview: trimmed.slice(0, 300)
		});
		return { type: 'final', content: trimmed, thinking };
	}

	if (typeof parsed !== 'object' || !parsed) {
		console.error('[agent-loop] LLM response is not a JSON object — treating as final', { parsed });
		return { type: 'final', content: trimmed, thinking };
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.tool === 'string' && obj.arguments && typeof obj.arguments === 'object') {
		console.error('[agent-loop] parsed tool_call', { tool: obj.tool, arguments: obj.arguments });
		return {
			type: 'tool_call',
			tool: obj.tool,
			arguments: obj.arguments as Record<string, unknown>,
			thinking
		};
	}

	if (typeof obj.answer === 'string') {
		console.error('[agent-loop] parsed final answer', { preview: obj.answer.slice(0, 80) });
		return { type: 'final', content: obj.answer, thinking };
	}

	console.error('[agent-loop] JSON object has neither "tool" nor "answer" key — treating as final', {
		keys: Object.keys(obj),
		preview: trimmed.slice(0, 300)
	});
	return { type: 'final', content: trimmed, thinking };
}

export type AgentChatResult = {
	response: string;
	messages: ChatMessage[];
};

type ToolExecutionContext = {
	userId: string;
	ctx: McpToolContext;
	deleteIntent: boolean;
	onEvent?: (event: ChatStreamEvent) => void;
	db?: ReturnType<typeof getDb>;
	assistantContentForHistory?: string;
};

async function executeAgentToolCall(input: {
	tool: string;
	arguments: Record<string, unknown>;
	exec: ToolExecutionContext;
}): Promise<{ done: true; response: string; messages?: ChatMessage[] } | { done: false; result: unknown; assistantContent: string }> {
	const { tool, arguments: args, exec } = input;
	const handler = MCP_TOOL_MAP.get(tool);
	if (!handler) {
		return {
			done: false,
			result: { error: `Tool "${tool}" is not available. Available: ${MCP_TOOL_NAMES.join(', ')}` },
			assistantContent: JSON.stringify({ tool, arguments: args })
		};
	}

	exec.onEvent?.({ type: 'tool_call', tool, arguments: args });
	console.info('[agent-loop] tool start', { tool, arguments: args });
	exec.onEvent?.({ type: 'tool_executing', tool });

	const toolStart = Date.now();
	let result: unknown;
	try {
		result = sanitizeMcpToolResult(await handler(exec.ctx, args));

		if (
			exec.deleteIntent &&
			tool === 'retrieve_thoughts' &&
			result &&
			typeof result === 'object' &&
			Array.isArray((result as { results?: unknown[] }).results)
		) {
			const retrieveResults = (result as { results: unknown[] }).results;
			const strongMatch = findUniqueStrongRetrieveMatch(retrieveResults);
			if (strongMatch) {
				const deleteHandler = MCP_TOOL_MAP.get('delete_thought');
				if (deleteHandler) {
					exec.onEvent?.({
						type: 'tool_call',
						tool: 'delete_thought',
						arguments: { thought_id: strongMatch.id }
					});
					exec.onEvent?.({ type: 'tool_executing', tool: 'delete_thought' });
					const deleteStart = Date.now();
					const deleteResult = await deleteHandler(exec.ctx, { thought_id: strongMatch.id });
					const deletePreview = formatToolResultPreview('delete_thought', deleteResult);
					exec.onEvent?.({ type: 'tool_result', tool: 'delete_thought', preview: deletePreview });
					await logActivityCall(exec.db ?? getDb(), exec.userId, {
						provider: AGENT_TOOL_ACTIVITY_PROVIDER,
						operation: 'tool_call.delete_thought',
						baseCostUsd: 0,
						context: `auto after retrieve: ${strongMatch.id}`,
						durationMs: Date.now() - deleteStart
					});
					return {
						done: true,
						response: `Deleted 1 thought (${strongMatch.id.slice(0, 8)}…): ${strongMatch.snippet}`
					};
				}
			}
		}

		const preview = formatToolResultPreview(tool, result);
		exec.onEvent?.({ type: 'tool_result', tool, preview });
		console.info('[agent-loop] tool done', {
			tool,
			durationMs: Date.now() - toolStart,
			result: formatToolResultPreview(tool, redactForLog(result))
		});
		await logActivityCall(exec.db ?? getDb(), exec.userId, {
			provider: AGENT_TOOL_ACTIVITY_PROVIDER,
			operation: `tool_call.${tool}`,
			baseCostUsd: 0,
			context: Object.entries(args)
				.map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`)
				.join(', '),
			durationMs: Date.now() - toolStart
		});

		if (
			tool === 'answer_question' &&
			result &&
			typeof result === 'object' &&
			'answer' in result &&
			typeof (result as ComposedAnswer).answer === 'string'
		) {
			return {
				done: true,
				response: formatComposedAnswerForUser((result as ComposedAnswer).answer)
			};
		}
	} catch (err) {
		console.error('[agent-loop] tool error', {
			tool,
			error: err instanceof Error ? err.message : String(err)
		});
		result = { error: err instanceof Error ? err.message : String(err) };
		const errorPreview = formatToolResultPreview(tool, result);
		exec.onEvent?.({ type: 'tool_result', tool, preview: errorPreview, failed: true });
		await logActivityCall(exec.db ?? getDb(), exec.userId, {
			provider: AGENT_TOOL_ACTIVITY_PROVIDER,
			operation: `tool_error.${tool}`,
			baseCostUsd: 0,
			context: Object.entries(args)
				.map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`)
				.join(', '),
			durationMs: Date.now() - toolStart
		});
	}

	return {
		done: false,
		result,
		assistantContent: exec.assistantContentForHistory ?? JSON.stringify({ tool, arguments: args })
	};
}

function formatSingleToolResponse(tool: string, result: unknown): string {
	if (
		tool === 'answer_question' &&
		result &&
		typeof result === 'object' &&
		'answer' in result &&
		typeof (result as ComposedAnswer).answer === 'string'
	) {
		return formatComposedAnswerForUser((result as ComposedAnswer).answer);
	}
	const preview = formatToolResultPreview(tool, result);
	return formatToolResultForDisplay(tool, preview);
}

async function runSingleToolPath(input: {
	userId: string;
	tool: string;
	arguments: Record<string, unknown>;
	exec: ToolExecutionContext;
	userMessages: ChatMessage[];
}): Promise<AgentChatResult> {
	const maxAttempts = input.tool === 'answer_question' ? 2 : 1;
	let lastResult: unknown;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const outcome = await executeAgentToolCall({
			tool: input.tool,
			arguments: input.arguments,
			exec: input.exec
		});

		if (outcome.done) {
			return {
				response: outcome.response,
				messages: [
					...input.userMessages,
					{ role: 'assistant', content: outcome.response }
				]
			};
		}

		lastResult = outcome.result;
		const hasError =
			lastResult &&
			typeof lastResult === 'object' &&
			'error' in lastResult &&
			typeof (lastResult as { error?: unknown }).error === 'string';

		if (!hasError || attempt === maxAttempts - 1) {
			break;
		}
		console.info('[agent-loop] retrying tool after error', { tool: input.tool, attempt: attempt + 1 });
	}

	return {
		response: formatSingleToolResponse(input.tool, lastResult),
		messages: [
			...input.userMessages,
			{
				role: 'assistant',
				content: formatSingleToolResponse(input.tool, lastResult)
			}
		]
	};
}

export async function agentChat(input: {
	userId: string;
	messages: ChatMessage[];
	onEvent?: (event: ChatStreamEvent) => void;
	db?: ReturnType<typeof getDb>;
}): Promise<AgentChatResult> {
	const ctx: McpToolContext = {
		userId: input.userId,
		onToolProgress: (event) => {
			input.onEvent?.({
				type: 'tool_progress',
				tool: event.tool,
				phase: event.phase,
				label: event.label
			});
		}
	};

	const lastUserMessage =
		[...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
	const deleteIntent = isDeleteIntent(lastUserMessage);

	const exec: ToolExecutionContext = {
		userId: input.userId,
		ctx,
		deleteIntent,
		onEvent: input.onEvent,
		db: input.db
	};

	input.onEvent?.({ type: 'agent_progress', label: 'Planning next step…' });
	const route = await routeAgentMessage({ userId: input.userId, userMessage: lastUserMessage });

	if (route.mode === 'single_tool') {
		console.info('[agent-loop] single-tool path', { tool: route.tool });
		return runSingleToolPath({
			userId: input.userId,
			tool: route.tool,
			arguments: route.arguments,
			exec,
			userMessages: input.messages
		});
	}

	console.info('[agent-loop] multi-step path');
	const messages: ChatMessage[] = [
		{ role: 'system', content: AGENT_SYSTEM_PROMPT },
		...input.messages
	];

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		console.error('[agent-loop] iteration', { iteration, messageCount: messages.length });

		input.onEvent?.({
			type: 'agent_progress',
			label: iteration === 0 ? 'Planning next step…' : 'Preparing your reply…'
		});
		const llmStart = Date.now();
		console.info('[agent-loop] llm request start', {
			iteration,
			messageCount: messages.length,
			promptChars: messages.reduce((n, m) => n + m.content.length, 0)
		});
		for (const message of messages) {
			console.log(`[agent-loop] prompt ${message.role}:\n${message.content}`);
		}
		const raw = await llmChatCompletion({
			userId: input.userId,
			messages,
			temperature: 0,
			logContext: `agent_iter_${iteration}`
		});
		console.info('[agent-loop] llm request done', { iteration, durationMs: Date.now() - llmStart });

		const response = raw as { choices?: Array<{ message?: { content?: string } }> };
		const content = response?.choices?.[0]?.message?.content?.trim() ?? '';

		if (!content) {
			console.error('[agent-loop] LLM returned empty content');
			return { response: 'The assistant did not produce a response.', messages };
		}

		console.error('[agent-loop] LLM raw response', { preview: content.slice(0, 300) });
		const parsed = parseResponse(content);

		if (parsed.thinking) {
			input.onEvent?.({ type: 'thinking', content: parsed.thinking });
		}

		if (parsed.type === 'tool_call') {
			const handler = MCP_TOOL_MAP.get(parsed.tool);
			if (!handler) {
				console.error('[agent-loop] unknown tool requested', { tool: parsed.tool });
				messages.push({ role: 'assistant', content });
				messages.push({
					role: 'user',
					content: `Error: tool "${parsed.tool}" is not available. Available tools: ${MCP_TOOL_NAMES.join(', ')}`
				});
				continue;
			}

			const outcome = await executeAgentToolCall({
				tool: parsed.tool,
				arguments: parsed.arguments,
				exec: { ...exec, assistantContentForHistory: content }
			});

			if (outcome.done) {
				messages.push({ role: 'assistant', content });
				return { response: outcome.response, messages };
			}

			messages.push({ role: 'assistant', content });
			messages.push({
				role: 'user',
				content: `Tool result for ${parsed.tool}:\n${formatToolResultForAgentMessage(parsed.tool, outcome.result)}\n\nIf more tools are needed, call one now. Otherwise give your final answer using {"answer": "<your response>"}.`
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

// Re-export for tests that assert tool surface parity with MCP server.
export { MCP_TOOL_DEFINITIONS };
