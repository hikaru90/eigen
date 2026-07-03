import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const MCP_URL = 'https://app.eigenmesh.de/api/mcp';
const MCP_AUTH = 'Bearer eigen_953bbbd2c566c581be2e5cd71de9ff76d7a01fa1cd74b741e6dc89cbcb2622a5';

type McpListedTool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

async function callMcp(method: string, params: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			Authorization: MCP_AUTH,
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream'
		},
		body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
	});
	const data = (await res.json()) as { error?: { message?: string }; result?: unknown };
	if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
	return data.result;
}

async function listMcpTools(): Promise<McpListedTool[]> {
	const result = (await callMcp('tools/list', {})) as { tools?: McpListedTool[] };
	if (!result?.tools?.length) {
		throw new Error('Eigen MCP tools/list returned no tools');
	}
	return result.tools;
}

export default function (pi: ExtensionAPI) {
	pi.on('session_start', async (_event, ctx) => {
		try {
			const tools = await listMcpTools();
			for (const tool of tools) {
				pi.registerTool({
					name: `eigen_${tool.name}`,
					label: tool.name,
					description: tool.description,
					// Server-side JSON Schema is authoritative; Pi forwards args to tools/call.
					parameters: Type.Unsafe(tool.inputSchema),
					promptSnippet: tool.description,
					async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
						try {
							const result = await callMcp('tools/call', {
								name: tool.name,
								arguments: params as Record<string, unknown>
							});
							const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
							return { content: [{ type: 'text', text }] };
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
						}
					}
				});
			}
			ctx.ui.notify(`Eigen MCP tools loaded (${tools.length} tools)`, 'info');
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Eigen MCP failed to load tools: ${message}`, 'error');
		}
	});
}
