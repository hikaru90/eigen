/**
 * Programmatic Drizzle migration runner.
 *
 * Uses drizzle-orm's migrate() which reads SQL files from drizzle/ and applies
 * any that have not yet been recorded in the drizzle.__drizzle_migrations table.
 * Fully non-interactive — safe for Docker / CI / non-TTY environments.
 *
 * Push-to-migrate transition
 * --------------------------
 * This project was previously managed with `drizzle-kit push`, which never creates
 * the `drizzle.__drizzle_migrations` tracking table. On the first run of this script
 * on an existing production DB:
 *   - drizzle migrate() sees an empty migrations table and tries to apply ALL files
 *     starting from 0000, which immediately fails because those tables already exist.
 *
 * The bootstrap step below detects this condition (thought table exists but migrations
 * table is empty/missing) and pre-seeds migration records for 0000-0008 so that
 * migrate() only applies the genuinely missing files (0009+).
 *
 * The hash stored per entry is SHA-256 of the raw SQL file content — the same
 * computation drizzle-orm/postgres-js/migrator uses internally.
 *
 * Usage: node scripts/migrate.mjs
 */
import './load-env.mjs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const raw = process.env.DATABASE_URL;
if (!raw) {
	console.error('[eigen] DATABASE_URL is required');
	process.exit(1);
}

let urlString = raw;
try {
	const u = new URL(raw);
	u.searchParams.delete('uselibpqcompat');
	urlString = u.toString();
} catch {
	// keep raw
}

const migrationsFolder = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'../drizzle'
);

const journalPath = path.join(migrationsFolder, 'meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));

// Index of the last migration that was applied via drizzle-kit push (never tracked).
// Any entry with idx <= LAST_PUSH_IDX on a push-managed DB is treated as already applied.
const LAST_PUSH_IDX = 8; // 0008_chat_message_metadata

const client = postgres(urlString, { max: 1 });
const db = drizzle(client);

/**
 * Detects a DB previously managed by drizzle-kit push and pre-seeds the
 * drizzle.__drizzle_migrations table so migrate() skips already-applied files.
 */
async function bootstrapIfPushManaged() {
	// Ensure the drizzle schema exists (drizzle-orm creates it, but we need it first).
	await client`CREATE SCHEMA IF NOT EXISTS drizzle`;

	// Create the migrations tracking table if absent (drizzle-orm will do this too,
	// but we need to check it before calling migrate()).
	await client`
		CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
			id      SERIAL PRIMARY KEY,
			hash    text   NOT NULL,
			created_at bigint
		)
	`;

	// If the table already has records, migrate() has run before — nothing to do.
	const [{ count }] = await client`SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations`;
	if (parseInt(count, 10) > 0) return;

	// Check if this looks like a push-managed DB (thought table exists).
	const [{ exists }] = await client`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'thought'
		) AS exists
	`;
	if (!exists) {
		// Fresh database — let migrate() apply everything from 0000.
		return;
	}

	// Push-managed DB: seed history for all migrations up through LAST_PUSH_IDX.
	console.log(
		'[eigen] Detected push-managed DB. Seeding migration history for idx 0–' + LAST_PUSH_IDX + '...'
	);
	for (const entry of journal.entries) {
		if (entry.idx > LAST_PUSH_IDX) break;
		const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
		const sqlContent = readFileSync(sqlPath, 'utf-8');
		const hash = createHash('sha256').update(sqlContent).digest('hex');
		await client`
			INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
			VALUES (${hash}, ${entry.when})
		`;
	}
	console.log('[eigen] Migration history seeded. migrate() will apply idx 9+.');
}

try {
	console.log('[eigen] Running migrations from', migrationsFolder);
	await bootstrapIfPushManaged();
	await migrate(db, { migrationsFolder });
	console.log('[eigen] Migrations complete.');
} catch (err) {
	console.error('[eigen] Migration failed:', err);
	process.exit(1);
} finally {
	await client.end();
}
