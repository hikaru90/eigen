import './load-env.mjs'
import postgres from 'postgres'
import { ensureAgeGraphGrants, transferGraphOwnership, quoteIdent } from './age-graph-grants.mjs'
import { getDatabaseUrl } from './db-urls.mjs'

const urlString = getDatabaseUrl()
const appPassword = process.env.EIGEN_APP_DB_PASSWORD?.trim() || 'eigen_app'
const escapedPassword = appPassword.replace(/'/g, "''")

const ageGraph = process.env.AGE_GRAPH_NAME?.trim()
if (!ageGraph) {
  console.error('[eigen] ensure-app-role failed: AGE_GRAPH_NAME is required and must be non-empty.')
  console.error('[eigen] Set AGE_GRAPH_NAME in your environment or .env file.')
  process.exit(1)
}

const sql = postgres(urlString, { max: 1 })

try {
  // Password is set on first deploy only (IF NOT EXISTS). If the role already exists
  // from a previous deploy or the Postgres init script, the password is not updated.
  // To rotate the eigen_app password, drop the role and re-run the entrypoint.
  await sql.unsafe(`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eigen_app') THEN
				CREATE ROLE eigen_app LOGIN PASSWORD '${escapedPassword}';
			END IF;
		END
		$$;
	`)

  const [{ name: dbName }] = await sql`SELECT current_database() AS name`
  const [{ owner }] = await sql`SELECT current_user AS owner`

  await sql.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO eigen_app`)
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO eigen_app`)
  await ensureAgeGraphGrants(sql, { owner, ageGraph })
  await transferGraphOwnership(sql, { graphSchema: ageGraph, appRole: 'eigen_app' })
  await sql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eigen_app`,
  )
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eigen_app`)
  await sql.unsafe(`
		ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public
		  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eigen_app
	`)
  await sql.unsafe(`
		ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public
		  GRANT USAGE, SELECT ON SEQUENCES TO eigen_app
	`)
  await sql.unsafe(`GRANT ${quoteIdent('eigen_app')} TO ${quoteIdent(owner)}`)
  // agtype for Apache AGE cypher() result columns; SET ROLE must not drop ag_catalog from path.
  // public precedes ag_catalog so unqualified DDL targets public.
  await sql.unsafe(`ALTER ROLE eigen_app SET search_path TO public, ag_catalog, "$user"`)

  console.log(`[eigen] eigen_app role ensured (RLS + Apache AGE graph grants on ${ageGraph}).`)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[eigen] ensure-app-role failed: ${message}`)
  console.error(
    '[eigen] Check that DATABASE_URL is correct, the database is accessible, and AGE_GRAPH_NAME is set.',
  )
  process.exit(1)
} finally {
  await sql.end()
}
