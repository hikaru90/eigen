/**
 * Apache AGE vertex/edge labels and tenant-scoped property indexes.
 *
 * Labels are created eagerly so btree indexes on user_id exist before scale.
 * Idempotent: safe to run on every ensure-extensions / docker init.
 */

import { quoteIdent } from './age-graph-grants.mjs';

/** @type {readonly string[]} */
export const AGE_VERTEX_LABELS = ['Thought', 'Entity', 'Event'];

/** @type {readonly string[]} */
export const AGE_EDGE_LABELS = [
	'RELATES_TO',
	'MENTIONS',
	'ENTITY_RELATES',
	'OCCURS_IN',
	'INVOLVES'
];

/**
 * @param {string} graphName
 * @param {'v' | 'e'} kind
 * @param {string} labelName
 */
function labelExistsSql(graphName, kind, labelName) {
	const escapedGraph = graphName.replace(/'/g, "''");
	const escapedLabel = labelName.replace(/'/g, "''");
	return `
		SELECT 1
		FROM ag_catalog.ag_label l
		INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
		WHERE g.name = '${escapedGraph}'
		  AND l.name = '${escapedLabel}'
		  AND l.kind = '${kind}'
	`;
}

/**
 * @param {string} graphName
 * @param {string} labelName
 * @param {'v' | 'e'} kind
 */
function createLabelSql(graphName, labelName, kind) {
	const escapedGraph = graphName.replace(/'/g, "''");
	const escapedLabel = labelName.replace(/'/g, "''");
	const fn = kind === 'v' ? 'create_vlabel' : 'create_elabel';
	return `
		DO $$
		BEGIN
			IF NOT EXISTS (${labelExistsSql(graphName, kind, labelName)}) THEN
				PERFORM ag_catalog.${fn}('${escapedGraph}', '${escapedLabel}');
			END IF;
		END $$;
	`;
}

/**
 * @param {string} graphSchema
 * @param {string} labelName
 * @param {string} indexName
 */
function userIdIndexSql(graphSchema, labelName, indexName) {
	const schemaIdent = quoteIdent(graphSchema);
	const labelIdent = quoteIdent(labelName);
	const indexIdent = quoteIdent(indexName);
	return `
		CREATE INDEX IF NOT EXISTS ${indexIdent}
		ON ${schemaIdent}.${labelIdent}
		USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
	`;
}

/**
 * @param {string} graphSchema
 * @param {string} labelName
 * @param {string} indexName
 */
function userIdIdIndexSql(graphSchema, labelName, indexName) {
	const schemaIdent = quoteIdent(graphSchema);
	const labelIdent = quoteIdent(labelName);
	const indexIdent = quoteIdent(indexName);
	return `
		CREATE INDEX IF NOT EXISTS ${indexIdent}
		ON ${schemaIdent}.${labelIdent}
		USING btree (
			ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype),
			ag_catalog.agtype_access_operator(properties, '"id"'::agtype)
		);
	`;
}

/**
 * @param {string} graphName
 */
export function buildAgeGraphLabelsAndIndexesSql(graphName) {
	const graphSchema = graphName.trim();
	const parts = [];

	for (const label of AGE_VERTEX_LABELS) {
		parts.push(createLabelSql(graphSchema, label, 'v'));
	}
	for (const label of AGE_EDGE_LABELS) {
		parts.push(createLabelSql(graphSchema, label, 'e'));
	}

	for (const label of AGE_VERTEX_LABELS) {
		const slug = label.toLowerCase();
		parts.push(userIdIndexSql(graphSchema, label, `${slug}_user_id_idx`));
		parts.push(userIdIdIndexSql(graphSchema, label, `${slug}_user_id_id_idx`));
	}
	for (const label of AGE_EDGE_LABELS) {
		const slug = label.toLowerCase();
		parts.push(userIdIndexSql(graphSchema, label, `${slug}_user_id_idx`));
	}

	return parts.join('\n');
}

/** @param {import('postgres').Sql} sql @param {string} graphName */
export async function ensureAgeGraphLabelsAndIndexes(sql, graphName) {
	await sql.unsafe(`LOAD 'age'`);
	await sql.unsafe(`SET search_path = public, ag_catalog, "$user"`);
	await sql.unsafe(buildAgeGraphLabelsAndIndexesSql(graphName));
}
