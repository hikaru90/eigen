/**
 * Fail fast when eigen_app cannot write Thought / Entity / MENTIONS in Apache AGE.
 * Runs on every app container start (after ensure-app-role).
 */
import './load-env.mjs'
import postgres from 'postgres'
import { getDatabaseUrl } from './db-urls.mjs'
import { quoteIdent } from './age-graph-grants.mjs'

const AGE_SEARCH_PATH = 'ag_catalog, "$user", public'

const ageGraph = process.env.AGE_GRAPH_NAME?.trim()
if (!ageGraph) {
  throw new Error('AGE_GRAPH_NAME is required and must be non-empty')
}

const testThoughtId = '00000000-0000-0000-0000-000000009901'
const testEntityId = '00000000-0000-0000-0000-000000009902'
const testUserId = '__eigen_age_bootstrap__'

const sql = postgres(getDatabaseUrl(), { max: 1 })

try {
  const escapedGraph = ageGraph.replace(/'/g, "''")
  await sql.unsafe(`LOAD 'age'`)
  await sql.unsafe(`SET search_path = ${AGE_SEARCH_PATH}`)
  await sql.unsafe(`SET ROLE ${quoteIdent('eigen_app')}`)

  const probe = `
		MERGE (t:Thought {id: '${testThoughtId}'})
		SET t.user_id = '${testUserId}'
		MERGE (e:Entity {id: '${testEntityId}'})
		SET e.user_id = '${testUserId}'
		MERGE (t)-[r:MENTIONS {user_id: '${testUserId}'}]->(e)
		SET r.updated_at = timestamp()
		RETURN 1 AS ok
	`
  await sql.unsafe(
    `SELECT * FROM ag_catalog.cypher('${escapedGraph}', $$${probe}$$) AS (ok agtype)`,
  )

  const cleanup = `
		MATCH (t:Thought {id: '${testThoughtId}'})
		WHERE t.user_id = '${testUserId}'
		DETACH DELETE t
	`
  await sql.unsafe(
    `SELECT * FROM ag_catalog.cypher('${escapedGraph}', $$${cleanup}$$) AS (ok agtype)`,
  )

  await sql.unsafe('RESET ROLE')
  console.log(`[eigen] eigen_app graph write probe OK (${ageGraph})`)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  throw new Error(
    `eigen_app cannot write Apache AGE graph "${ageGraph}" (Thought/Entity/MENTIONS). ` +
      `OSS deploys run graph writes as eigen_app via SET ROLE; grants must allow edge creation. ` +
      `Underlying error: ${message}`,
    { cause: err },
  )
} finally {
  await sql.end()
}
