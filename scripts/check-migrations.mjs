import './load-env.mjs';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const client = postgres(process.env.DATABASE_URL);
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf-8'));
const applied = await client`SELECT hash FROM drizzle.__drizzle_migrations`;
const appliedSet = new Set(applied.map((r) => r.hash));
const missing = [];
for (const e of journal.entries) {
	const content = readFileSync(path.join(migrationsFolder, `${e.tag}.sql`), 'utf-8');
	const hash = createHash('sha256').update(content).digest('hex');
	if (!appliedSet.has(hash)) missing.push({ idx: e.idx, tag: e.tag });
}
console.log('missing:', missing);
await client.end();
