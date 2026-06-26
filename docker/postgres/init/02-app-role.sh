#!/bin/bash
set -euo pipefail

# Non-superuser role for the application. RLS is bypassed by PostgreSQL superusers,
# so the app must connect as eigen_app (see DATABASE_URL in .env.example).
APP_ROLE="${APP_DB_ROLE:-eigen_app}"
APP_PASSWORD="${EIGEN_APP_DB_PASSWORD:-eigen_app}"
GRAPH_NAME="${AGE_GRAPH_NAME:-eigen_graph}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
do \$\$
begin
  if not exists (select from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} login password '${APP_PASSWORD}';
  end if;
end
\$\$;

grant connect on database ${POSTGRES_DB} to ${APP_ROLE};
grant usage on schema public to ${APP_ROLE};
grant usage on schema ag_catalog to ${APP_ROLE};
grant execute on all functions in schema ag_catalog to ${APP_ROLE};
grant usage on schema ${GRAPH_NAME} to ${APP_ROLE};
grant create on schema ${GRAPH_NAME} to ${APP_ROLE};
grant all privileges on schema ${GRAPH_NAME} to ${APP_ROLE};
grant select, insert, update, delete on all tables in schema ${GRAPH_NAME} to ${APP_ROLE};
grant select, insert, update, delete on all tables in schema public to ${APP_ROLE};
grant usage, select on all sequences in schema public to ${APP_ROLE};
grant usage, select on all sequences in schema ${GRAPH_NAME} to ${APP_ROLE};

alter default privileges for role ${POSTGRES_USER} in schema public
  grant select, insert, update, delete on tables to ${APP_ROLE};
alter default privileges for role ${POSTGRES_USER} in schema public
  grant usage, select on sequences to ${APP_ROLE};
alter default privileges for role ${POSTGRES_USER} in schema ${GRAPH_NAME}
  grant select, insert, update, delete on tables to ${APP_ROLE};
alter default privileges for role ${POSTGRES_USER} in schema ${GRAPH_NAME}
  grant usage, select on sequences to ${APP_ROLE};

alter role ${APP_ROLE} set search_path to public, ag_catalog, "\$user";
EOSQL
