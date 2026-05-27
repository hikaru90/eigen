-- Requires shared_preload_libraries=pg_cron,pg_net (see docker-compose db command).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
