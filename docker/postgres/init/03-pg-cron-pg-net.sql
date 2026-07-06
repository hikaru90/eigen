-- Requires shared_preload_libraries=pg_cron,pg_net (see docker-compose db command).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Documented in docker-compose: postgres must start with -c pg_net.database_name=eigen
-- (same database as cron.database_name) or net.http_request_queue never drains.
