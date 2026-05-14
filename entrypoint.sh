#!/bin/sh
set -e

echo "Starting application..."
exec node build/index.js
