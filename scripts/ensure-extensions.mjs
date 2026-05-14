import postgres from 'postgres';

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

const sql = postgres(urlString, { max: 1 });
try {
	await sql.unsafe(`
		CREATE EXTENSION IF NOT EXISTS vector;
		CREATE EXTENSION IF NOT EXISTS age;
	`);
	console.log('[eigen] Extensions ensured (vector, age).');
} finally {
	await sql.end();
}
