import './load-env.mjs';
import postgres from 'postgres';
import { getDatabaseUrl } from './db-urls.mjs';
import { quoteIdent } from './age-graph-grants.mjs';
import { ensureAgeGraphLabelsAndIndexes } from './age-graph-labels.mjs';

const urlString = getDatabaseUrl();

/** agtype lives in ag_catalog; must be on search_path for cypher() column defs (ok agtype).
 *  public precedes ag_catalog so unqualified DDL targets public, not ag_catalog. */
const AGE_SEARCH_PATH = 'public, ag_catalog, "$user"';

const ageGraph = process.env.AGE_GRAPH_NAME?.trim();
if (!ageGraph) {
	console.error('[eigen] ensure-extensions failed: AGE_GRAPH_NAME is required and must be non-empty.');
	console.error('[eigen] Set AGE_GRAPH_NAME in your environment or .env file.');
	process.exit(1);
}

const sql = postgres(urlString, { max: 1 });
try {
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
	await ensureAgeGraphLabelsAndIndexes(sql, ageGraph);
	const [{ name: dbName }] = await sql`SELECT current_database() AS name`;
	await sql.unsafe(
		`ALTER DATABASE ${quoteIdent(dbName)} SET search_path TO ${AGE_SEARCH_PATH}`
	);
	console.log(
		`[eigen] Extensions ensured (vector, age); graph '${ageGraph}' ready; ` +
			'database search_path includes ag_catalog; eigen_app graph grants applied by ensure-app-role.'
	);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[eigen] ensure-extensions failed: ${message}`);
	console.error('[eigen] Check that DATABASE_URL is correct, the database is accessible, and PostgreSQL has AGE loaded.');
	process.exit(1);
} finally {
	await sql.end();
}
