import './load-env.mjs';
import postgres from 'postgres';
import { getDatabaseUrl } from './db-urls.mjs';

const urlString = getDatabaseUrl();

const sql = postgres(urlString, { max: 1 });
try {
	const ageGraph = process.env.AGE_GRAPH_NAME?.trim();
	if (!ageGraph) {
		throw new Error('AGE_GRAPH_NAME is required and must be non-empty');
	}
	const escapedGraph = ageGraph.replace(/'/g, "''");
	await sql.unsafe(`
		CREATE EXTENSION IF NOT EXISTS vector;
		CREATE EXTENSION IF NOT EXISTS age;
	`);
	await sql.unsafe(`LOAD 'age'`);
	await sql.unsafe(`SET search_path = ag_catalog, "$user", public`);
	await sql.unsafe(`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM ag_catalog.ag_graph WHERE name = '${escapedGraph}'
			) THEN
				PERFORM ag_catalog.create_graph('${escapedGraph}');
			END IF;
		END $$;
	`);
	console.log(`[eigen] Extensions ensured (vector, age); graph '${ageGraph}' ready.`);
} finally {
	await sql.end();
}
