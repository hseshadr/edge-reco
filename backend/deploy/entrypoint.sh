#!/usr/bin/env sh
set -e

mkdir -p "$EDGERECO_CACHE_DIR" "$EDGERECO_INDEX_DIR"

echo "[edgereco] syncing catalog from $EDGERECO_MANIFEST_URL"
uv run edgereco sync "$EDGERECO_MANIFEST_URL" "$EDGERECO_CACHE_DIR" --http \
    --file-base-url "$EDGERECO_FILE_BASE_URL"

echo "[edgereco] building indexes"
uv run edgereco index "$EDGERECO_CACHE_DIR" "$EDGERECO_INDEX_DIR"

echo "[edgereco] starting API server on 0.0.0.0:8000"
exec uv run edgereco serve "$EDGERECO_CACHE_DIR" "$EDGERECO_INDEX_DIR" \
    --host 0.0.0.0 --port 8000
