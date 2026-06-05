import { classifyQueryType } from '$lib/server/retrieval/query-router';
import type { RetrievalMode } from '$lib/server/retrieval/service';

/**
 * Resolve MCP retrieval mode: explicit caller choice wins; relational queries
 * auto-upgrade to full hybrid unless forced fast.
 */
export function resolveMcpRetrievalMode(
	query: string,
	explicit?: 'fast' | 'full'
): RetrievalMode {
	if (explicit === 'fast' || explicit === 'full') return explicit;
	if (classifyQueryType(query) === 'relational') return 'full';
	return 'fast';
}
