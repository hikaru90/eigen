import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';

export type LexicalSearchResult = {
	id: string;
	normalizedText: string;
	category: string;
	metadata: Record<string, unknown>;
	lexicalScore: number;
};

export async function lexicalSearch(params: {
	userId: string;
	query: string;
	limit: number;
}): Promise<LexicalSearchResult[]> {
	const rankExpr = sql<number>`ts_rank_cd(${thought.lexicalTsv}, plainto_tsquery('simple', ${params.query}))`;
	const matchExpr = sql<boolean>`${thought.lexicalTsv} @@ plainto_tsquery('simple', ${params.query})`;

	const rows = await getDb()
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			category: thought.category,
			metadata: thought.metadata,
			lexicalScore: rankExpr
		})
		.from(thought)
		.where(and(eq(thought.userId, params.userId), matchExpr))
		.orderBy(desc(rankExpr))
		.limit(params.limit);

	return rows.map((row) => ({
		id: row.id,
		normalizedText: row.normalizedText,
		category: row.category,
		metadata: (row.metadata as Record<string, unknown>) ?? {},
		lexicalScore: row.lexicalScore ?? 0
	}));
}
