import { describe, expect, it } from 'vitest';
import { parseAgentRouteResponse, ROUTER_SYSTEM_PROMPT } from './agent-router';

describe('parseAgentRouteResponse', () => {
	it('parses single-tool route', () => {
		const route = parseAgentRouteResponse(
			JSON.stringify({ tool: 'answer_question', arguments: { question: 'Where am I?' } })
		);
		expect(route).toEqual({
			mode: 'single_tool',
			tool: 'answer_question',
			arguments: { question: 'Where am I?' }
		});
	});

	it('parses multi_step route', () => {
		expect(parseAgentRouteResponse(JSON.stringify({ mode: 'multi_step' }))).toEqual({
			mode: 'multi_step'
		});
	});

	it('parses fenced JSON', () => {
		const route = parseAgentRouteResponse(
			'```json\n{"tool":"capture_thought","arguments":{"raw":"remember this"}}\n```'
		);
		expect(route.mode).toBe('single_tool');
		if (route.mode === 'single_tool') {
			expect(route.tool).toBe('capture_thought');
		}
	});

	it('throws on invalid shape', () => {
		expect(() => parseAgentRouteResponse('{"status":"ok"}')).toThrow(/tool\+arguments or mode/);
	});
});

describe('ROUTER_SYSTEM_PROMPT', () => {
	it('lists all MCP tools compactly', () => {
		expect(ROUTER_SYSTEM_PROMPT).toContain('answer_question');
		expect(ROUTER_SYSTEM_PROMPT).toContain('multi_step');
		expect(ROUTER_SYSTEM_PROMPT.length).toBeLessThan(3500);
	});

	it('forbids routing questions to capture_thought', () => {
		expect(ROUTER_SYSTEM_PROMPT).toContain('Never route questions to capture_thought');
		expect(ROUTER_SYSTEM_PROMPT).toContain('Wie koche ich Japanese-Glazed Salmon?');
		expect(ROUTER_SYSTEM_PROMPT).toContain('prefer answer_question');
	});
});
