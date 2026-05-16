#!/usr/bin/env bash
# Quick start: run GBrain MCP server
# Requires: bun, gbrain installed globally

set -e

# Initialize brain if not exists
if [ ! -d "$HOME/.gbrain" ]; then
  echo "Initializing GBrain..."
  gbrain init --pglite
fi

PORT="${PORT:-4100}"
GBRAIN_BIN="${GBRAIN_BIN:-gbrain}"

echo "Starting GBrain MCP server on port ${PORT}..."
exec "$GBRAIN_BIN" serve --http --port "$PORT"
