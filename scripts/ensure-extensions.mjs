import './load-env.mjs';
import postgres from 'postgres';
import { getDatabaseUrl } from './db-urls.mjs';
import { ensureAgeGraphGrants, quoteIdent } from './age-graph-grants.mjs';

const urlString = getDatabaseUrl();

/** agtype lives in ag_catalog; must be on search_path for cypher() column defs (ok agtype). */
const AGE_SEARCH_PATH = 'ag_catalog, "$user", public';

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
	await sql.unsafe(`SET search_path = ${AGE_SEARCH_PATH}`);
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
	const [{ name: dbName }] = await sql`SELECT current_database() AS name`;
	const [{ owner }] = await sql`SELECT current_user AS owner`;
	await sql.unsafe(
		`ALTER DATABASE ${quoteIdent(dbName)} SET search_path TO ${AGE_SEARCH_PATH}`
	);
	await ensureAgeGraphGrants(sql, { owner, ageGraph });
	console.log(
		`[eigen] Extensions ensured (vector, age); graph '${ageGraph}' ready; ` +
			'database search_path includes ag_catalog; eigen_app graph grants applied.'
	);
} finally {
	await sql.end();
}
