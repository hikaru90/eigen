import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { logActivityCall } from '$lib/server/activity/log-call';
import { AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
import { getDb } from '$lib/server/db';
import {
	buildAgentToolDescriptionBlock,
	buildGroundingAgentToolDescriptionBlock,
	GROUNDING_TOOL_NAMES,
	MCP_TOOL_DEFINITIONS,
	MCP_TOOL_MAP,
	MCP_TOOL_NAMES
} from '$lib/server/mcp/registry';
import type { ChatSessionMode } from '$lib/server/db/brain.schema';
import type { McpToolContext } from '$lib/server/mcp/tools';
import type { ChatStreamEvent } from '$lib/chat/chat-stream-types';
import { formatToolResultForDisplay } from '$lib/chat/chat-stream-types';
import {
	formatComposedAnswerForUser,
	type ComposedAnswer
} from '$lib/server/qa/compose-answer';
import { redactForLog } from '$lib/server/observability/redact-for-log';
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings';
import { readThoughtIdFromToolArgs, tryReadThoughtIdFromToolArgs } from '$lib/server/validation/mcp-args';
import { routeAgentMessage, type AgentRouteResult } from '$lib/server/llm/agent-router';
import { classifyChatIntent } from '$lib/server/llm/classify-chat-intent';
import { classifyDeleteIntent } from '$lib/server/llm/classify-delete-intent';
import {
	findUniqueStrongRetrieveMatch,
	formatToolResultForAgentMessage,
	formatToolResultPreview
} from '$lib/server/llm/agent-tool-result-compact';
import { retrieveThoughtRowsForDeleteRequest } from '$lib/server/retrieval/retrieve-for-delete';
import {
	buildDeleteTargetCandidates,
	resolveDeleteTargets,
	type DeleteTargetCandidate
} from '$lib/server/retrieval/resolve-delete-target';

const MAX_ITERATIONS = 10;

const DELETE_NOT_FOUND_RESPONSE =
	'I could not find a stored thought matching your delete request, so nothing was deleted.';

const TOOL_DESCRIPTION_BLOCK = buildAgentToolDescriptionBlock();
const GROUNDING_TOOL_DESCRIPTION_BLOCK = buildGroundingAgentToolDescriptionBlock();

const GROUNDING_SYSTEM_PROMPT = [
	'You are a warm, thoughtful interviewer helping a new user of a personal memory app understand themselves.',
	'Your goal is to learn who they are: identity, work, values, relationships, psychology, daily routines, and active projects.',
	'Ask one question at a time. Follow up naturally on their answers — this is a conversation, not a form.',
	'For projects (GTD): ask what they are actively working on, the desired outcome, and the concrete next action for each project.',
	'',
	'Per user message — strict workflow:',
	'1. If they shared personal context: ONE capture_grounding call with every relevant facet in a single facets array.',
	'2. Then respond with {"answer": "<warm reply and optional next question>"} — never chain multiple capture_grounding calls in one turn.',
	'3. When 4+ distinct facet areas are saved: call complete_grounding_session, then {"answer": "<brief closing>"}.',
	'',
	'Facet keys: identity, work, values, relationships, psychology, routines, projects.',
	'Grounding data stays private to this user and improves how their thoughts are classified.',
	'',
	'Respond with JSON only. To call a tool:',
	'{"tool": "<tool_name>", "arguments": {<args>}}',
	'To speak to the user (required after every capture_grounding, and for opening questions):',
	'{"answer": "<your message>"}',
	'',
	'=== AVAILABLE TOOLS ===',
	GROUNDING_TOOL_DESCRIPTION_BLOCK,
	'',
	'=== RULES ===',
	'- Only use capture_grounding and complete_grounding_session.',
	'- At most one capture_grounding per user message.',
	'- Never invent facts the user did not share.',
	'- Output ONLY the JSON object.'
].join('\n');

function buildGroundingCaptureFollowUp(tool: string, result: unknown): string {
	const compact = formatToolResultForAgentMessage(tool, result);
	const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
	const facetCount = typeof obj.facetCount === 'number' ? obj.facetCount : 0;
	const suggestComplete = obj.suggestComplete === true;
	let text = `Tool result for ${tool}:\n${compact}\n\n`;
	text += `Saved ${facetCount} facet area(s). You MUST respond with {"answer": "<your reply>"} now — do NOT call capture_grounding again until the user sends another message.`;
	if (suggestComplete) {
		text +=
			' Enough facets are saved — on your next turn you may call complete_grounding_session if the conversation feels complete.';
	}
	return text;
}

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
	'- Delete by description: retrieve_thoughts first, then delete_thought with UUID id(s) from results — never pass titles or prose as thought_id. Call delete_thought once per id when removing multiple thoughts.',
	'- Any question (how/what/when/who/why, any language): answer_question — never capture_thought for questions.',
	'- capture_thought only when the user explicitly asks to save/remember/note something new.',
	'- When unsure between capture and answer, prefer answer_question.',
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
	deleteRequest: string;
	onEvent?: (event: ChatStreamEvent) => void;
	db?: ReturnType<typeof getDb>;
	assistantContentForHistory?: string;
};

function normalizeAgentToolArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
	if (tool !== 'delete_thought' && tool !== 'edit_thought') return args;
	try {
		const thoughtId = readThoughtIdFromToolArgs(args);
		return { ...args, thought_id: thoughtId };
	} catch {
		return args;
	}
}

function resolveDeleteRoute(
	deleteIntent: boolean,
	route: AgentRouteResult,
	userMessage: string
): AgentRouteResult {
	if (!deleteIntent || route.mode !== 'single_tool') return route;

	if (route.tool === 'delete_thought') {
		if (tryReadThoughtIdFromToolArgs(route.arguments)) return route;
		return { mode: 'single_tool', tool: 'retrieve_thoughts', arguments: {} };
	}

	return { mode: 'multi_step' };
}

function formatDeletedThoughtsResponse(deleted: DeleteTargetCandidate[]): string {
	if (deleted.length === 1) {
		const t = deleted[0];
		return `Deleted 1 thought (${t.thoughtId.slice(0, 8)}…): ${t.snippet}`;
	}
	const lines = deleted.map((t) => `- ${t.thoughtId.slice(0, 8)}…: ${t.snippet}`);
	return `Deleted ${deleted.length} thoughts:\n${lines.join('\n')}`;
}

async function runMatchedDeletes(input: {
	exec: ToolExecutionContext;
	targets: DeleteTargetCandidate[];
}): Promise<{ done: true; response: string }> {
	if (input.targets.length === 0) {
		return { done: true, response: DELETE_NOT_FOUND_RESPONSE };
	}

	const deleteHandler = MCP_TOOL_MAP.get('delete_thought');
	if (!deleteHandler) {
		return { done: true, response: DELETE_NOT_FOUND_RESPONSE };
	}

	const deleted: DeleteTargetCandidate[] = [];
	const failed: Array<{ thoughtId: string; error: string }> = [];

	for (const target of input.targets) {
		input.exec.onEvent?.({
			type: 'tool_call',
			tool: 'delete_thought',
			arguments: { thought_id: target.thoughtId }
		});
		input.exec.onEvent?.({ type: 'tool_executing', tool: 'delete_thought' });
		const deleteStart = Date.now();
		try {
			const deleteResult = await deleteHandler(input.exec.ctx, { thought_id: target.thoughtId });
			const deletePreview = formatToolResultPreview('delete_thought', deleteResult);
			input.exec.onEvent?.({ type: 'tool_result', tool: 'delete_thought', preview: deletePreview });
			await logActivityCall(input.exec.db ?? getDb(), input.exec.userId, {
				provider: AGENT_TOOL_ACTIVITY_PROVIDER,
				operation: 'tool_call.delete_thought',
				baseCostUsd: 0,
				context: `auto after retrieve: ${target.thoughtId}`,
				durationMs: Date.now() - deleteStart
			});
			deleted.push(target);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const errorPreview = formatToolResultPreview('delete_thought', { error: message });
			input.exec.onEvent?.({
				type: 'tool_result',
				tool: 'delete_thought',
				preview: errorPreview,
				failed: true
			});
			await logActivityCall(input.exec.db ?? getDb(), input.exec.userId, {
				provider: AGENT_TOOL_ACTIVITY_PROVIDER,
				operation: 'tool_error.delete_thought',
				baseCostUsd: 0,
				context: `auto after retrieve: ${target.thoughtId}`,
				durationMs: Date.now() - deleteStart
			});
			failed.push({ thoughtId: target.thoughtId, error: message });
		}
	}

	if (deleted.length === 0) {
		const detail = failed.map((f) => `${f.thoughtId.slice(0, 8)}…: ${f.error}`).join('; ');
		return {
			done: true,
			response: `Could not delete any matching thoughts. ${detail}`
		};
	}

	let response = formatDeletedThoughtsResponse(deleted);
	if (failed.length > 0) {
		const detail = failed.map((f) => `${f.thoughtId.slice(0, 8)}…: ${f.error}`).join('; ');
		response = `${response}\n\nFailed to delete ${failed.length}: ${detail}`;
	}
	return { done: true, response };
}

async function tryCompleteDeleteAfterRetrieve(
	exec: ToolExecutionContext,
	retrieveResults: unknown[]
): Promise<{ done: true; response: string }> {
	const uniqueStrong = findUniqueStrongRetrieveMatch(retrieveResults);
	if (uniqueStrong) {
		return runMatchedDeletes({
			exec,
			targets: [
				{
					thoughtId: uniqueStrong.id,
					snippet: uniqueStrong.snippet,
					scoreNormalized: 1
				}
			]
		});
	}

	const candidates = buildDeleteTargetCandidates(retrieveResults);
	if (candidates.length === 0) {
		return { done: true, response: DELETE_NOT_FOUND_RESPONSE };
	}

	const resolved = await resolveDeleteTargets({
		userId: exec.userId,
		deleteRequest: exec.deleteRequest,
		candidates
	});
	if (resolved.length === 0) {
		return { done: true, response: DELETE_NOT_FOUND_RESPONSE };
	}

	return runMatchedDeletes({ exec, targets: resolved });
}

async function runDeleteSemanticRetrieveAndComplete(
	exec: ToolExecutionContext
): Promise<{ done: true; response: string }> {
	const deleteRequest = exec.deleteRequest.trim();
	if (!deleteRequest) {
		return { done: true, response: DELETE_NOT_FOUND_RESPONSE };
	}

	exec.onEvent?.({
		type: 'tool_call',
		tool: 'retrieve_thoughts',
		arguments: { delete_request: deleteRequest }
	});
	exec.onEvent?.({ type: 'tool_executing', tool: 'retrieve_thoughts' });

	const retrieveStart = Date.now();
	const { queries, results } = await retrieveThoughtRowsForDeleteRequest({
		userId: exec.userId,
		deleteRequest
	});

	await logActivityCall(exec.db ?? getDb(), exec.userId, {
		provider: AGENT_TOOL_ACTIVITY_PROVIDER,
		operation: 'tool_call.retrieve_thoughts',
		baseCostUsd: 0,
		context: `delete search: ${queries.join('; ').slice(0, 120)}`,
		durationMs: Date.now() - retrieveStart
	});

	return tryCompleteDeleteAfterRetrieve(exec, results);
}

async function executeAgentToolCall(input: {
	tool: string;
	arguments: Record<string, unknown>;
	exec: ToolExecutionContext;
}): Promise<{ done: true; response: string; messages?: ChatMessage[] } | { done: false; result: unknown; assistantContent: string }> {
	const { tool, exec } = input;
	const args = normalizeAgentToolArgs(tool, input.arguments);

	if (
		exec.deleteIntent &&
		exec.deleteRequest.trim() &&
		(tool === 'retrieve_thoughts' ||
			(tool === 'delete_thought' && !tryReadThoughtIdFromToolArgs(args)))
	) {
		return runDeleteSemanticRetrieveAndComplete(exec);
	}

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

		if (
			tool === 'complete_grounding_session' &&
			result &&
			typeof result === 'object' &&
			'redirectTo' in result
		) {
			const r = result as { redirectTo?: string; initialCompleted?: boolean };
			const redirect = typeof r.redirectTo === 'string' ? r.redirectTo : '/capture';
			return {
				done: true,
				response: `Grounding complete. You can start capturing thoughts at ${redirect}.`
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

async function runGroundingAgentLoop(input: {
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

	const exec: ToolExecutionContext = {
		userId: input.userId,
		ctx,
		deleteIntent: false,
		deleteRequest: '',
		onEvent: input.onEvent,
		db: input.db
	};

	const messages: ChatMessage[] = [
		{ role: 'system', content: GROUNDING_SYSTEM_PROMPT },
		...input.messages
	];

	let groundingCapturedThisTurn = false;

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		input.onEvent?.({
			type: 'agent_progress',
			label: iteration === 0 ? 'Starting conversation…' : 'Listening…'
		});

		const raw = await llmChatCompletion({
			userId: input.userId,
			messages,
			temperature: 0.3,
			logContext: `grounding_iter_${iteration}`
		});

		const response = raw as { choices?: Array<{ message?: { content?: string } }> };
		const content = response?.choices?.[0]?.message?.content?.trim() ?? '';
		if (!content) {
			return { response: 'The assistant did not produce a response.', messages };
		}

		const parsed = parseResponse(content);
		if (parsed.thinking) {
			input.onEvent?.({ type: 'thinking', content: parsed.thinking });
		}

		if (parsed.type === 'tool_call') {
			if (!(GROUNDING_TOOL_NAMES as readonly string[]).includes(parsed.tool)) {
				messages.push({ role: 'assistant', content });
				messages.push({
					role: 'user',
					content: `Error: tool "${parsed.tool}" is not available in grounding mode. Use: ${GROUNDING_TOOL_NAMES.join(', ')}`
				});
				continue;
			}

			if (parsed.tool === 'capture_grounding' && groundingCapturedThisTurn) {
				messages.push({ role: 'assistant', content });
				messages.push({
					role: 'user',
					content:
						'capture_grounding was already called for this user message. Respond with JSON only: {"answer": "<your conversational reply or next question>"}. Do not call capture_grounding again until the user replies.'
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

			if (parsed.tool === 'capture_grounding') {
				groundingCapturedThisTurn = true;
			}

			messages.push({ role: 'assistant', content });
			messages.push({
				role: 'user',
				content:
					parsed.tool === 'capture_grounding'
						? buildGroundingCaptureFollowUp(parsed.tool, outcome.result)
						: `Tool result for ${parsed.tool}:\n${formatToolResultForAgentMessage(parsed.tool, outcome.result)}\n\nContinue the conversation or call complete_grounding_session when ready.`
			});
			continue;
		}

		messages.push({ role: 'assistant', content });
		return { response: parsed.content, messages };
	}

	return {
		response: 'The grounding conversation took too many steps. Please try again.',
		messages
	};
}

export async function agentChat(input: {
	userId: string;
	messages: ChatMessage[];
	onEvent?: (event: ChatStreamEvent) => void;
	db?: ReturnType<typeof getDb>;
	mode?: ChatSessionMode;
}): Promise<AgentChatResult> {
	if (input.mode === 'grounding') {
		return runGroundingAgentLoop(input);
	}

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
	const deleteIntent = await classifyDeleteIntent({
		userId: input.userId,
		userMessage: lastUserMessage
	});

	const exec: ToolExecutionContext = {
		userId: input.userId,
		ctx,
		deleteIntent,
		deleteRequest: lastUserMessage,
		onEvent: input.onEvent,
		db: input.db
	};

	input.onEvent?.({ type: 'agent_progress', label: 'Planning next step…' });
	const route = await routeAgentMessage({ userId: input.userId, userMessage: lastUserMessage });

	let resolvedRoute: AgentRouteResult = resolveDeleteRoute(deleteIntent, route, lastUserMessage);
	if (
		!deleteIntent &&
		resolvedRoute.mode === 'single_tool' &&
		resolvedRoute.tool === 'capture_thought'
	) {
		const intent = await classifyChatIntent({ userId: input.userId, userMessage: lastUserMessage });
		console.info('[agent-loop] capture gate', {
			intent,
			userMessagePreview: lastUserMessage.slice(0, 80)
		});
		if (intent === 'answer') {
			resolvedRoute = {
				mode: 'single_tool',
				tool: 'answer_question',
				arguments: { question: lastUserMessage }
			};
		} else if (intent === 'manage') {
			resolvedRoute = { mode: 'multi_step' };
		}
	}

	if (resolvedRoute.mode === 'single_tool') {
		console.info('[agent-loop] single-tool path', { tool: resolvedRoute.tool });
		return runSingleToolPath({
			userId: input.userId,
			tool: resolvedRoute.tool,
			arguments: resolvedRoute.arguments,
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
