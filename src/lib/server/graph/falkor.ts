import { env } from '$env/dynamic/private';
import { FalkorDB } from 'falkordb';

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
}
