#!/usr/bin/env node
/**
 * One-time FalkorDB → Apache AGE migration.
 *
 * Full export+import (needs Falkor): DATABASE_URL, AGE_GRAPH_NAME, FALKOR_*
 * Import only from a prior export JSON: DATABASE_URL, AGE_GRAPH_NAME, --from-export <path>
 *
 * Usage:
 *   node scripts/migrate-graph-falkor-to-age.mjs [--dry-run] [--user-id <id>]
 *   node scripts/migrate-graph-falkor-to-age.mjs --from-export tmp/falkor-export-<userId>.json
 */
import './load-env.mjs';
import postgres from 'postgres';
import { FalkorDB } from 'falkordb';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function required(name) {
	const v = process.env[name]?.trim();
	if (!v) throw new Error(`${name} is required`);
	return v;
}

function normalizeGraphKeyPart(input) {
	const out = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
	const collapsed = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
	if (!collapsed.length) throw new Error(`Invalid user id: ${input}`);
	return collapsed.slice(0, 80);
}

function falkorGraphForUser(userId) {
	return `user_${normalizeGraphKeyPart(userId)}`;
}

function toCypherLiteral(value) {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') {
		return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	}
	if (Array.isArray(value)) {
		return `[${value.map((v) => toCypherLiteral(v)).join(', ')}]`;
	}
	throw new Error(`Unsupported literal: ${typeof value}`);
}

function renderCypher(query, params) {
	return query.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
		if (!(key in params)) throw new Error(`Missing param ${key}`);
		return toCypherLiteral(params[key]);
	});
}

function wrapAgeCypherDollarQuote(cypher) {
	if (!cypher.includes('$$')) {
		return `$$${cypher}$$`;
	}
	let tag = 'age_cypher';
	while (cypher.includes(`$${tag}$`)) {
		tag += '_';
	}
	return `$${tag}$${cypher}$${tag}$`;
}

async function runAge(sql, graphName, cypher, columnDefs) {
	const graph = graphName.replace(/'/g, "''");
	return sql.unsafe(
		`SELECT * FROM ag_catalog.cypher('${graph}', ${wrapAgeCypherDollarQuote(cypher)}) AS (${columnDefs})`
	);
}

async function exportUserGraph(graph, userId) {
	const exportQueries = [
		{
			key: 'thoughts',
			cypher: `MATCH (n:Thought {user_id: $user_id}) RETURN n.id AS id, n.category AS category`,
			params: { user_id: userId }
		},
		{
			key: 'entities',
			cypher: `MATCH (n:Entity {user_id: $user_id}) RETURN n.id AS id, n.canonical_key AS canonical_key, n.label AS label, n.entity_type AS entity_type`,
			params: { user_id: userId }
		},
		{
			key: 'events',
			cypher: `MATCH (n:Event {user_id: $user_id}) RETURN n.id AS id, n.kind AS kind, n.label AS label, n.start_at AS start_at, n.end_at AS end_at`,
			params: { user_id: userId }
		},
		{
			key: 'relates_to',
			cypher: `MATCH (a:Thought {user_id: $user_id})-[r:RELATES_TO {user_id: $user_id}]->(b:Thought {user_id: $user_id}) RETURN a.id AS source_id, b.id AS target_id, r.type AS relation_type`,
			params: { user_id: userId }
		},
		{
			key: 'mentions',
			cypher: `MATCH (t:Thought {user_id: $user_id})-[r:MENTIONS {user_id: $user_id}]->(e:Entity {user_id: $user_id}) RETURN t.id AS thought_id, e.id AS entity_id`,
			params: { user_id: userId }
		},
		{
			key: 'entity_relates',
			cypher: `MATCH (a:Entity {user_id: $user_id})-[r:ENTITY_RELATES {user_id: $user_id}]->(b:Entity {user_id: $user_id}) RETURN a.id AS source_id, b.id AS target_id, r.predicate AS predicate, coalesce(r.weight, 1) AS weight`,
			params: { user_id: userId }
		},
		{
			key: 'occurs_in',
			cypher: `MATCH (t:Thought {user_id: $user_id})-[r:OCCURS_IN {user_id: $user_id}]->(e:Event {user_id: $user_id}) RETURN t.id AS thought_id, e.id AS event_id`,
			params: { user_id: userId }
		},
		{
			key: 'involves',
			cypher: `MATCH (ev:Event {user_id: $user_id})-[r:INVOLVES {user_id: $user_id}]->(ent:Entity {user_id: $user_id}) RETURN ev.id AS event_id, ent.id AS entity_id`,
			params: { user_id: userId }
		}
	];

	const out = { userId, counts: {} };
	for (const q of exportQueries) {
		const result = await graph.query(q.cypher, { params: q.params });
		out[q.key] = result?.data ?? [];
		out.counts[q.key] = out[q.key].length;
	}
	return out;
}

async function importUserToAge(sql, graphName, payload, dryRun) {
	const userId = payload.userId;
	let imported = 0;

	const run = async (cypher, cols) => {
		if (dryRun) return;
		await runAge(sql, graphName, cypher, cols);
		imported += 1;
	};

	for (const row of payload.thoughts ?? []) {
		await run(
			renderCypher(
				`MERGE (t:Thought {id: $id}) SET t.user_id = $user_id, t.category = $category, t.updated_at = timestamp() RETURN t.id`,
				{ id: row.id, user_id: userId, category: row.category ?? 'thought' }
			),
			'id agtype'
		);
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
					entity_type: row.entity_type ?? 'other'
				}
			),
			'id agtype'
		);
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
					end_at: row.end_at ?? ''
				}
			),
			'id agtype'
		);
	}
	for (const row of payload.relates_to ?? []) {
		await run(
			renderCypher(
				`MATCH (a:Thought {id: $source_id, user_id: $user_id}) MATCH (b:Thought {id: $target_id, user_id: $user_id}) MERGE (a)-[r:RELATES_TO {user_id: $user_id, type: $relation_type}]->(b) SET r.updated_at = timestamp() RETURN a.id`,
				{
					source_id: row.source_id,
					target_id: row.target_id,
					user_id: userId,
					relation_type: row.relation_type ?? 'related_to'
				}
			),
			'id agtype'
		);
	}
	for (const row of payload.mentions ?? []) {
		await run(
			renderCypher(
				`MATCH (t:Thought {id: $thought_id, user_id: $user_id}) MATCH (e:Entity {id: $entity_id, user_id: $user_id}) MERGE (t)-[r:MENTIONS {user_id: $user_id}]->(e) SET r.updated_at = timestamp() RETURN t.id`,
				{ thought_id: row.thought_id, entity_id: row.entity_id, user_id: userId }
			),
			'id agtype'
		);
	}
	for (const row of payload.entity_relates ?? []) {
		const weight = Number(row.weight ?? 1);
		await run(
			renderCypher(
				`MATCH (a:Entity {id: $source_id, user_id: $user_id}) MATCH (b:Entity {id: $target_id, user_id: $user_id}) MERGE (a)-[r:ENTITY_RELATES {user_id: $user_id, predicate: $predicate}]->(b) SET r.weight = $weight, r.updated_at = timestamp() RETURN a.id`,
				{
					source_id: row.source_id,
					target_id: row.target_id,
					user_id: userId,
					predicate: row.predicate ?? 'related_to',
					weight
				}
			),
			'id agtype'
		);
	}
	for (const row of payload.occurs_in ?? []) {
		await run(
			renderCypher(
				`MATCH (t:Thought {id: $thought_id, user_id: $user_id}) MATCH (e:Event {id: $event_id, user_id: $user_id}) MERGE (t)-[r:OCCURS_IN {user_id: $user_id}]->(e) SET r.updated_at = timestamp() RETURN t.id`,
				{ thought_id: row.thought_id, event_id: row.event_id, user_id: userId }
			),
			'id agtype'
		);
	}
	for (const row of payload.involves ?? []) {
		await run(
			renderCypher(
				`MATCH (e:Event {id: $event_id, user_id: $user_id}) MATCH (n:Entity {id: $entity_id, user_id: $user_id}) MERGE (e)-[r:INVOLVES {user_id: $user_id}]->(n) SET r.updated_at = timestamp() RETURN e.id`,
				{ event_id: row.event_id, entity_id: row.entity_id, user_id: userId }
			),
			'id agtype'
		);
	}

	return imported;
}

const dryRun = process.argv.includes('--dry-run');
const userIdArg = process.argv.includes('--user-id')
	? process.argv[process.argv.indexOf('--user-id') + 1]
	: null;
const fromExportArg = process.argv.includes('--from-export')
	? process.argv[process.argv.indexOf('--from-export') + 1]
	: null;

const databaseUrl = required('DATABASE_URL');
const ageGraphName = required('AGE_GRAPH_NAME');

const sql = postgres(databaseUrl, { max: 1 });
/** @type {import('falkordb').FalkorDB | null} */
let client = null;
if (!fromExportArg) {
	const falkorHost = required('FALKOR_HOST');
	const falkorPort = Number(required('FALKOR_PORT'));
	const falkorPassword = required('FALKOR_PASSWORD');
	const falkorUsername = required('FALKOR_USERNAME');
	client = await FalkorDB.connect({
		socket: { host: falkorHost, port: falkorPort },
		password: falkorPassword,
		username: falkorUsername
	});
}

try {
	await sql.unsafe(`LOAD 'age'`);
	await sql.unsafe(`SET search_path = ag_catalog, "$user", public`);
	await sql.unsafe(`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = '${ageGraphName.replace(/'/g, "''")}') THEN
				PERFORM ag_catalog.create_graph('${ageGraphName.replace(/'/g, "''")}');
			END IF;
		END $$;
	`);

	const report = { users: [], dryRun, fromExport: fromExportArg ?? null };
	mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });

	if (fromExportArg) {
		const artifactPath = join(process.cwd(), fromExportArg);
		const payload = JSON.parse(readFileSync(artifactPath, 'utf8'));
		const imported = await importUserToAge(sql, ageGraphName, payload, dryRun);
		report.users.push({
			userId: payload.userId,
			counts: payload.counts,
			artifactPath,
			importedStatements: imported
		});
		console.log(
			`[migrate] import-only user=${payload.userId} counts=${JSON.stringify(payload.counts)} imported=${imported}`
		);
	} else {
		const userRows = userIdArg
			? [{ user_id: userIdArg }]
			: await sql`SELECT DISTINCT user_id FROM thought ORDER BY user_id`;

		for (const { user_id: userId } of userRows) {
			const graph = client.selectGraph(falkorGraphForUser(userId));
			const payload = await exportUserGraph(graph, userId);
			const artifactPath = join(process.cwd(), 'tmp', `falkor-export-${userId}.json`);
			writeFileSync(artifactPath, JSON.stringify(payload, null, 2));
			const imported = await importUserToAge(sql, ageGraphName, payload, dryRun);
			report.users.push({ userId, counts: payload.counts, artifactPath, importedStatements: imported });
			console.log(`[migrate] user=${userId} counts=${JSON.stringify(payload.counts)} imported=${imported}`);
		}
	}

	const reportPath = join(process.cwd(), 'tmp', 'falkor-to-age-migration-report.json');
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log(`[migrate] report written to ${reportPath}`);
} finally {
	await sql.end();
	if (client) await client.close();
}
