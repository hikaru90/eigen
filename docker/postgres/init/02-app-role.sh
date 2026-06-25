#!/bin/bash
set -euo pipefail

# Non-superuser role for the application. RLS is bypassed by PostgreSQL superusers,
# so the app must connect as eigen_app (see DATABASE_URL in .env.example).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eigen_app') THEN
    CREATE ROLE eigen_app LOGIN PASSWORD 'eigen_app';
  END IF;
END
\$\$;

GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO eigen_app;
GRANT USAGE ON SCHEMA public TO eigen_app;
GRANT USAGE ON SCHEMA ag_catalog TO eigen_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ag_catalog TO eigen_app;
GRANT USAGE ON SCHEMA eigen_graph TO eigen_app;
GRANT CREATE ON SCHEMA eigen_graph TO eigen_app;
GRANT ALL PRIVILEGES ON SCHEMA eigen_graph TO eigen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA eigen_graph TO eigen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eigen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eigen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA eigen_graph TO eigen_app;

ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eigen_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eigen_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA eigen_graph
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eigen_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA eigen_graph
  GRANT USAGE, SELECT ON SEQUENCES TO eigen_app;

ALTER ROLE eigen_app SET search_path TO public, ag_catalog, "$user";
EOSQL
