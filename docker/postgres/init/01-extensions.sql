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
