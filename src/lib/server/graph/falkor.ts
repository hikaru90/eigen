import { env } from '$env/dynamic/private';
import { FalkorDB } from 'falkordb';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

type FalkorClient = Awaited<ReturnType<typeof FalkorDB.connect>>;

let clientPromise: Promise<FalkorClient> | null = null;

function falkorHost(): string {
	return env.FALKOR_HOST?.trim() || 'localhost';
}

function falkorPort(): number {
	const raw = env.FALKOR_PORT?.trim();
	if (!raw) return 6379;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`Invalid FALKOR_PORT: ${raw}`);
	}
	return value;
}

function falkorGraph(): string {
	return env.FALKOR_GRAPH?.trim() || 'eigen_memory';
}

async function getClient(): Promise<FalkorClient> {
	if (!clientPromise) {
		clientPromise = FalkorDB.connect({
			socket: {
				host: falkorHost(),
				port: falkorPort()
			}
		});
	}
	return clientPromise;
}

async function runFalkorQueryWithRetry<T>(
	userId: string,
	operation: string,
	query: () => Promise<T>
): Promise<T> {
	const maxAttempts = 3;
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const result = await query();
			await logActivityCall(getDb(), userId, {
				provider: 'falkor',
				operation: `${operation}.success(attempt=${attempt})`,
				baseCostUsd: 0
			});
			return result;
		} catch (err) {
			lastError = err;
			await logActivityCall(getDb(), userId, {
				provider: 'falkor',
				operation: `${operation}.error(attempt=${attempt})`,
				baseCostUsd: 0
			});
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Falkor operation failed after ${maxAttempts} attempts`);
}

export async function upsertThoughtNode(input: {
	id: string;
	userId: string;
	rawText: string;
	normalizedText: string;
	lexicalText: string;
	category: string;
}): Promise<void> {
	const client = await getClient();
	const graph = client.selectGraph(falkorGraph());
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_node', async () => {
		await graph.query(
			`
		MERGE (t:Thought {id: $id})
		SET t.user_id = $user_id,
		    t.raw_text = $raw_text,
		    t.normalized_text = $normalized_text,
		    t.lexical_text = $lexical_text,
		    t.category = $category,
		    t.updated_at = timestamp()
		RETURN t.id
			`,
			{
				params: {
					id: input.id,
					user_id: input.userId,
					raw_text: input.rawText,
					normalized_text: input.normalizedText,
					lexical_text: input.lexicalText,
					category: input.category
				}
			}
		);
	});
}

export async function upsertThoughtRelation(input: {
	userId: string;
	sourceId: string;
	targetId: string;
	relationType: string;
}): Promise<void> {
	const sourceId = validateNonEmptyEntityId(input.sourceId, 'sourceId');
	const targetId = validateNonEmptyEntityId(input.targetId, 'targetId');

	const client = await getClient();
	const graph = client.selectGraph(falkorGraph());
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_relation', async () => {
		await graph.query(
			`
			MATCH (a:Thought {id: $source_id})
			MATCH (b:Thought {id: $target_id})
			MERGE (a)-[r:RELATES_TO {user_id: $user_id, type: $relation_type}]->(b)
			SET r.updated_at = timestamp()
			RETURN a.id, b.id
			`,
			{
				params: {
					source_id: sourceId,
					target_id: targetId,
					user_id: input.userId,
					relation_type: input.relationType
				}
			}
		);
	});
}

export async function expandNeighborsByIds(input: {
	userId: string;
	seedIds: string[];
	limit: number;
}): Promise<Array<{ id: string; hits: number }>> {
	const normalizedSeedIds = input.seedIds
		.map((seedId) => validateNonEmptyEntityId(seedId, 'seedIds[]'))
		.filter((value, index, self) => self.indexOf(value) === index);
	if (normalizedSeedIds.length === 0) return [];

	const client = await getClient();
	const graph = client.selectGraph(falkorGraph());
	return runFalkorQueryWithRetry(input.userId, 'falkor.expand_neighbors', async () => {
		const result = (await graph.query(
			`
			UNWIND $seed_ids AS sid
			MATCH (s:Thought {id: sid, user_id: $user_id})
			MATCH (s)-[r:RELATES_TO]-(n:Thought {user_id: $user_id})
			WHERE n.id <> sid AND r.user_id = $user_id
			RETURN n.id AS id, count(r) AS hits
			ORDER BY hits DESC
			LIMIT $limit
			`,
			{
				params: {
					seed_ids: normalizedSeedIds,
					user_id: input.userId,
					limit: input.limit
				}
			}
		)) as { data?: Array<Array<unknown>> };

		const rows = result?.data ?? [];
		return rows
			.map((row) => ({
				id: typeof row[0] === 'string' ? row[0] : '',
				hits: typeof row[1] === 'number' ? row[1] : Number(row[1] ?? 0)
			}))
			.filter((row) => row.id);
	});
}
