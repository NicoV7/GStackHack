#!/usr/bin/env bash
# Quick start: run GBrain MCP server
# Requires: bun and the official gbrain source checkout.

set -e

GBRAIN_ROOT="${GBRAIN_ROOT:-/opt/gbrain}"
GBRAIN_CLI="${GBRAIN_CLI:-${GBRAIN_ROOT}/src/cli.ts}"
GBRAIN_PERSIST_DIR="${GBRAIN_PERSIST_DIR:-}"
GBRAIN_SYNC_INTERVAL_SECONDS="${GBRAIN_SYNC_INTERVAL_SECONDS:-30}"

run_gbrain() {
  if command -v gbrain >/dev/null 2>&1; then
    gbrain "$@"
  else
    bun "$GBRAIN_CLI" "$@"
  fi
}

restore_brain() {
  if [ -z "$GBRAIN_PERSIST_DIR" ] || [ ! -d "$GBRAIN_PERSIST_DIR" ]; then
    return
  fi

  if [ -f "$GBRAIN_PERSIST_DIR/config.json" ] && [ -f "$GBRAIN_PERSIST_DIR/brain.pglite/PG_VERSION" ] && [ ! -f "$HOME/.gbrain/config.json" ]; then
    echo "Restoring GBrain from ${GBRAIN_PERSIST_DIR}..."
    mkdir -p "$HOME/.gbrain"
    cp -a "$GBRAIN_PERSIST_DIR/." "$HOME/.gbrain/"
  fi
}

sync_brain() {
  if [ -z "$GBRAIN_PERSIST_DIR" ] || [ ! -d "$GBRAIN_PERSIST_DIR" ] || [ ! -d "$HOME/.gbrain" ]; then
    return
  fi

  mkdir -p "$GBRAIN_PERSIST_DIR"
  cp -a "$HOME/.gbrain/." "$GBRAIN_PERSIST_DIR/"
}

restore_brain

# Initialize brain if not exists. Azure Files creates the mount directory even
# when it is empty, so checking only for the directory is not sufficient.
if [ ! -f "$HOME/.gbrain/config.json" ] || [ ! -d "$HOME/.gbrain/brain.pglite" ]; then
  echo "Initializing GBrain..."
  run_gbrain init --pglite
fi

sync_brain
if [ -n "$GBRAIN_PERSIST_DIR" ] && [ -d "$GBRAIN_PERSIST_DIR" ]; then
  (
    while true; do
      sleep "$GBRAIN_SYNC_INTERVAL_SECONDS"
      sync_brain || true
    done
  ) &
fi

PORT="${PORT:-4100}"

echo "Starting GBrain MCP server on port ${PORT}..."
exec bun "$GBRAIN_CLI" serve --http --port "$PORT"
