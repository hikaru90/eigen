type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** pgvector width for thought / entity / temporal embeddings in this product. */
export const EMBEDDING_VECTOR_LENGTH = 1536;

const VECTOR_FIELD_EXACT = new Set(
	[
		'embedding',
		'embeddings',
		'vector',
		'queryembedding',
		'summaryembedding',
		'thoughtembedding',
		'query_embedding',
		'summary_embedding',
		'thought_embedding'
	].map((s) => s.toLowerCase())
);

const VECTOR_FIELD_SUFFIXES = ['_embedding', '_embeddings', '_vector'] as const;

export function isVectorFieldName(name: string): boolean {
	const lower = name.toLowerCase();
	if (VECTOR_FIELD_EXACT.has(lower)) return true;
	return VECTOR_FIELD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** True when value looks like a stored embedding array (1536 finite numbers). */
export function isEmbeddingVectorArray(value: unknown): value is number[] {
	if (!Array.isArray(value) || value.length !== EMBEDDING_VECTOR_LENGTH) return false;
	for (const n of value) {
		if (typeof n !== 'number' || !Number.isFinite(n)) return false;
	}
	return true;
}

/**
 * Deep-clone and remove embedding vectors from tool/LLM payloads.
 * Vectors may remain in Postgres; they must not be returned by tools or sent to chat models.
 */
export function stripEmbeddingsFromValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (isEmbeddingVectorArray(value)) return undefined;
	if (typeof value !== 'object') return value;
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (const item of value) {
			if (isEmbeddingVectorArray(item)) continue;
			const stripped = stripEmbeddingsFromValue(item);
			if (stripped !== undefined) out.push(stripped);
		}
		return out;
	}
	const obj = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(obj)) {
		if (isVectorFieldName(key) || isEmbeddingVectorArray(v)) continue;
		const stripped = stripEmbeddingsFromValue(v);
		if (stripped !== undefined) out[key] = stripped;
	}
	return out;
}

/** MCP tools and external clients must only see sanitized payloads. */
export function sanitizeMcpToolResult<T>(result: T): T {
	return stripEmbeddingsFromValue(result) as T;
}

const TOOL_RESULT_PREFIX_RE = /^Tool result for [\w_]+:\n/;

export function sanitizeChatMessageContent(content: string): string {
	const toolEnvelope = content.match(
		/^(Tool result for [\w_]+:\n)([\s\S]*?)(\n\nIf more tools are needed[\s\S]*)$/
	);
	if (toolEnvelope) {
		const [, prefix, jsonPart, suffix] = toolEnvelope;
		try {
			const stripped = JSON.stringify(stripEmbeddingsFromValue(JSON.parse(jsonPart)), null, 2);
			return `${prefix}${stripped}${suffix}`;
		} catch {
			return content;
		}
	}

	if (TOOL_RESULT_PREFIX_RE.test(content)) {
		const nl = content.indexOf('\n');
		if (nl >= 0) {
			const prefix = content.slice(0, nl + 1);
			const rest = content.slice(nl + 1);
			try {
				const stripped = JSON.stringify(stripEmbeddingsFromValue(JSON.parse(rest)), null, 2);
				return `${prefix}${stripped}`;
			} catch {
				return content;
			}
		}
	}

	const trimmed = content.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			return JSON.stringify(stripEmbeddingsFromValue(JSON.parse(trimmed)), null, 2);
		} catch {
			return content;
		}
	}

	return content;
}

export function sanitizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
	return messages.map((message) => ({
		...message,
		content: sanitizeChatMessageContent(message.content)
	}));
}
