import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const MCP_URL = 'https://app.eigenmesh.de/api/mcp';
const MCP_AUTH = 'Bearer eigen_953bbbd2c566c581be2e5cd71de9ff76d7a01fa1cd74b741e6dc89cbcb2622a5';

async function callMcp(method: string, params: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'Authorization': MCP_AUTH,
			'Content-Type': 'application/json',
			'Accept': 'application/json, text/event-stream'
		},
		body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
	});
	const data = await res.json();
	if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
	return data.result;
}

function defineTool(
	name: string,
	description: string,
	parameters: ReturnType<typeof Type.Object>,
	handler: (params: Record<string, unknown>) => Promise<unknown>
) {
	return { name, description, parameters, handler };
}

const tools = [
	defineTool(
		'eigen_capture_thought',
		'Capture and store a raw thought in Eigen memory',
		Type.Object({
			raw: Type.String({ description: 'The thought text to capture' }),
			captured_at: Type.Optional(Type.String({ description: 'ISO-8601 timestamp for backdated capture' }))
		}),
		(params) => callMcp('tools/call', { name: 'capture_thought', arguments: params })
	),
	defineTool(
		'eigen_list_thoughts',
		'List recent stored thoughts from Eigen',
		Type.Object({
			limit: Type.Optional(Type.Number({ description: 'Max thoughts to return' })),
			detail: Type.Optional(Type.String({ description: 'snippet or full' }))
		}),
		(params) => callMcp('tools/call', { name: 'list_thoughts', arguments: params })
	),
	defineTool(
		'eigen_retrieve_thoughts',
		'Search stored thoughts using hybrid semantic, lexical, and graph retrieval',
		Type.Object({
			query: Type.String({ description: 'Search query' }),
			top_k: Type.Optional(Type.Number({ description: 'Number of results' })),
			threshold: Type.Optional(Type.Number({ description: 'Min similarity (0-1)' })),
			mode: Type.Optional(Type.String({ description: 'fast or full' }))
		}),
		(params) => callMcp('tools/call', { name: 'retrieve_thoughts', arguments: params })
	),
	defineTool(
		'eigen_edit_thought',
		'Edit an existing thought with a natural-language request',
		Type.Object({
			thought_id: Type.String({ description: 'Thought UUID' }),
			edit_request: Type.String({ description: 'Natural-language edit instruction' })
		}),
		(params) => callMcp('tools/call', { name: 'edit_thought', arguments: params })
	),
	defineTool(
		'eigen_delete_thought',
		'Permanently delete a thought by ID',
		Type.Object({
			thought_id: Type.String({ description: 'Thought UUID to delete' })
		}),
		(params) => callMcp('tools/call', { name: 'delete_thought', arguments: params })
	),
	defineTool(
		'eigen_answer_question',
		'Answer a question using Eigen memory with citations',
		Type.Object({
			question: Type.String({ description: 'Question to answer' }),
			top_k: Type.Optional(Type.Number({ description: 'Retrieval depth' }))
		}),
		(params) => callMcp('tools/call', { name: 'answer_question', arguments: params })
	),
	defineTool(
		'eigen_list_temporal_events',
		'List temporal events and tasks from the timeline',
		Type.Object({
			range: Type.Optional(Type.String({ description: 'relevant, upcoming, past, or all' })),
			status: Type.Optional(Type.String({ description: 'open or all' })),
			include_tasks: Type.Optional(Type.Boolean()),
			include_open_loops: Type.Optional(Type.Boolean())
		}),
		(params) => callMcp('tools/call', { name: 'list_temporal_events', arguments: params })
	),
	defineTool(
		'eigen_manage_temporal_event',
		'Manage a temporal event: mark done, cancel, reschedule, snooze',
		Type.Object({
			event_id: Type.String({ description: 'Event UUID' }),
			action: Type.String({ description: 'mark_done, reopen, cancel, dismiss, delete, reschedule, snooze' }),
			instruction: Type.Optional(Type.String({ description: 'Natural-language instruction' }))
		}),
		(params) => callMcp('tools/call', { name: 'manage_temporal_event', arguments: params })
	),
	defineTool(
		'eigen_create_text_file',
		'Create a text note in Eigen',
		Type.Object({
			body: Type.String({ description: 'Note content' }),
			title: Type.Optional(Type.String({ description: 'Note title' }))
		}),
		(params) => callMcp('tools/call', { name: 'create_text_file', arguments: params })
	),
	defineTool(
		'eigen_list_text_files',
		'List text notes from Eigen',
		Type.Object({
			limit: Type.Optional(Type.Number())
		}),
		(params) => callMcp('tools/call', { name: 'list_text_files', arguments: params })
	),
	defineTool(
		'eigen_search_text_files',
		'Keyword search over Eigen text notes',
		Type.Object({
			query: Type.String({ description: 'Search keywords' }),
			top_k: Type.Optional(Type.Number())
		}),
		(params) => callMcp('tools/call', { name: 'search_text_files', arguments: params })
	)
];

export default function (pi: ExtensionAPI) {
	for (const tool of tools) {
		pi.registerTool({
			name: tool.name,
			label: tool.name.replace('eigen_', ''),
			description: tool.description,
			parameters: tool.parameters,
			promptSnippet: tool.description,
			async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
				try {
					const result = await tool.handler(params as Record<string, unknown>);
					const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
					return { content: [{ type: 'text', text }] };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
				}
			}
		});
	}

	pi.on('session_start', async (_event, ctx) => {
		ctx.ui.notify('Eigen MCP tools loaded (12 tools)', 'info');
	});
}
