import './load-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getDatabaseUrl } from './db-urls.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const urlString = getDatabaseUrl();

const sqlPath = path.join(__dirname, '..', 'src', 'lib', 'server', 'db', 'enable_rls.sql');
const body = fs.readFileSync(sqlPath, 'utf8');

const sql = postgres(urlString, { max: 1 });
try {
	await sql.unsafe(body);
	console.log('RLS applied successfully.');
} finally {
	await sql.end();
}
