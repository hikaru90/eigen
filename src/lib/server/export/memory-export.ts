import { asc, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	entityAlias,
	temporalEvent,
	textFile,
	thoughtEntity,
	thoughtRelation,
	thoughtTextFile
} from '$lib/server/db/schema';
import { buildCsv, formatTimestamp } from './csv';
import { buildGraphExportJson } from './graph-export';
import { buildThoughtsCsv } from './thoughts-csv';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';

export const EXPORT_VERSION = 1;

export type MemoryExportManifest = {
	exportVersion: number;
	exportedAt: string;
	userId: string;
	files: Record<string, number>;
};

export type MemoryExportZip = {
	filename: string;
	bytes: Uint8Array;
	manifest: MemoryExportManifest;
};

const ENTITIES_CSV_HEADERS = [
	'id',
	'canonical_key',
	'label',
	'entity_type',
	'created_at',
	'updated_at'
] as const;

const ENTITY_ALIASES_CSV_HEADERS = ['id', 'canonical_entity_id', 'alias_text', 'created_at'] as const;

const THOUGHT_ENTITIES_CSV_HEADERS = ['thought_id', 'entity_id', 'salience', 'created_at'] as const;

const THOUGHT_RELATIONS_CSV_HEADERS = [
	'id',
	'source_thought_id',
	'target_thought_id',
	'relation_type',
	'created_at'
] as const;

const TEXT_FILES_CSV_HEADERS = ['id', 'title', 'body_text', 'created_at', 'updated_at'] as const;

const THOUGHT_TEXT_FILE_CSV_HEADERS = ['thought_id', 'text_file_id', 'created_at'] as const;

const TEMPORAL_EVENTS_CSV_HEADERS = [
	'id',
	'thought_id',
	'kind',
	'active_period',
	'time_precision',
	'timezone',
	'is_all_day',
	'semantic_summary',
	'start_at',
	'end_at',
	'created_at',
	'updated_at'
] as const;

async function buildEntitiesCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			id: canonicalEntity.id,
			canonicalKey: canonicalEntity.canonicalKey,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType,
			createdAt: canonicalEntity.createdAt,
			updatedAt: canonicalEntity.updatedAt
		})
		.from(canonicalEntity)
		.where(eq(canonicalEntity.userId, userId))
		.orderBy(asc(canonicalEntity.createdAt), asc(canonicalEntity.id));

	return buildCsv(
		ENTITIES_CSV_HEADERS,
		rows.map((row) => [
			row.id,
			row.canonicalKey,
			row.label,
			row.entityType,
			formatTimestamp(row.createdAt),
			formatTimestamp(row.updatedAt)
		])
	);
}

async function buildEntityAliasesCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			id: entityAlias.id,
			canonicalEntityId: entityAlias.canonicalEntityId,
			aliasText: entityAlias.aliasText,
			createdAt: entityAlias.createdAt
		})
		.from(entityAlias)
		.where(eq(entityAlias.userId, userId))
		.orderBy(asc(entityAlias.createdAt), asc(entityAlias.id));

	return buildCsv(
		ENTITY_ALIASES_CSV_HEADERS,
		rows.map((row) => [
			row.id,
			row.canonicalEntityId,
			row.aliasText,
			formatTimestamp(row.createdAt)
		])
	);
}

async function buildThoughtEntitiesCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			thoughtId: thoughtEntity.thoughtId,
			entityId: thoughtEntity.entityId,
			salience: thoughtEntity.salience,
			createdAt: thoughtEntity.createdAt
		})
		.from(thoughtEntity)
		.where(eq(thoughtEntity.userId, userId))
		.orderBy(asc(thoughtEntity.createdAt), asc(thoughtEntity.thoughtId), asc(thoughtEntity.entityId));

	return buildCsv(
		THOUGHT_ENTITIES_CSV_HEADERS,
		rows.map((row) => [
			row.thoughtId,
			row.entityId,
			String(row.salience),
			formatTimestamp(row.createdAt)
		])
	);
}

async function buildThoughtRelationsCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			id: thoughtRelation.id,
			sourceThoughtId: thoughtRelation.sourceThoughtId,
			targetThoughtId: thoughtRelation.targetThoughtId,
			relationType: thoughtRelation.relationType,
			createdAt: thoughtRelation.createdAt
		})
		.from(thoughtRelation)
		.where(eq(thoughtRelation.userId, userId))
		.orderBy(asc(thoughtRelation.createdAt), asc(thoughtRelation.id));

	return buildCsv(
		THOUGHT_RELATIONS_CSV_HEADERS,
		rows.map((row) => [
			row.id,
			row.sourceThoughtId,
			row.targetThoughtId,
			row.relationType,
			formatTimestamp(row.createdAt)
		])
	);
}

async function buildTemporalEventsCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			id: temporalEvent.id,
			thoughtId: temporalEvent.thoughtId,
			kind: temporalEvent.kind,
			activePeriod: temporalEvent.activePeriod,
			timePrecision: temporalEvent.timePrecision,
			timezone: temporalEvent.timezone,
			isAllDay: temporalEvent.isAllDay,
			semanticSummary: temporalEvent.semanticSummary,
			startAt: temporalEvent.startAt,
			endAt: temporalEvent.endAt,
			createdAt: temporalEvent.createdAt,
			updatedAt: temporalEvent.updatedAt
		})
		.from(temporalEvent)
		.where(eq(temporalEvent.userId, userId))
		.orderBy(asc(temporalEvent.createdAt), asc(temporalEvent.id));

	return buildCsv(
		TEMPORAL_EVENTS_CSV_HEADERS,
		rows.map((row) => [
			row.id,
			row.thoughtId,
			row.kind,
			row.activePeriod,
			row.timePrecision,
			row.timezone,
			String(row.isAllDay),
			row.semanticSummary,
			row.startAt ? formatTimestamp(row.startAt) : '',
			row.endAt ? formatTimestamp(row.endAt) : '',
			formatTimestamp(row.createdAt),
			formatTimestamp(row.updatedAt)
		])
	);
}

async function buildTextFilesCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			id: textFile.id,
			title: textFile.title,
			bodyText: textFile.bodyText,
			bodyTextEncrypted: textFile.bodyTextEncrypted,
			createdAt: textFile.createdAt,
			updatedAt: textFile.updatedAt
		})
		.from(textFile)
		.where(eq(textFile.userId, userId))
		.orderBy(asc(textFile.createdAt), asc(textFile.id));

	const dataRows: string[][] = [];
	for (const row of rows) {
		const bodyText = row.bodyTextEncrypted
			? await decryptTenantValue({
					userId,
					table: 'text_file',
					column: 'body_text',
					ciphertext: row.bodyTextEncrypted
				})
			: row.bodyText;
		dataRows.push([
			row.id,
			row.title,
			bodyText,
			formatTimestamp(row.createdAt),
			formatTimestamp(row.updatedAt)
		]);
	}

	return buildCsv(TEXT_FILES_CSV_HEADERS, dataRows);
}

async function buildThoughtTextFileCsv(userId: string): Promise<string> {
	const rows = await getDb()
		.select({
			thoughtId: thoughtTextFile.thoughtId,
			textFileId: thoughtTextFile.textFileId,
			createdAt: thoughtTextFile.createdAt
		})
		.from(thoughtTextFile)
		.where(eq(thoughtTextFile.userId, userId))
		.orderBy(
			asc(thoughtTextFile.createdAt),
			asc(thoughtTextFile.thoughtId),
			asc(thoughtTextFile.textFileId)
		);

	return buildCsv(
		THOUGHT_TEXT_FILE_CSV_HEADERS,
		rows.map((row) => [
			row.thoughtId,
			row.textFileId,
			formatTimestamp(row.createdAt)
		])
	);
}

function countCsvDataRows(csv: string): number {
	const trimmed = csv.trimEnd();
	if (!trimmed) return 0;
	const lines = trimmed.split('\n');
	return Math.max(0, lines.length - 1);
}

function exportFilename(): string {
	const day = new Date().toISOString().slice(0, 10);
	return `eigen-memory-export-${day}.zip`;
}

export async function buildMemoryExportZip(userId: string): Promise<MemoryExportZip> {
	const [
		thoughtsCsv,
		entitiesCsv,
		entityAliasesCsv,
		thoughtEntitiesCsv,
		thoughtRelationsCsv,
		temporalEventsCsv,
		textFilesCsv,
		thoughtTextFileCsv,
		graphJson
	] = await Promise.all([
		buildThoughtsCsv(userId),
		buildEntitiesCsv(userId),
		buildEntityAliasesCsv(userId),
		buildThoughtEntitiesCsv(userId),
		buildThoughtRelationsCsv(userId),
		buildTemporalEventsCsv(userId),
		buildTextFilesCsv(userId),
		buildThoughtTextFileCsv(userId),
		buildGraphExportJson(userId)
	]);

	const manifest: MemoryExportManifest = {
		exportVersion: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		userId,
		files: {
			'thoughts.csv': countCsvDataRows(thoughtsCsv),
			'entities.csv': countCsvDataRows(entitiesCsv),
			'entity_aliases.csv': countCsvDataRows(entityAliasesCsv),
			'thought_entities.csv': countCsvDataRows(thoughtEntitiesCsv),
			'thought_relations.csv': countCsvDataRows(thoughtRelationsCsv),
			'temporal_events.csv': countCsvDataRows(temporalEventsCsv),
			'text_files.csv': countCsvDataRows(textFilesCsv),
			'thought_text_file.csv': countCsvDataRows(thoughtTextFileCsv),
			'graph.json': Object.values(graphJson.counts).reduce((sum, n) => sum + n, 0)
		}
	};

	const graphJsonStr = JSON.stringify(graphJson, null, 2);
	const manifestStr = JSON.stringify(manifest, null, 2);

	const zipEntries: Record<string, Uint8Array> = {
		'thoughts.csv': strToU8(thoughtsCsv),
		'entities.csv': strToU8(entitiesCsv),
		'entity_aliases.csv': strToU8(entityAliasesCsv),
		'thought_entities.csv': strToU8(thoughtEntitiesCsv),
		'thought_relations.csv': strToU8(thoughtRelationsCsv),
		'temporal_events.csv': strToU8(temporalEventsCsv),
		'text_files.csv': strToU8(textFilesCsv),
		'thought_text_file.csv': strToU8(thoughtTextFileCsv),
		'graph.json': strToU8(graphJsonStr),
		'manifest.json': strToU8(manifestStr)
	};

	return {
		filename: exportFilename(),
		bytes: zipSync(zipEntries),
		manifest
	};
}
