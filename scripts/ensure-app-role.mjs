import './load-env.mjs';
import postgres from 'postgres';
import { getDatabaseUrl } from './db-urls.mjs';
import { ensureAgeGraphGrants, quoteIdent } from './age-graph-grants.mjs';

const urlString = getDatabaseUrl();
const appPassword = process.env.EIGEN_APP_DB_PASSWORD?.trim() || 'eigen_app';
const escapedPassword = appPassword.replace(/'/g, "''");

const sql = postgres(urlString, { max: 1 });

try {
	await sql.unsafe(`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eigen_app') THEN
				CREATE ROLE eigen_app LOGIN PASSWORD '${escapedPassword}';
			END IF;
		END
		$$;
	`);

	const [{ name: dbName }] = await sql`SELECT current_database() AS name`;
	const [{ owner }] = await sql`SELECT current_user AS owner`;

	await sql.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO eigen_app`);
	await sql.unsafe(`GRANT USAGE ON SCHEMA public TO eigen_app`);
	await sql.unsafe(`GRANT USAGE ON SCHEMA ag_catalog TO eigen_app`);
	const ageGraph = process.env.AGE_GRAPH_NAME?.trim();
	if (!ageGraph) {
		throw new Error('AGE_GRAPH_NAME is required and must be non-empty');
	}
	await ensureAgeGraphGrants(sql, { owner, ageGraph });
	await sql.unsafe(
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eigen_app`
	);
	await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eigen_app`);
	await sql.unsafe(`
		ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public
		  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eigen_app
	`);
	await sql.unsafe(`
		ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public
		  GRANT USAGE, SELECT ON SEQUENCES TO eigen_app
	`);
	await sql.unsafe(`GRANT ${quoteIdent('eigen_app')} TO ${quoteIdent(owner)}`);
	// agtype for Apache AGE cypher() result columns; SET ROLE must not drop ag_catalog from path.
	await sql.unsafe(`ALTER ROLE eigen_app SET search_path TO ag_catalog, "$user", public`);

	console.log(
		`[eigen] eigen_app role ensured (RLS + Apache AGE graph grants on ${ageGraph}).`
	);
} finally {
	await sql.end();
}
