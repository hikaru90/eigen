import {
  runForgetIdeaTool,
  runUpdateIdeaTool,
  runListBoardTool,
  runShareIdeaTool,
  runVoteIdeaTool,
} from '$lib/server/mcp/board-tools'
import {
  runAnswerQuestionTool,
  runAppendTextFileTool,
  runCaptureThoughtTool,
  runCreateProjectTool,
  runCreateTextFileTool,
  runDeleteProjectTool,
  runMergeProjectsTool,
  runDeleteTextFileTool,
  runDeleteThoughtTool,
  runDeleteThoughtsByRequestTool,
  runEditProjectTool,
  runEditThoughtTool,
  runGetProjectTimelineTool,
  runGetTextFileTool,
  runLinkTextFileToThoughtTool,
  runListProjectsTool,
  runListTextFilesTool,
  runOpenThreadsTool,
  runOrderTaskInProjectTool,
  runRetrieveThoughtsTool,
  runSearchTextFilesTool,
  runSetProjectDeadlineTool,
  runSetProjectMilestoneTool,
  runGenerateProjectPlanTool,
  runUnlinkTextFileFromThoughtTool,
  runUpdateTextFileTool,
  type McpToolContext,
} from '$lib/server/mcp/tools'

export type McpToolHandler = (context: McpToolContext, args: unknown) => Promise<unknown>

export type McpToolDefinition = {
  name: string
  description: string
  /** JSON Schema for MCP ListTools / CallTool. */
  inputSchema: Record<string, unknown>
  /** Human-readable argument summary for the chat agent system prompt. */
  agentArgumentSchema: string
  handler: McpToolHandler
  /** When false, tool is not exposed to HTTP MCP clients (in-app chat agent still has access). */
  exposeInMcp?: boolean
}

const MCP_CLIENT_TOOL_NAMES = new Set([
  'capture_thought',
  'retrieve_thoughts',
  'edit_thought',
  'delete_thought',
  'delete_thoughts_by_request',
  'list_projects',
  'open_threads',
  'get_project_timeline',
  'order_task_in_project',
  'set_project_milestone',
  'set_project_deadline',
  'generate_project_plan',
  'create_project',
  'edit_project',
  'merge_projects',
  'delete_project',
])

/**
 * The shared Contribute board — HTTP MCP only, and only for maker/admin users
 * (createMcpServer boardAccess). Never on the default surface, never in the ask/chat loop.
 */
const BOARD_TOOL_NAMES = new Set(['list_board', 'share_idea', 'vote_idea', 'forget_idea'])
const BOARD_ADMIN_TOOL_NAMES = new Set(['update_idea'])

/**
 * Full tool surface for the in-app chat agent.
 * HTTP MCP clients only see tools with exposeInMcp !== false (the four thought CRUD tools).
 */
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'capture_thought',
    description:
      "Capture and store a raw thought. Tier 1: returns immediately after text persist; keyword recall on lexical_text is ready. Tier 2 (background): embedding, entities, graph links. Use retrieve_thoughts for recall. MCP Bearer auth: default labels the thought as agent-authored (your API key name). Pass as_user true when the user asked you to remember something for them (their memory, not yours). Omit as_user when storing the agent's own observation or note.",
    inputSchema: {
      type: 'object',
      properties: {
        raw: { type: 'string' },
        captured_at: {
          type: 'string',
          description:
            'Optional ISO-8601 capture time for backdated memories (temporal anchoring).',
        },
        as_user: {
          type: 'boolean',
          description:
            "When true, store as the human user's memory (e.g. they asked you to remember this for them). When false or omitted on MCP API key auth, store as agent-authored with your API key name.",
        },
        author: {
          type: 'string',
          description:
            'Optional override: first ~10 characters of a different API key prefix to attribute authorship. Usually omitted — MCP Bearer token identity is used automatically.',
        },
      },
      required: ['raw'],
    },
    agentArgumentSchema:
      '{"raw": "string (required)", "captured_at": "string (optional ISO-8601)", "as_user": "boolean (optional — true for human capture)", "author": "string (optional — rarely needed; MCP key labels automatically)"}',
    handler: runCaptureThoughtTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('capture_thought'),
  },
  {
    name: 'answer_question',
    description:
      'Answer a question by retrieving relevant thoughts and composing a grounded answer with citations. Defaults to user-authored memories only; pass author=all or include_agent=true to include agent/API-key captures.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        top_k: { type: 'number' },
        reference_time: {
          type: 'string',
          description: 'Optional ISO-8601 reference time for temporal validity (defaults to now).',
        },
        author: {
          type: 'string',
          enum: ['user', 'agent', 'all'],
          description:
            'Whose memories to search. Default user (human captures). agent = API-key captures only. all = no author filter.',
        },
        include_agent: {
          type: 'boolean',
          description: 'When true, same as author=all (ignored if author is set).',
        },
      },
      required: ['question'],
    },
    agentArgumentSchema:
      '{"question": "string (required)", "top_k": "number (optional)", "reference_time": "string (optional ISO-8601) — as-of time for temporal questions", "author": "user|agent|all (optional, default user)", "include_agent": "boolean (optional — shorthand for author=all)"}',
    handler: runAnswerQuestionTool,
    exposeInMcp: false,
  },
  {
    name: 'retrieve_thoughts',
    description:
      'Read stored thoughts. Defaults to user-authored open memories (excludes agent captures and completed/archived). For the latest open thoughts (newest first): omit query or set order=created_at — use top_k and optional cursor_created_at + cursor_id to paginate. Each recent-browse result carries askQuestion: the suggested question enrichment stored for that thought (null when none). With query and order=relevance (default): hybrid semantic, lexical, and graph search over open thoughts plus lexical search over attached text notes. Pass author=all or include_agent=true to include agent/API-key captures.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional search text. Omit (or set order=created_at) to browse recent open thoughts newest-first instead of searching.',
        },
        order: {
          type: 'string',
          enum: ['created_at', 'relevance'],
          description:
            'created_at: newest open thoughts first (ignores query). relevance: rank by search match (default; requires query).',
        },
        top_k: {
          type: 'number',
          description:
            'Max results (default 10). When browsing recent thoughts, acts as the page size.',
        },
        threshold: { type: 'number' },
        mode: { type: 'string', enum: ['fast', 'full'] },
        detail: { type: 'string', enum: ['snippet', 'full'] },
        author: {
          type: 'string',
          enum: ['user', 'agent', 'all'],
          description:
            'Whose memories to retrieve. Default user (human captures). agent = API-key captures only. all = no author filter.',
        },
        include_agent: {
          type: 'boolean',
          description: 'When true, same as author=all (ignored if author is set).',
        },
        cursor_created_at: {
          type: 'string',
          description:
            'Pagination cursor (ISO created_at) when browsing recent thoughts without query.',
        },
        cursor_id: {
          type: 'string',
          description:
            'Pagination cursor (thought UUID) when browsing recent thoughts without query.',
        },
      },
    },
    agentArgumentSchema:
      '{"query": "string (optional — omit for recent browse)", "order": "created_at|relevance (optional — created_at for newest open thoughts)", "top_k": "number (optional, default 10)", "threshold": "number (optional, 0-1)", "mode": "fast|full (optional)", "detail": "snippet|full (optional)", "author": "user|agent|all (optional, default user)", "include_agent": "boolean (optional — shorthand for author=all)", "cursor_created_at": "string (optional)", "cursor_id": "string (optional)"}',
    handler: runRetrieveThoughtsTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('retrieve_thoughts'),
  },
  {
    name: 'edit_thought',
    description:
      'Edit an existing thought by ID with a natural-language request. Covers text changes (reword, fix typo) and lifecycle/status changes (mark complete, mark done, reopen, archive, dismiss as irrelevant/outdated). Works for ANY category — task, idea, observation, fact, etc. are interchangeable; never refuse because something is "not a todo". Done/complete sets completed; archive/irrelevant/outdated soft-removes like delete_thought. There is no separate set_status tool.',
    inputSchema: {
      type: 'object',
      properties: {
        thought_id: { type: 'string' },
        edit_request: {
          type: 'string',
          description:
            'Natural-language instruction, e.g. "mark as done", "mark complete", "archive", "not relevant", "outdated", "fix typo in second sentence". Category does not matter.',
        },
        raw_text: {
          type: 'string',
          description:
            'Optional direct text replacement. When provided, replaces the thought text directly without LLM processing.',
        },
      },
      required: ['thought_id'],
    },
    agentArgumentSchema:
      '{"thought_id": "string (required)", "edit_request": "string (optional) — text edits or status: mark as done, mark complete, archive, not relevant, outdated, reopen (any category)", "raw_text": "string (optional) — direct text replacement"}',
    handler: runEditThoughtTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('edit_thought'),
  },
  {
    name: 'delete_thought',
    description:
      'Archive (soft-remove) one stored thought by ID — reversible, not a permanent delete. Same soft-remove family as edit_thought "archive" / "not relevant" / "outdated"; use for delete/remove. Works for any category.',
    inputSchema: {
      type: 'object',
      properties: {
        thought_id: { type: 'string' },
      },
      required: ['thought_id'],
    },
    agentArgumentSchema:
      '{"thought_id": "string (required) — UUID from retrieve_thoughts results, never a title or description"}',
    handler: runDeleteThoughtTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('delete_thought'),
  },
  {
    name: 'delete_thoughts_by_request',
    description:
      'Soft-remove stored thoughts matching a natural-language request. Candidates are selected by the Jev decision model behind a 0.8 confidence gate; ambiguous requests are rejected with an explicit error rather than deleting anything.',
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description:
            'Natural-language delete request, e.g. "delete the salmon recipe" or "delete all my recipe notes" (max 500 characters).',
        },
      },
      required: ['request'],
    },
    agentArgumentSchema:
      '{"request": "string (required, max 500 chars) — natural-language delete request, e.g. delete the salmon recipe"}',
    handler: runDeleteThoughtsByRequestTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('delete_thoughts_by_request'),
  },
  {
    name: 'list_projects',
    description:
      'List GTD projects with ordered task waterfalls, milestones, project deadline (targetDate), next action, and open task counts. Use this to understand projects and timelines as a whole.',
    inputSchema: {
      type: 'object',
      properties: {
        author: {
          type: 'string',
          enum: ['user', 'all'],
          description: 'Whose projects to list. Default user. all includes agent-linked projects.',
        },
        include_agent: {
          type: 'boolean',
          description: 'When true, same as author=all.',
        },
      },
    },
    agentArgumentSchema:
      '{"author": "user|all (optional, default user)", "include_agent": "boolean (optional)"}',
    handler: runListProjectsTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('list_projects'),
  },
  {
    name: 'open_threads',
    description:
      'One reliability sweep over everything currently open: active projects with a stalled signal (overdue deadline, overdue milestone, or open tasks but no next action) plus orphan open task/goal thoughts that are linked to NO project waterfall, oldest first. Use for daily digests, weekly reviews, and "what has open threads?" questions.',
    inputSchema: {
      type: 'object',
      properties: {
        author: {
          type: 'string',
          enum: ['user', 'all'],
          description: 'Whose threads. Default all — includes agent-linked projects.',
        },
      },
    },
    agentArgumentSchema: '{"author": "user|all (optional, default all)"}',
    handler: runOpenThreadsTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('open_threads'),
  },
  {
    name: 'get_project_timeline',
    description:
      'Get one project timeline: ordered task waterfall, milestones, target deadline, and next action.',
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
      },
      required: ['project_entity_id'],
    },
    agentArgumentSchema: '{"project_entity_id": "string (required) — UUID from list_projects"}',
    handler: runGetProjectTimelineTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('get_project_timeline'),
  },
  {
    name: 'order_task_in_project',
    description:
      'Place a task thought in a project waterfall. Pass rank (1-based) or after_thought_id (null to append). Explicit write — not semantic inference.',
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
        thought_id: { type: 'string' },
        after_thought_id: {
          type: ['string', 'null'],
          description: 'Place after this thought id; null appends. Ignored when rank is set.',
        },
        rank: {
          type: 'number',
          description: '1-based position in the waterfall.',
        },
      },
      required: ['project_entity_id', 'thought_id'],
    },
    agentArgumentSchema:
      '{"project_entity_id": "string (required)", "thought_id": "string (required)", "after_thought_id": "string|null (optional)", "rank": "number (optional, 1-based)"}',
    handler: runOrderTaskInProjectTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('order_task_in_project'),
  },
  {
    name: 'set_project_milestone',
    description:
      'Create or update a project-scoped milestone (deliverable). Pass milestone_id to update.',
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
        label: { type: 'string' },
        milestone_id: { type: 'string' },
        target_date: { type: ['string', 'null'] },
        linked_thought_id: { type: ['string', 'null'] },
        rank: { type: 'number' },
        completed: { type: 'boolean' },
      },
      required: ['project_entity_id', 'label'],
    },
    agentArgumentSchema:
      '{"project_entity_id": "string (required)", "label": "string (required)", "milestone_id": "string (optional)", "target_date": "string|null (optional ISO)", "linked_thought_id": "string|null (optional)", "rank": "number (optional)", "completed": "boolean (optional)"}',
    handler: runSetProjectMilestoneTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('set_project_milestone'),
  },
  {
    name: 'set_project_deadline',
    description: 'Set or clear the overall project target_date deadline (ISO-8601 or null).',
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
        target_date: { type: ['string', 'null'] },
      },
      required: ['project_entity_id', 'target_date'],
    },
    agentArgumentSchema:
      '{"project_entity_id": "string (required)", "target_date": "string|null (required ISO-8601 or null)"}',
    handler: runSetProjectDeadlineTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('set_project_deadline'),
  },
  {
    name: 'generate_project_plan',
    description:
      'Generate an entire project plan via LLM: ordered task waterfall, milestones, and overall deadline. Creates task thoughts, links them to the project, sets ranks, and optionally dates. Pass an optional goal to steer the plan.',
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
        goal: {
          type: 'string',
          description: 'Optional planning goal or constraint (e.g. ship beta by October).',
        },
      },
      required: ['project_entity_id'],
    },
    agentArgumentSchema:
      '{"project_entity_id": "string (required)", "goal": "string (optional planning goal)"}',
    handler: runGenerateProjectPlanTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('generate_project_plan'),
  },
  {
    name: 'create_project',
    description:
      'Create a new GTD project. Returns the new project entity ID and details. Projects start as active with manual source.',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Project name/label (required).',
        },
        status: {
          type: 'string',
          enum: ['active', 'someday'],
          description: 'Initial project status. Default: active.',
        },
      },
      required: ['label'],
    },
    agentArgumentSchema:
      '{"label": "string (required) — project name", "status": "active|someday (optional, default active)"}',
    handler: runCreateProjectTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('create_project'),
  },
  {
    name: 'edit_project',
    description:
      "Edit a project's label (name) and/or status (active, someday, completed). At least one of label or status must be provided.",
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
        label: {
          type: 'string',
          description: 'New project name/label.',
        },
        status: {
          type: 'string',
          enum: ['active', 'someday', 'completed'],
          description: 'New project status.',
        },
      },
      required: ['project_entity_id'],
    },
    agentArgumentSchema:
      '{"project_entity_id": "string (required)", "label": "string (optional) — new name", "status": "active|someday|completed (optional)"}',
    handler: runEditProjectTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('edit_project'),
  },
  {
    name: 'merge_projects',
    description:
      'Merge duplicate projects into one in a single call (e.g. several "Eigen"/"EigenMesh" entries): every thought, task, next action and alias of project_entity_ids moves to into_project_entity_id, and the merged ones stop being projects. Use this — never delete_project — when the user asks to merge, combine or clean up duplicate projects. Optional label renames the kept project.',
    inputSchema: {
      type: 'object',
      properties: {
        into_project_entity_id: {
          type: 'string',
          description: 'The project to keep (from list_projects).',
        },
        project_entity_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'The duplicate projects to fold into it.',
        },
        label: { type: 'string', description: 'Optional new name for the kept project.' },
      },
      required: ['into_project_entity_id', 'project_entity_ids'],
      additionalProperties: false,
    },
    agentArgumentSchema:
      '{"into_project_entity_id": "string (required) — project to keep", "project_entity_ids": "string[] (required) — duplicates to merge in", "label": "string (optional) — new name"}',
    handler: runMergeProjectsTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('merge_projects'),
  },
  {
    name: 'delete_project',
    description:
      'Delete (dismiss) a project. Removes the project from active listings and unlinks all associated thoughts. The thoughts themselves are preserved. To combine duplicate projects use merge_projects instead.',
    inputSchema: {
      type: 'object',
      properties: {
        project_entity_id: { type: 'string' },
      },
      required: ['project_entity_id'],
    },
    agentArgumentSchema: '{"project_entity_id": "string (required)"}',
    handler: runDeleteProjectTool,
    exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('delete_project'),
  },
  {
    name: 'list_board',
    description:
      "List the shared Contribute board (ideas, bugs, polish requests every Eigenmesh user can see): title, kind, area, status, net score, your vote (-1|0|1), author display name, makers' note. Optional status filter.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['requested', 'in-progress', 'shipped'] },
      },
      additionalProperties: false,
    },
    agentArgumentSchema: '{"status": "requested|in-progress|shipped (optional)"}',
    handler: runListBoardTool,
    exposeInMcp: false,
  },
  {
    name: 'share_idea',
    description:
      "Share an idea on the shared Contribute board (visible to every user, also emailed to the makers). One billed LLM judge picks kind and area and checks for the same request already on the board: if it finds one, nothing is created and duplicateOf is returned — vote for it with vote_idea, or call again with mine_is_different: true. On success the idea is Requested with your +1. inbox reports whether the makers' email went out.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The request, verbatim (max 4000 characters).' },
        mine_is_different: {
          type: 'boolean',
          description: 'Create a separate idea even when the judge names a duplicate.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    agentArgumentSchema:
      '{"title": "string (required)", "mine_is_different": "boolean (optional)"}',
    handler: runShareIdeaTool,
    exposeInMcp: false,
  },
  {
    name: 'vote_idea',
    description:
      'Vote on a board idea: direction 1 (up), -1 (down) or 0 (remove your vote). One vote per idea, unlimited ideas. Shipped ideas are closed (409); you cannot vote your own idea down. Returns the new net score.',
    inputSchema: {
      type: 'object',
      properties: {
        idea_id: { type: 'string', description: 'Idea UUID from list_board or share_idea.' },
        direction: { type: 'number', enum: [-1, 0, 1] },
      },
      required: ['idea_id', 'direction'],
      additionalProperties: false,
    },
    agentArgumentSchema: '{"idea_id": "string UUID (required)", "direction": "-1|0|1 (required)"}',
    handler: runVoteIdeaTool,
    exposeInMcp: false,
  },
  {
    name: 'forget_idea',
    description:
      'Delete ("forget") an idea you shared while it is still Requested; its votes go with it. Other people\'s ideas → 403, In progress/Shipped → 409. Makers (admin key) delete any idea in any status.',
    inputSchema: {
      type: 'object',
      properties: { idea_id: { type: 'string' } },
      required: ['idea_id'],
      additionalProperties: false,
    },
    agentArgumentSchema: '{"idea_id": "string UUID (required)"}',
    handler: runForgetIdeaTool,
    exposeInMcp: false,
  },
  {
    name: 'update_idea',
    description:
      "Makers only (admin key): change a board idea's title (re-embedded for duplicate checks), status and/or the makers' note. requested | in-progress | shipped move it between the board tabs (shipped closes votes); rejected declines it and takes it off the board for every user — set another status to restore it. note: string shown on the idea, or null to clear. When an idea ships, an LLM judge (billed to you) decides whether it was a genuine contribution: if so its author gets 5 credits once; either way they get an in-app notification, a push and an email. reward reports it, with the judge's reason (null when nothing was sent). Returns the idea as the board shows it (null once rejected).",
    inputSchema: {
      type: 'object',
      properties: {
        idea_id: { type: 'string', description: 'Idea UUID from list_board.' },
        title: { type: 'string', description: 'New wording for the idea.' },
        status: { type: 'string', enum: ['requested', 'in-progress', 'shipped', 'rejected'] },
        note: { type: ['string', 'null'] },
      },
      required: ['idea_id'],
      additionalProperties: false,
    },
    agentArgumentSchema:
      '{"idea_id": "string UUID (required)", "title": "string (optional)", "status": "requested|in-progress|shipped|rejected (optional)", "note": "string|null (optional)"}',
    handler: runUpdateIdeaTool,
    exposeInMcp: false,
  },
  {
    name: 'create_text_file',
    description:
      'Create a NEW user-scoped text note (not a thought). Inserts a new Notes-tab document — never use this to add items to an existing list or amend a named note. For additive edits (e.g. add milk to shopping list), search_text_files or list_text_files, then append_text_file. Provide title and/or body (at least one required). Title-only is valid for empty new lists/notebooks. Notes documents are not memory thoughts.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string' },
        title: { type: 'string' },
        author: {
          type: 'string',
          description:
            'Optional first ~10 characters of your API key to attribute this note to that key name; leave empty to store as the user.',
        },
      },
    },
    agentArgumentSchema:
      '{"title": "string (optional)", "body": "string (optional)", "author": "string (optional) — first ~10 chars of your API key to label authorship; empty means user"} — at least one of title or body required',
    handler: runCreateTextFileTool,
    exposeInMcp: false,
  },
  {
    name: 'list_text_files',
    description: 'List user text notes (newest updated first), optionally paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        cursor_updated_at: { type: 'string' },
        cursor_id: { type: 'string' },
      },
    },
    agentArgumentSchema:
      '{"limit": "number (optional)", "cursor_updated_at": "string (optional ISO)", "cursor_id": "string (optional)"}',
    handler: runListTextFilesTool,
    exposeInMcp: false,
  },
  {
    name: 'get_text_file',
    description: 'Get one user text note by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        text_file_id: { type: 'string' },
      },
      required: ['text_file_id'],
    },
    agentArgumentSchema: '{"text_file_id": "string (required)"}',
    handler: runGetTextFileTool,
    exposeInMcp: false,
  },
  {
    name: 'update_text_file',
    description:
      'Replace a user text note title and/or full body. Prefer append_text_file when adding lines/items to an existing list or checklist.',
    inputSchema: {
      type: 'object',
      properties: {
        text_file_id: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['text_file_id'],
    },
    agentArgumentSchema:
      '{"text_file_id": "string (required)", "title": "string (optional)", "body": "string (optional)"}',
    handler: runUpdateTextFileTool,
    exposeInMcp: false,
  },
  {
    name: 'append_text_file',
    description:
      'Append text to an existing Notes document (shopping lists, checklists, notebooks). Find text_file_id via search_text_files or list_text_files first. Do not create_text_file for additive requests.',
    inputSchema: {
      type: 'object',
      properties: {
        text_file_id: { type: 'string' },
        text: {
          type: 'string',
          description: 'Content to append (e.g. a list item).',
        },
        separator: {
          type: 'string',
          description:
            'Optional string between existing body and text. Default: newline when body is non-empty.',
        },
      },
      required: ['text_file_id', 'text'],
    },
    agentArgumentSchema:
      '{"text_file_id": "string (required)", "text": "string (required)", "separator": "string (optional)"}',
    handler: runAppendTextFileTool,
    exposeInMcp: false,
  },
  {
    name: 'delete_text_file',
    description: 'Permanently delete a user text note by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        text_file_id: { type: 'string' },
      },
      required: ['text_file_id'],
    },
    agentArgumentSchema: '{"text_file_id": "string (required)"}',
    handler: runDeleteTextFileTool,
    exposeInMcp: false,
  },
  {
    name: 'search_text_files',
    description:
      'Lexical keyword search over user text notes (recipes, templates, pasted reference). Defaults to user-authored notes only. No embeddings — use retrieve_thoughts for hybrid thought + note search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        top_k: { type: 'number' },
        author: {
          type: 'string',
          enum: ['user', 'agent', 'all'],
          description:
            'Whose notes to search. Default user (human). agent = API-key notes only. all = no author filter.',
        },
        include_agent: {
          type: 'boolean',
          description: 'When true, same as author=all (ignored if author is set).',
        },
      },
      required: ['query'],
    },
    agentArgumentSchema:
      '{"query": "string (required)", "top_k": "number (optional)", "author": "user|agent|all (optional, default user)", "include_agent": "boolean (optional — shorthand for author=all)"}',
    handler: runSearchTextFilesTool,
    exposeInMcp: false,
  },
  {
    name: 'link_text_file_to_thought',
    description: 'Attach an existing text note to a thought.',
    inputSchema: {
      type: 'object',
      properties: {
        thought_id: { type: 'string' },
        text_file_id: { type: 'string' },
      },
      required: ['thought_id', 'text_file_id'],
    },
    agentArgumentSchema: '{"thought_id": "string (required)", "text_file_id": "string (required)"}',
    handler: runLinkTextFileToThoughtTool,
    exposeInMcp: false,
  },
  {
    name: 'unlink_text_file_from_thought',
    description: 'Remove a text note attachment from a thought without deleting the note.',
    inputSchema: {
      type: 'object',
      properties: {
        thought_id: { type: 'string' },
        text_file_id: { type: 'string' },
      },
      required: ['thought_id', 'text_file_id'],
    },
    agentArgumentSchema: '{"thought_id": "string (required)", "text_file_id": "string (required)"}',
    handler: runUnlinkTextFileFromThoughtTool,
    exposeInMcp: false,
  },
]

export const MCP_EXPOSED_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS.filter(
  (t) => t.exposeInMcp !== false,
)

export const MCP_BOARD_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS.filter((t) =>
  BOARD_TOOL_NAMES.has(t.name),
)

/** Status/note changes — admin keys only (createMcpServer boardAdmin). */
export const MCP_BOARD_ADMIN_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS.filter((t) =>
  BOARD_ADMIN_TOOL_NAMES.has(t.name),
)

export const MCP_TOOL_MAP = new Map<string, McpToolHandler>(
  MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler]),
)

export const MCP_EXPOSED_TOOL_MAP = new Map<string, McpToolHandler>(
  MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler]),
)

/** All registered tools (superset — HTTP MCP exposure + handler map). The ask/chat
 *  loop filters this down to CHAT_AGENT_TOOL_NAMES. */
export const MCP_AGENT_TOOL_NAMES = MCP_TOOL_DEFINITIONS.map((t) => t.name)

/**
 * Tools the in-app ask/chat loop may call. The ask surface is ask-only:
 * capture_thought is deliberately excluded so a question typed into Ask can
 * never be stored as a new thought (deterministic surface boundary — no string
 * heuristics deciding "is this a question"). Capturing belongs to the Capture
 * surface and to HTTP MCP clients, both of which keep the tool.
 */
export const CHAT_AGENT_TOOL_NAMES = MCP_TOOL_DEFINITIONS.filter(
  (t) =>
    t.name !== 'capture_thought' &&
    !BOARD_TOOL_NAMES.has(t.name) &&
    !BOARD_ADMIN_TOOL_NAMES.has(t.name),
).map((t) => t.name)

/** HTTP MCP client surface (minimal memory CRUD). */
export const MCP_CLIENT_EXPOSED_TOOL_NAMES = MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name)

export function isMcpExposedTool(name: string): boolean {
  return MCP_EXPOSED_TOOL_MAP.has(name)
}

export function isAgentTool(name: string): boolean {
  return MCP_TOOL_MAP.has(name)
}

/** Gate for the ask/chat loop's toolset (capture_thought excluded). */
export function isChatAgentTool(name: string): boolean {
  return CHAT_AGENT_TOOL_NAMES.includes(name)
}

/** Tool catalog shown to the ask/chat model — same block, capture-free. */
export function buildChatAgentToolDescriptionBlock(): string {
  return MCP_TOOL_DEFINITIONS.filter((t) => isChatAgentTool(t.name))
    .map((t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.agentArgumentSchema}`)
    .join('\n\n')
}
