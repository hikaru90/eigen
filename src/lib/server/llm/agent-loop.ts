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
import {
	formatComposedAnswerForUser,
	type ComposedAnswer
} from '$lib/server/qa/compose-answer';
import { redactForLog } from '$lib/server/observability/redact-for-log';
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings';
import {
	findUniqueStrongRetrieveMatch,
	formatToolResultForAgentMessage,
	formatToolResultPreview,
	isDeleteIntent
} from '$lib/server/llm/agent-tool-result-compact';

const MAX_ITERATIONS = 10;

const TOOL_DESCRIPTION_BLOCK = buildAgentToolDescriptionBlock();

const SYSTEM_PROMPT = [
	'You are an AI assistant for the user\'s personal memory store (PostgreSQL with vector embeddings and an Apache AGE property graph). You have the same MCP tools as the external memory server.',
	'',
	'=== COMPLETION / "I DID SOMETHING" (check memories first) ===',
	'When the user reports they did, finished, completed, bought, attended, or otherwise accomplished something — do NOT capture a new thought first. Call retrieve_thoughts with a query that describes what they did (hybrid semantic + graph search). From the results, find stored tasks, reminders, or notes that plausibly match.',
	'- Strong match (especially category task or clear semantic overlap): call edit_thought with edit_request like "mark as completed" or "mark done" and briefly note what you updated in your final answer.',
	'- Match that should leave memory but is obsolete as an open item: same as above (mark complete via edit_thought).',
	'- User clearly wants it gone, duplicate, or a mistaken capture: call delete_thought instead.',
	'- No reasonable match: say so in your final answer; only use capture_thought if they also want it logged as a new memory.',
	'- Multiple plausible matches: update the best single match or ask which one in your final answer — do not edit/delete several without clear intent.',
	'',
	'=== DEFAULT: ANSWER / Q&A ===',
	'When the user asks a question, wants information from their memories, or is chatting without clearly asking to store, edit, or delete — call answer_question with their message as `question` (rephrase for retrieval if helpful). Use the tool result to ground your final {"answer": "..."} with citations when available. Skip this default when the COMPLETION rules above apply.',
	'',
	'=== OTHER TOOLS ===',
	'- retrieve_thoughts: hybrid semantic, lexical, and graph search — required before edit/delete when matching an accomplishment to an existing memory; also for raw search/list requests.',
	'- list_thoughts: browse recent thoughts or find thought IDs (e.g. open tasks).',
	'- capture_thought: store a new note, task, idea, or fact — only when the user clearly wants to remember something new.',
	'- edit_thought: change text, mark tasks or thoughts complete, fix typos — use thought_id from list/retrieve when the user did not give an ID.',
	'- delete_thought: permanently remove a thought by thought_id; use list/retrieve first if the target is ambiguous.',
	'',
	'=== TOOL CALLING FORMAT ===',
	'Respond with a JSON object only. Two formats:',
	'',
	'To call a tool:',
	'{"tool": "<tool_name>", "arguments": {<args>}}',
	'',
	'To give the final answer after you are done with tools:',
	'{"answer": "<your response>"}',
	'',
	'=== AVAILABLE TOOLS ===',
	TOOL_DESCRIPTION_BLOCK,
	'',
	'=== BEHAVIOR RULES ===',
	'- Completion reports ("I did X", "finished Y", "got the Z done") always use retrieve_thoughts before capture_thought or answer_question.',
	'- Default to answer_question for questions and conversation about the user\'s memories; do not capture unless they clearly want to store something new.',
	'- Use capture_thought only when the user explicitly asks to remember, save, or log a new thought — never as the first step when they report completing something.',
	'- Use retrieve_thoughts for simple search/list requests without needing a composed answer.',
	'- For edit_thought or delete_thought without a thought_id: call retrieve_thoughts (preferred) or list_thoughts first, then act.',
	'- You may call multiple tools in sequence (e.g. search then edit) before the final answer.',
	'- Call retrieve_thoughts at most once per user message unless they explicitly ask for another search.',
	'- After a tool result, call another tool if more work is needed, otherwise {"answer": "..."}.',
	'- TRACEABILITY: Never claim a thought was updated or deleted unless the matching tool succeeded in this turn. In your final answer, cite thought id (short prefix), the summary field from tool results, and before/after text or status when edit_thought ran.',
	'- If a tool errors, explain clearly in your final answer.',
	'- Do not invent tool names or argument keys.',
	'- Output ONLY the JSON object. No greetings, no markdown fences.'
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

	// Strip markdown code fences (```json ... ```) if the LLM wraps the JSON.
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fenceMatch) {
		trimmed = fenceMatch[1].trim();
	}

	// Strip trailing backticks and any content after them (LLM sometimes appends ``` after JSON)
	trimmed = trimmed.replace(/```[\s\S]*$/, '').trim();

	// Find the first complete JSON object by scanning for balanced braces
	function tryParseJson(str: string): unknown {
		try {
			return JSON.parse(str);
		} catch {
			return undefined;
		}
	}

	let parsed: unknown = tryParseJson(trimmed);

	// If direct parse fails, try extracting the first JSON object by brace matching
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
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		...input.messages
	];

	const lastUserMessage =
		[...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
	const deleteIntent = isDeleteIntent(lastUserMessage);

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		console.error('[agent-loop] iteration', { iteration, messageCount: messages.length });

		input.onEvent?.({
			type: 'agent_progress',
			label: iteration === 0 ? 'Planning next step…' : 'Preparing your reply…'
		});
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

		if (parsed.thinking) {
			input.onEvent?.({ type: 'thinking', content: parsed.thinking });
		}

		if (parsed.type === 'tool_call') {
			input.onEvent?.({ type: 'tool_call', tool: parsed.tool, arguments: parsed.arguments });
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

			console.error('[agent-loop] executing tool', { tool: parsed.tool, args: parsed.arguments });
			input.onEvent?.({ type: 'tool_executing', tool: parsed.tool });
			let result: unknown;
			const toolStart = Date.now();
			try {
				result = sanitizeMcpToolResult(await handler(ctx, parsed.arguments));

				if (
					deleteIntent &&
					parsed.tool === 'retrieve_thoughts' &&
					result &&
					typeof result === 'object' &&
					Array.isArray((result as { results?: unknown[] }).results)
				) {
					const retrieveResults = (result as { results: unknown[] }).results;
					const strongMatch = findUniqueStrongRetrieveMatch(retrieveResults);
					if (strongMatch) {
						const deleteHandler = MCP_TOOL_MAP.get('delete_thought');
						if (deleteHandler) {
							input.onEvent?.({
								type: 'tool_call',
								tool: 'delete_thought',
								arguments: { thought_id: strongMatch.id }
							});
							input.onEvent?.({ type: 'tool_executing', tool: 'delete_thought' });
							const deleteStart = Date.now();
							const deleteResult = await deleteHandler(ctx, {
								thought_id: strongMatch.id
							});
							const deletePreview = formatToolResultPreview('delete_thought', deleteResult);
							input.onEvent?.({
								type: 'tool_result',
								tool: 'delete_thought',
								preview: deletePreview
							});
							console.error('[agent-loop] auto-deleted after single strong match', {
								thoughtId: strongMatch.id
							});
							await logActivityCall(input.db ?? getDb(), input.userId, {
								provider: AGENT_TOOL_ACTIVITY_PROVIDER,
								operation: 'tool_call.delete_thought',
								baseCostUsd: 0,
								context: `auto after retrieve: ${strongMatch.id}`,
								durationMs: Date.now() - deleteStart
							});
							const responseText = `Deleted 1 thought (${strongMatch.id.slice(0, 8)}…): ${strongMatch.snippet}`;
							messages.push({ role: 'assistant', content });
							messages.push({
								role: 'user',
								content: `Tool result for retrieve_thoughts:\n${formatToolResultForAgentMessage('retrieve_thoughts', result)}\n\nTool result for delete_thought:\n${formatToolResultForAgentMessage('delete_thought', deleteResult)}`
							});
							return { response: responseText, messages };
						}
					}
				}

				const preview = formatToolResultPreview(parsed.tool, result);
				input.onEvent?.({ type: 'tool_result', tool: parsed.tool, preview });
				console.error('[agent-loop] tool result', {
					tool: parsed.tool,
					result: formatToolResultPreview(parsed.tool, redactForLog(result))
				});
				const toolCallContext = parsed.arguments && typeof parsed.arguments === 'object'
					? Object.entries(parsed.arguments).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`).join(', ')
					: '';
				await logActivityCall(input.db ?? getDb(), input.userId, {
					provider: AGENT_TOOL_ACTIVITY_PROVIDER,
					operation: `tool_call.${parsed.tool}`,
					baseCostUsd: 0,
					context: toolCallContext,
					durationMs: Date.now() - toolStart
				});

				if (
					parsed.tool === 'answer_question' &&
					result &&
					typeof result === 'object' &&
					'answer' in result &&
					typeof (result as ComposedAnswer).answer === 'string'
				) {
					const composed = result as ComposedAnswer;
					const responseText = formatComposedAnswerForUser(composed.answer);
					messages.push({ role: 'assistant', content });
					messages.push({
						role: 'user',
						content: `Tool result for ${parsed.tool}:\n${formatToolResultForAgentMessage(parsed.tool, result)}`
					});
					return { response: responseText, messages };
				}
			} catch (err) {
				console.error('[agent-loop] tool error', { tool: parsed.tool, error: err instanceof Error ? err.message : String(err) });
				result = { error: err instanceof Error ? err.message : String(err) };
				const errorPreview = formatToolResultPreview(parsed.tool, result);
				input.onEvent?.({ type: 'tool_result', tool: parsed.tool, preview: errorPreview, failed: true });
				const toolErrorContext = parsed.arguments && typeof parsed.arguments === 'object'
					? Object.entries(parsed.arguments).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`).join(', ')
					: '';
				await logActivityCall(input.db ?? getDb(), input.userId, {
					provider: AGENT_TOOL_ACTIVITY_PROVIDER,
					operation: `tool_error.${parsed.tool}`,
					baseCostUsd: 0,
					context: toolErrorContext,
					durationMs: Date.now() - toolStart
				});
			}

			messages.push({ role: 'assistant', content });
			messages.push({
				role: 'user',
				content: `Tool result for ${parsed.tool}:\n${formatToolResultForAgentMessage(parsed.tool, result)}\n\nIf more tools are needed, call one now. Otherwise give your final answer using {"answer": "<your response>"}.`
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
