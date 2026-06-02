import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';

const CSV_HEADERS = [
	'id',
	'created_at',
	'updated_at',
	'category',
	'raw_text',
	'normalized_text',
	'status'
] as const;

function escapeCsvField(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function formatCsvRow(values: string[]): string {
	return values.map(escapeCsvField).join(',');
}

function formatTimestamp(date: Date): string {
	return date.toISOString();
}

function thoughtStatus(metadata: Record<string, unknown>): string {
	const status = metadata.status;
	return typeof status === 'string' ? status : '';
}

function exportFilename(): string {
	const day = new Date().toISOString().slice(0, 10);
	return `thoughts-export-${day}.csv`;
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const rows = await getDb()
		.select({
			id: thought.id,
			createdAt: thought.createdAt,
			updatedAt: thought.updatedAt,
			category: thought.category,
			rawText: thought.rawText,
			rawTextEncrypted: thought.rawTextEncrypted,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			metadata: thought.metadata
			,
			metadataEncrypted: thought.metadataEncrypted
		})
		.from(thought)
		.where(eq(thought.userId, user.id))
		.orderBy(asc(thought.createdAt), asc(thought.id));

	const lines = [formatCsvRow([...CSV_HEADERS])];
	for (const row of rows) {
		const [rawText, normalizedText, metadataJson] = await Promise.all([
			row.rawTextEncrypted
				? decryptTenantValue({
						userId: user.id,
						table: 'thought',
						column: 'raw_text',
						ciphertext: row.rawTextEncrypted
					})
				: Promise.resolve(row.rawText),
			row.normalizedTextEncrypted
				? decryptTenantValue({
						userId: user.id,
						table: 'thought',
						column: 'normalized_text',
						ciphertext: row.normalizedTextEncrypted
					})
				: Promise.resolve(row.normalizedText),
			row.metadataEncrypted
				? decryptTenantValue({
						userId: user.id,
						table: 'thought',
						column: 'metadata',
						ciphertext: row.metadataEncrypted
					})
				: Promise.resolve(JSON.stringify(row.metadata ?? {}))
		]);
		const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
		lines.push(
			formatCsvRow([
				row.id,
				formatTimestamp(row.createdAt),
				formatTimestamp(row.updatedAt),
				row.category,
				rawText,
				normalizedText,
				thoughtStatus(metadata)
			])
		);
	}

	const body = `${lines.join('\n')}\n`;

	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${exportFilename()}"`
		}
	});
};
