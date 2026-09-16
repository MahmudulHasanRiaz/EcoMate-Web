#!/bin/sh
set -e

# Find server.js — monorepo standalone output nests it under apps/<name>/
SERVER_JS=$(find /app -name "server.js" -not -path "*/node_modules/*" 2>/dev/null | head -n 1)

if [ -z "$SERVER_JS" ]; then
  echo "[Startup] ERROR: server.js not found under /app"
  exit 1
fi

echo "[Startup] Found server.js at $SERVER_JS"
cd "$(dirname "$SERVER_JS")"
exec node server.js
