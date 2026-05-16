#!/usr/bin/env bash
# Quick start: run GBrain MCP server
# Requires: bun, gbrain installed globally

set -e

# Initialize brain if not exists
if [ ! -d "$HOME/.gbrain" ]; then
  echo "Initializing GBrain..."
  gbrain init --pglite
fi

echo "Starting GBrain MCP server on port 4100..."
exec gbrain serve --http --port 4100
