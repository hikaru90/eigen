/**
 * Apache AGE graph schema grants for eigen_app (RLS runtime role).
 *
 * MERGE needs CREATE on the graph schema. Label/edge tables created after init
 * need ALTER DEFAULT PRIVILEGES ON TABLES (not only sequences).
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
