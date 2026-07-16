import { describe, expect, it } from 'vitest';
import {
	isAgentTool,
	isMcpExposedTool,
	MCP_AGENT_TOOL_NAMES,
	MCP_CLIENT_EXPOSED_TOOL_NAMES,
	MCP_EXPOSED_TOOL_DEFINITIONS,
	MCP_TOOL_DEFINITIONS
} from './registry';

describe('MCP tool registry exposure', () => {
	it('exposes only the four client memory tools over HTTP MCP and chat', () => {
		expect(MCP_CLIENT_EXPOSED_TOOL_NAMES).toEqual([
			'capture_thought',
			'retrieve_thoughts',
			'edit_thought',
			'delete_thought'
		]);
		expect(MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES);
		expect(MCP_AGENT_TOOL_NAMES).toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES);
		expect(MCP_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES);
	});

	it('does not register chat-only tools', () => {
		expect(MCP_AGENT_TOOL_NAMES).not.toContain('list_thoughts');
		expect(MCP_AGENT_TOOL_NAMES).not.toContain('answer_question');
		expect(MCP_AGENT_TOOL_NAMES).not.toContain('set_status');
		expect(MCP_AGENT_TOOL_NAMES).not.toContain('list_temporal_events');
		expect(MCP_AGENT_TOOL_NAMES).not.toContain('manage_temporal_event');
	});

	it('isMcpExposedTool and isAgentTool gate the same four-tool surface', () => {
		expect(isMcpExposedTool('capture_thought')).toBe(true);
		expect(isMcpExposedTool('list_thoughts')).toBe(false);
		expect(isMcpExposedTool('answer_question')).toBe(false);

		expect(isAgentTool('capture_thought')).toBe(true);
		expect(isAgentTool('retrieve_thoughts')).toBe(true);
		expect(isAgentTool('list_thoughts')).toBe(false);
		expect(isAgentTool('answer_question')).toBe(false);
		expect(isAgentTool('nope')).toBe(false);
	});

	it('documents edit_thought status changes for MCP clients', () => {
		const edit = MCP_EXPOSED_TOOL_DEFINITIONS.find((t) => t.name === 'edit_thought');
		expect(edit?.description).toMatch(/mark complete/i);
		expect(edit?.description).toMatch(/archive/i);
		expect(edit?.description).toMatch(/set_status/i);
		expect(edit?.description).toMatch(/any category/i);
		expect(edit?.description).toMatch(/not a todo/i);

		const del = MCP_EXPOSED_TOOL_DEFINITIONS.find((t) => t.name === 'delete_thought');
		expect(del?.description).toMatch(/soft-remove/i);
		expect(del?.description).toMatch(/any category/i);
	});
});
