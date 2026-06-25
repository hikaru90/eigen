/**
 * Apache AGE graph schema grants for eigen_app (RLS runtime role).
 *
 * MERGE needs CREATE on the graph schema. Label/edge tables created after init
 * need ALTER DEFAULT PRIVILEGES ON TABLES (not only sequences).
 *
 * AGE also requires the executing role to *own* its internal label tables
 * (_ag_label_vertex, _ag_label_edge, …) — standard grants are not enough.
 */

export function quoteIdent(value) {
	return `"${String(value).replace(/"/g, '""')}"`;
}

/** @param {import('postgres').Sql} sql */
export async function ensureAgeGraphGrants(sql, input) {
	const ageGraph = input.ageGraph.trim();
	const owner = input.owner.trim();
	const graphSchema = quoteIdent(ageGraph);
	const ownerIdent = quoteIdent(owner);

	await sql.unsafe(`GRANT USAGE ON SCHEMA ag_catalog TO eigen_app`);
	await sql.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ag_catalog TO eigen_app`);
	await sql.unsafe(`GRANT USAGE ON SCHEMA ${graphSchema} TO eigen_app`);
	await sql.unsafe(`GRANT CREATE ON SCHEMA ${graphSchema} TO eigen_app`);
	await sql.unsafe(`GRANT ALL PRIVILEGES ON SCHEMA ${graphSchema} TO eigen_app`);
	await sql.unsafe(
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${graphSchema} TO eigen_app`
	);
	await sql.unsafe(
		`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${graphSchema} TO eigen_app`
	);
	await sql.unsafe(`
		ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA ${graphSchema}
		  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eigen_app
	`);
	await sql.unsafe(`
		ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA ${graphSchema}
		  GRANT USAGE, SELECT ON SEQUENCES TO eigen_app
	`);
}

/**
 * Transfer ownership of every table and sequence in the graph schema to appRole.
 *
 * AGE creates internal label tables (_ag_label_vertex, _ag_label_edge, …)
 * owned by whichever role called create_graph().  Standard GRANT is not
 * sufficient — AGE requires ownership for MERGE / CREATE cypher operations.
 *
 * This is idempotent: re-assigning ownership to the current owner is a no-op.
 *
 * @param {import('postgres').Sql} sql
 * @param {{ graphSchema: string, appRole: string }} input
 */
export async function transferGraphOwnership(sql, input) {
	const graphSchemaName = input.graphSchema.trim();
	const appRole = input.appRole.trim();
	const graphSchemaIdent = quoteIdent(graphSchemaName);
	const appRoleIdent = quoteIdent(appRole);

	// Transfer ownership of all tables in the graph schema.
	const tables = await sql.unsafe(`
		SELECT tablename
		FROM pg_tables
		WHERE schemaname = ${graphSchemaName}
	`);
	for (const { tablename } of tables) {
		await sql.unsafe(
			`ALTER TABLE ${graphSchemaIdent}.${quoteIdent(tablename)} OWNER TO ${appRoleIdent}`
		);
	}

	// Transfer ownership of all sequences in the graph schema.
	const sequences = await sql.unsafe(`
		SELECT sequencename
		FROM pg_sequences
		WHERE schemaname = ${graphSchemaName}
	`);
	for (const { sequencename } of sequences) {
		await sql.unsafe(
			`ALTER SEQUENCE ${graphSchemaIdent}.${quoteIdent(sequencename)} OWNER TO ${appRoleIdent}`
		);
	}

	// Transfer schema ownership so future objects are also owned by appRole.
	await sql.unsafe(`ALTER SCHEMA ${graphSchemaIdent} OWNER TO ${appRoleIdent}`);

	console.log(
		`[eigen] Graph ownership transferred: ${tables.length} table(s), ` +
			`${sequences.length} sequence(s) in ${graphSchemaName} → ${appRole}`
	);
}
