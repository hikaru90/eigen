#!/bin/bash
set -euo pipefail

GRAPH_NAME="${AGE_GRAPH_NAME:-eigen_graph}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;

DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM ag_catalog.ag_graph
    WHERE name = '${GRAPH_NAME}'
  ) THEN
    PERFORM ag_catalog.create_graph('${GRAPH_NAME}');
  END IF;
END
\$\$;

-- Eager vertex/edge labels + tenant-scoped btree indexes on user_id (and user_id,id for nodes).
DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'Thought' AND l.kind = 'v'
  ) THEN
    PERFORM ag_catalog.create_vlabel('${GRAPH_NAME}', 'Thought');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'Entity' AND l.kind = 'v'
  ) THEN
    PERFORM ag_catalog.create_vlabel('${GRAPH_NAME}', 'Entity');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'Event' AND l.kind = 'v'
  ) THEN
    PERFORM ag_catalog.create_vlabel('${GRAPH_NAME}', 'Event');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'RELATES_TO' AND l.kind = 'e'
  ) THEN
    PERFORM ag_catalog.create_elabel('${GRAPH_NAME}', 'RELATES_TO');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'MENTIONS' AND l.kind = 'e'
  ) THEN
    PERFORM ag_catalog.create_elabel('${GRAPH_NAME}', 'MENTIONS');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'ENTITY_RELATES' AND l.kind = 'e'
  ) THEN
    PERFORM ag_catalog.create_elabel('${GRAPH_NAME}', 'ENTITY_RELATES');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'OCCURS_IN' AND l.kind = 'e'
  ) THEN
    PERFORM ag_catalog.create_elabel('${GRAPH_NAME}', 'OCCURS_IN');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label l
    INNER JOIN ag_catalog.ag_graph g ON l.graph = g.graphid
    WHERE g.name = '${GRAPH_NAME}' AND l.name = 'INVOLVES' AND l.kind = 'e'
  ) THEN
    PERFORM ag_catalog.create_elabel('${GRAPH_NAME}', 'INVOLVES');
  END IF;
END
\$\$;

CREATE INDEX IF NOT EXISTS thought_user_id_idx
  ON ${GRAPH_NAME}."Thought"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS thought_user_id_id_idx
  ON ${GRAPH_NAME}."Thought"
  USING btree (
    ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype),
    ag_catalog.agtype_access_operator(properties, '"id"'::agtype)
  );
CREATE INDEX IF NOT EXISTS entity_user_id_idx
  ON ${GRAPH_NAME}."Entity"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS entity_user_id_id_idx
  ON ${GRAPH_NAME}."Entity"
  USING btree (
    ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype),
    ag_catalog.agtype_access_operator(properties, '"id"'::agtype)
  );
CREATE INDEX IF NOT EXISTS event_user_id_idx
  ON ${GRAPH_NAME}."Event"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS event_user_id_id_idx
  ON ${GRAPH_NAME}."Event"
  USING btree (
    ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype),
    ag_catalog.agtype_access_operator(properties, '"id"'::agtype)
  );
CREATE INDEX IF NOT EXISTS relates_to_user_id_idx
  ON ${GRAPH_NAME}."RELATES_TO"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS mentions_user_id_idx
  ON ${GRAPH_NAME}."MENTIONS"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS entity_relates_user_id_idx
  ON ${GRAPH_NAME}."ENTITY_RELATES"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS occurs_in_user_id_idx
  ON ${GRAPH_NAME}."OCCURS_IN"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));
CREATE INDEX IF NOT EXISTS involves_user_id_idx
  ON ${GRAPH_NAME}."INVOLVES"
  USING btree (ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype));

-- agtype lives in ag_catalog; required for cypher() AS (col agtype) on new connections.
-- public MUST precede ag_catalog so unqualified CREATE TABLE lands in public,
-- not in ag_catalog where AGE's internal label tables live.
DO \$\$
DECLARE
  dbname text := current_database();
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO public, ag_catalog, "\$user"',
    dbname
  );
END
\$\$;
EOSQL
