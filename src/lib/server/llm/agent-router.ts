import { env } from '$env/dynamic/private';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { MCP_EXPOSED_TOOL_DEFINITIONS, MCP_TOOL_NAMES } from '$lib/server/mcp/registry';

export type AgentRouteResult =
	| { mode: 'single_tool'; tool: string; arguments: Record<string, unknown> }
	| { mode: 'multi_step' };

const TOOL_SUMMARY = MCP_EXPOSED_TOOL_DEFINITIONS.map(
	(t) => `- ${t.name}: ${t.description}`
).join('\n');

export const ROUTER_SYSTEM_PROMPT = [
	'You route user messages for a personal memory assistant. Return JSON only — no markdown fences.',
	'',
	'Tools:',
	TOOL_SUMMARY,
	'',
	'Return exactly one of:',
	'{"tool":"<tool_name>","arguments":{...}}',
	'{"mode":"multi_step"}',
	'',
	'Routing:',
	'- Any question (how/what/when/who/why, in any language) → answer_question with {"question":"<user message>"}',
	'- Never route questions to capture_thought — e.g. "Wie koche ich Japanese-Glazed Salmon?" is answer_question, not capture.',
	'- capture_thought ONLY when the user explicitly asks to save/remember/note something (e.g. "remember that…", "save this:", "note to self").',
	'- Completion reports, edit/delete without id, or any sequence needing search then act → multi_step',
	'- delete_thought requires a persisted thought UUID — never route delete-by-description to delete_thought; use multi_step or retrieve_thoughts first.',
	'- When unsure between capture and answer, prefer answer_question.',
	'',
	`Valid tool names: ${MCP_TOOL_NAMES.join(', ')}`
].join('\n');

function parseRouterJson(text: string): unknown {
	let trimmed = text.trim();
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fenceMatch) trimmed = fenceMatch[1].trim();

	const firstBrace = trimmed.indexOf('{');
	if (firstBrace >= 0) {
		let depth = 0;
		for (let i = firstBrace; i < trimmed.length; i++) {
			if (trimmed[i] === '{') depth++;
			else if (trimmed[i] === '}') {
				depth--;
				if (depth === 0) {
					return JSON.parse(trimmed.slice(firstBrace, i + 1));
				}
			}
		}
	}
	return JSON.parse(trimmed);
}

export function parseAgentRouteResponse(text: string): AgentRouteResult {
	const parsed = parseRouterJson(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Agent router response is not a JSON object');
	}
	const obj = parsed as Record<string, unknown>;

	if (obj.mode === 'multi_step') {
		return { mode: 'multi_step' };
	}

	if (typeof obj.tool === 'string' && obj.arguments && typeof obj.arguments === 'object') {
		return {
			mode: 'single_tool',
			tool: obj.tool,
			arguments: obj.arguments as Record<string, unknown>
		};
	}

	throw new Error('Agent router response must include tool+arguments or mode=multi_step');
}

/**
 * Small-LLM router: picks a single tool or escalates to the multi-step agent loop.
 * Uses LLM_RULE_ROUTER when set, otherwise falls back to the chat routing rule.
 */
export async function routeAgentMessage(input: {
	userId: string;
	userMessage: string;
}): Promise<AgentRouteResult> {
	const trimmed = input.userMessage.trim();
	if (!trimmed) {
		throw new Error('routeAgentMessage: userMessage must be non-empty');
	}

	const messages: ChatMessage[] = [
		{ role: 'system', content: ROUTER_SYSTEM_PROMPT },
		{ role: 'user', content: trimmed }
	];

	console.info('[agent-router] request start', {
		promptChars: messages.reduce((n, m) => n + m.content.length, 0)
	});
	for (const message of messages) {
		console.log(`[agent-router] prompt ${message.role}:\n${message.content}`);
	}

	const routerRuleId = env.LLM_RULE_ROUTER?.trim() || undefined;
	const raw = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0,
		logContext: 'agent_router',
		routingRuleId: routerRuleId
	});

	const response = raw as { choices?: Array<{ message?: { content?: string } }> };
	const content = response?.choices?.[0]?.message?.content?.trim() ?? '';
	if (!content) {
		throw new Error('Agent router returned empty content');
	}

	console.info('[agent-router] response', { preview: content.slice(0, 200) });
	const route = parseAgentRouteResponse(content);
	console.info('[agent-router] parsed', route);
	return route;
}
