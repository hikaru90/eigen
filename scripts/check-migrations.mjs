/**
 * Diagnostic script: check migration state and schema completeness.
 * Run on VPS to diagnose migration issues without losing data.
 *
 * Usage: node scripts/check-migrations.mjs
 */
import './load-env.mjs';
import postgres from 'postgres';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDatabaseUrl } from './db-urls.mjs';

const urlString = getDatabaseUrl();
const migrationsFolder = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'../drizzle'
);
const journalPath = path.join(migrationsFolder, 'meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));

function migrationHash(sqlContent) {
	return createHash('sha256').update(sqlContent).digest('hex');
}

const sql = postgres(urlString, { max: 1 });

try {
	console.log('=== Migration State Check ===\n');

	// Check if drizzle schema exists
	const [{ exists: drizzleSchemaExists }] = await sql`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle'
		) AS exists
	`;
	console.log(`Drizzle schema exists: ${drizzleSchemaExists}`);

	// Check migration tracking table
	const [{ exists: migrationsTableExists }] = await sql`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
		) AS exists
	`;
	console.log(`Migration tracking table exists: ${migrationsTableExists}`);

	let appliedMigrations = [];
	if (migrationsTableExists) {
		appliedMigrations = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
		console.log(`Applied migrations: ${appliedMigrations.length}`);
	}

	// Check each migration
	console.log('\n=== Migration Status ===\n');
	const appliedHashes = new Set(appliedMigrations.map((r) => r.hash));
	let missingCount = 0;

	for (const entry of journal.entries) {
		const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
		const sqlContent = readFileSync(sqlPath, 'utf-8');
		const hash = migrationHash(sqlContent);
		const isApplied = appliedHashes.has(hash);

		if (!isApplied) {
			console.log(`❌ ${entry.tag} (idx ${entry.idx}) - NOT APPLIED`);
			missingCount++;
		}
	}

	if (missingCount === 0) {
		console.log('✅ All migrations are applied');
	} else {
		console.log(`\n⚠️  ${missingCount} migration(s) need to be applied`);
	}

	// Check thought table schema
	console.log('\n=== Thought Table Schema ===\n');
	const thoughtColumns = await sql`
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'thought'
		ORDER BY ordinal_position
	`;
	console.log(`Thought table has ${thoughtColumns.length} columns:`);
	for (const col of thoughtColumns) {
		console.log(`  - ${col.column_name} (${col.data_type}, ${col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'})`);
	}

	// Check required columns
	const requiredColumns = [
		'id', 'user_id', 'raw_text', 'normalized_text', 'lexical_text', 'category',
		'metadata', 'embedding', 'created_at', 'updated_at',
		'raw_text_encrypted', 'normalized_text_encrypted', 'metadata_encrypted',
		'ontology_entity_kind_id', 'memory_type', 'cues', 'cues_encrypted',
		'salience_score', 'access_count', 'last_accessed_at', 'enriched_at',
		'enrich_queue_status', 'enrich_queue_error', 'capture_source',
		'enrichment_version', 'rerank_snippet', 'primary_community_ids',
		'entity_centrality_max', 'specificity_score', 'recency_bucket', 'bundle_rank'
	];
	const existingColumns = new Set(thoughtColumns.map((c) => c.column_name));
	const missingColumns = requiredColumns.filter((c) => !existingColumns.has(c));

	if (missingColumns.length > 0) {
		console.log(`\n❌ Missing columns: ${missingColumns.join(', ')}`);
	} else {
		console.log('\n✅ All required columns exist');
	}

	// Check AGE graph
	console.log('\n=== Apache AGE Graph ===\n');
	try {
		await sql.unsafe(`LOAD 'age'`);
		await sql.unsafe(`SET search_path = ag_catalog, public`);
		const graphName = process.env.AGE_GRAPH_NAME?.trim() || 'eigen_graph';
		const [{ exists: graphExists }] = await sql`
			SELECT EXISTS (
				SELECT 1 FROM ag_catalog.ag_graph WHERE name = ${graphName}
			) AS exists
		`;
		console.log(`Graph '${graphName}' exists: ${graphExists}`);
	} catch (err) {
		console.log(`AGE check failed: ${err.message}`);
	}

	// Check eigen_app role
	console.log('\n=== eigen_app Role ===\n');
	const [{ exists: roleExists }] = await sql`
		SELECT EXISTS (
			SELECT 1 FROM pg_roles WHERE rolname = 'eigen_app'
		) AS exists
	`;
	console.log(`eigen_app role exists: ${roleExists}`);

	if (roleExists) {
		const grants = await sql`
			SELECT grantee, privilege_type, table_schema
			FROM information_schema.role_table_grants
			WHERE grantee = 'eigen_app' AND table_schema = 'public'
			LIMIT 5
		`;
		console.log(`eigen_app has ${grants.length} grants on public schema`);
	}

} catch (err) {
	console.error('Error:', err.message);
} finally {
	await sql.end();
}
