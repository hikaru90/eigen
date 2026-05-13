#!/bin/sh
set -e

echo "Running database migrations..."
npx drizzle-kit push --force

echo "Applying RLS policies..."
node scripts/apply-rls.mjs

echo "Starting application..."
exec node build/index.js
