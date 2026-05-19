import './load-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const raw = process.env.DATABASE_URL;
if (!raw) {
	console.error('DATABASE_URL is required');
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

const sqlPath = path.join(__dirname, '..', 'src', 'lib', 'server', 'db', 'enable_rls.sql');
const body = fs.readFileSync(sqlPath, 'utf8');

const sql = postgres(urlString, { max: 1 });
try {
	await sql.unsafe(body);
	console.log('RLS applied successfully.');
} finally {
	await sql.end();
}
