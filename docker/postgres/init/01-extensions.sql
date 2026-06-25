CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM ag_catalog.ag_graph
		WHERE name = 'eigen_graph'
	) THEN
		PERFORM ag_catalog.create_graph('eigen_graph');
	END IF;
END $$;

-- agtype lives in ag_catalog; required for cypher() AS (col agtype) on new connections.
-- public MUST precede ag_catalog so unqualified CREATE TABLE lands in public,
-- not in ag_catalog where AGE's internal label tables live.
DO $$
DECLARE
	dbname text := current_database();
BEGIN
	EXECUTE format(
		'ALTER DATABASE %I SET search_path TO public, ag_catalog, "$user"',
		dbname
	);
END $$;
