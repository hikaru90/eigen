#!/usr/bin/env node
/**
 * Import a prior graph export JSON into Apache AGE.
 *
 * Requires: DATABASE_URL, AGE_GRAPH_NAME
 *
 * Usage:
 *   node scripts/import-graph-export-to-age.mjs --from-export tmp/graph-export-<userId>.json
 *   node scripts/import-graph-export-to-age.mjs --dry-run --from-export tmp/graph-export-<userId>.json
 */
import './load-env.mjs'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

function required(name) {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

function toCypherLiteral(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => toCypherLiteral(v)).join(', ')}]`
  }
  throw new Error(`Unsupported literal: ${typeof value}`)
}

function renderCypher(query, params) {
  return query.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    if (!(key in params)) throw new Error(`Missing param ${key}`)
    return toCypherLiteral(params[key])
  })
}

function wrapAgeCypherDollarQuote(cypher) {
  if (!cypher.includes('$$')) {
    return `$$${cypher}$$`
  }
  let tag = 'age_cypher'
  while (cypher.includes(`$${tag}$`)) {
    tag += '_'
  }
  return `$${tag}$${cypher}$${tag}$`
}

async function runAge(sql, graphName, cypher, columnDefs) {
  const graph = graphName.replace(/'/g, "''")
  return sql.unsafe(
    `SELECT * FROM ag_catalog.cypher('${graph}', ${wrapAgeCypherDollarQuote(cypher)}) AS (${columnDefs})`,
  )
}

async function importUserToAge(sql, graphName, payload, dryRun) {
  const userId = payload.userId
  let imported = 0

  const run = async (cypher, cols) => {
    if (dryRun) return
    await runAge(sql, graphName, cypher, cols)
    imported += 1
  }

  for (const row of payload.thoughts ?? []) {
    await run(
      renderCypher(
        `MERGE (t:Thought {id: $id}) SET t.user_id = $user_id, t.category = $category, t.updated_at = timestamp() RETURN t.id`,
        { id: row.id, user_id: userId, category: row.category ?? 'thought' },
      ),
      'id agtype',
    )
  }
  for (const row of payload.entities ?? []) {
    await run(
      renderCypher(
        `MERGE (e:Entity {id: $id}) SET e.user_id = $user_id, e.canonical_key = $canonical_key, e.label = $label, e.entity_type = $entity_type, e.updated_at = timestamp() RETURN e.id`,
        {
          id: row.id,
          user_id: userId,
          canonical_key: row.canonical_key ?? '',
          label: row.label ?? '',
          entity_type: row.entity_type ?? 'other',
        },
      ),
      'id agtype',
    )
  }
  for (const row of payload.events ?? []) {
    await run(
      renderCypher(
        `MERGE (e:Event {id: $id}) SET e.user_id = $user_id, e.kind = $kind, e.label = $label, e.start_at = $start_at, e.end_at = $end_at, e.updated_at = timestamp() RETURN e.id`,
        {
          id: row.id,
          user_id: userId,
          kind: row.kind ?? 'inferred_event',
          label: row.label ?? '',
          start_at: row.start_at ?? '',
          end_at: row.end_at ?? '',
        },
      ),
      'id agtype',
    )
  }
  for (const row of payload.relates_to ?? []) {
    await run(
      renderCypher(
        `MATCH (a:Thought {id: $source_id, user_id: $user_id}) MATCH (b:Thought {id: $target_id, user_id: $user_id}) MERGE (a)-[r:RELATES_TO {user_id: $user_id, type: $relation_type}]->(b) SET r.updated_at = timestamp() RETURN a.id`,
        {
          source_id: row.source_id,
          target_id: row.target_id,
          user_id: userId,
          relation_type: row.relation_type ?? 'related_to',
        },
      ),
      'id agtype',
    )
  }
  for (const row of payload.mentions ?? []) {
    await run(
      renderCypher(
        `MATCH (t:Thought {id: $thought_id, user_id: $user_id}) MATCH (e:Entity {id: $entity_id, user_id: $user_id}) MERGE (t)-[r:MENTIONS {user_id: $user_id}]->(e) SET r.updated_at = timestamp() RETURN t.id`,
        { thought_id: row.thought_id, entity_id: row.entity_id, user_id: userId },
      ),
      'id agtype',
    )
  }
  for (const row of payload.entity_relates ?? []) {
    const weight = Number(row.weight ?? 1)
    await run(
      renderCypher(
        `MATCH (a:Entity {id: $source_id, user_id: $user_id}) MATCH (b:Entity {id: $target_id, user_id: $user_id}) MERGE (a)-[r:ENTITY_RELATES {user_id: $user_id, predicate: $predicate}]->(b) SET r.weight = $weight, r.updated_at = timestamp() RETURN a.id`,
        {
          source_id: row.source_id,
          target_id: row.target_id,
          user_id: userId,
          predicate: row.predicate ?? 'related_to',
          weight,
        },
      ),
      'id agtype',
    )
  }
  for (const row of payload.occurs_in ?? []) {
    await run(
      renderCypher(
        `MATCH (t:Thought {id: $thought_id, user_id: $user_id}) MATCH (e:Event {id: $event_id, user_id: $user_id}) MERGE (t)-[r:OCCURS_IN {user_id: $user_id}]->(e) SET r.updated_at = timestamp() RETURN t.id`,
        { thought_id: row.thought_id, event_id: row.event_id, user_id: userId },
      ),
      'id agtype',
    )
  }
  for (const row of payload.involves ?? []) {
    await run(
      renderCypher(
        `MATCH (e:Event {id: $event_id, user_id: $user_id}) MATCH (n:Entity {id: $entity_id, user_id: $user_id}) MERGE (e)-[r:INVOLVES {user_id: $user_id}]->(n) SET r.updated_at = timestamp() RETURN e.id`,
        { event_id: row.event_id, entity_id: row.entity_id, user_id: userId },
      ),
      'id agtype',
    )
  }

  return imported
}

const dryRun = process.argv.includes('--dry-run')
const fromExportIdx = process.argv.indexOf('--from-export')
if (fromExportIdx === -1 || !process.argv[fromExportIdx + 1]) {
  console.error(
    'Usage: node scripts/import-graph-export-to-age.mjs --from-export <path> [--dry-run]',
  )
  process.exit(1)
}
const fromExportArg = process.argv[fromExportIdx + 1]

const databaseUrl = required('DATABASE_URL')
const ageGraphName = required('AGE_GRAPH_NAME')

const sql = postgres(databaseUrl, { max: 1 })

try {
  await sql.unsafe(`LOAD 'age'`)
  await sql.unsafe(`SET search_path = ag_catalog, "$user", public`)
  await sql.unsafe(`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = '${ageGraphName.replace(/'/g, "''")}') THEN
				PERFORM ag_catalog.create_graph('${ageGraphName.replace(/'/g, "''")}');
			END IF;
		END $$;
	`)

  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })

  const artifactPath = join(process.cwd(), fromExportArg)
  const payload = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const imported = await importUserToAge(sql, ageGraphName, payload, dryRun)

  const report = {
    dryRun,
    fromExport: fromExportArg,
    users: [
      {
        userId: payload.userId,
        counts: payload.counts,
        artifactPath,
        importedStatements: imported,
      },
    ],
  }
  const reportPath = join(process.cwd(), 'tmp', 'graph-import-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(
    `[import-graph] user=${payload.userId} counts=${JSON.stringify(payload.counts)} imported=${imported} report=${reportPath}`,
  )
} finally {
  await sql.end()
}
