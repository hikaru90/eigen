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
	it('exposes only the four client memory tools over HTTP MCP', () => {
		expect(MCP_CLIENT_EXPOSED_TOOL_NAMES).toEqual([
			'capture_thought',
			'retrieve_thoughts',
			'edit_thought',
			'delete_thought'
		]);
		expect(MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES);
	});

	it('keeps internal chat tools registered but hidden from MCP clients', () => {
		expect(MCP_TOOL_DEFINITIONS.length).toBeGreaterThan(MCP_EXPOSED_TOOL_DEFINITIONS.length);
		expect(MCP_AGENT_TOOL_NAMES).toEqual(MCP_TOOL_DEFINITIONS.map((t) => t.name));
		expect(MCP_AGENT_TOOL_NAMES).toContain('list_thoughts');
		expect(MCP_AGENT_TOOL_NAMES).toContain('answer_question');
		expect(MCP_AGENT_TOOL_NAMES).toContain('set_status');
		expect(MCP_AGENT_TOOL_NAMES).not.toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES);
	});

	it('isMcpExposedTool gates HTTP MCP; isAgentTool gates in-app chat', () => {
		expect(isMcpExposedTool('capture_thought')).toBe(true);
		expect(isMcpExposedTool('list_thoughts')).toBe(false);
		expect(isMcpExposedTool('answer_question')).toBe(false);

		expect(isAgentTool('list_thoughts')).toBe(true);
		expect(isAgentTool('answer_question')).toBe(true);
		expect(isAgentTool('nope')).toBe(false);
	});

	it('documents edit_thought status changes for MCP clients', () => {
		const edit = MCP_EXPOSED_TOOL_DEFINITIONS.find((t) => t.name === 'edit_thought');
		expect(edit?.description).toMatch(/mark complete/i);
		expect(edit?.description).toMatch(/archive/i);
		expect(edit?.description).toMatch(/set_status/i);
	});
});
