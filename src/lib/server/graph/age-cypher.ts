import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';
import { sql } from 'drizzle-orm';

function requiredEnv(name: 'AGE_GRAPH_NAME'): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required and must be non-empty`);
	}
	return value;
}

export function ageGraphName(): string {
	return requiredEnv('AGE_GRAPH_NAME');
}

export function toCypherLiteral(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Invalid cypher number literal');
		return String(value);
	}
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') {
		return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => toCypherLiteral(item)).join(', ')}]`;
	}
	throw new Error(`Unsupported cypher literal type: ${typeof value}`);
}

export function renderCypherQuery(query: string, params?: Record<string, unknown>): string {
	if (!params) return query;
	return query.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_full, key) => {
		if (!(key in params)) {
			throw new Error(`Missing cypher parameter: ${key}`);
		}
		return toCypherLiteral(params[key]);
	});
}

function decodeAgtypeValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed) return '';

	const withoutType = trimmed.replace(/::[a-zA-Z_][a-zA-Z0-9_]*$/, '');
	if (withoutType === 'null') return null;
	if (withoutType === 'true') return true;
	if (withoutType === 'false') return false;
	if (/^-?\d+(\.\d+)?$/.test(withoutType)) return Number(withoutType);
	if (withoutType.startsWith('"') && withoutType.endsWith('"')) {
		try {
			return JSON.parse(withoutType);
		} catch {
			return withoutType.slice(1, -1);
		}
	}
	return withoutType;
}

/** AGE requires the Cypher query argument to be a PostgreSQL dollar-quoted string, not single-quoted. */
export function wrapAgeCypherDollarQuote(cypher: string): string {
	if (!cypher.includes('$$')) {
		return `$$${cypher}$$`;
	}
	let tag = 'age_cypher';
	while (cypher.includes(`$${tag}$`)) {
		tag += '_';
	}
	return `$${tag}$${cypher}$${tag}$`;
}

export async function runAgeCypher(
	cypher: string,
	columnDefs: string
): Promise<Array<Record<string, unknown>>> {
	const db = getDb();
	// AGE is preloaded via shared_preload_libraries; LOAD 'age' fails under SET ROLE eigen_app.
	await db.execute(sql.raw(`SET search_path = ag_catalog, "$user", public`));
	const graph = ageGraphName().replace(/'/g, "''");
	const quotedCypher = wrapAgeCypherDollarQuote(cypher);
	const raw = await db.execute(
		sql.raw(`SELECT * FROM ag_catalog.cypher('${graph}', ${quotedCypher}) AS (${columnDefs})`)
	);
	const rows = Array.isArray(raw)
		? (raw as Array<Record<string, unknown>>)
		: (((raw as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<
				Record<string, unknown>
			>);
	return rows.map((row) => {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(row)) {
			out[k] = decodeAgtypeValue(v);
		}
		return out;
	});
}

export async function runGraphQueryWithRetry<T>(
	userId: string,
	operation: string,
	query: () => Promise<T>,
	context?: string
): Promise<T> {
	const maxAttempts = 3;
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStart = Date.now();
		try {
			const result = await query();
			await logActivityCall(getDb(), userId, {
				provider: 'apache_age',
				operation: `${operation}.success(attempt=${attempt})`,
				baseCostUsd: 0,
				context,
				durationMs: Date.now() - attemptStart
			});
			return result;
		} catch (err) {
			lastError = err;
			await logActivityCall(getDb(), userId, {
				provider: 'apache_age',
				operation: `${operation}.error(attempt=${attempt})`,
				baseCostUsd: 0,
				context,
				durationMs: Date.now() - attemptStart
			});
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Apache AGE graph operation failed after ${maxAttempts} attempts`);
}
