#!/usr/bin/env sh
set -e

mkdir -p "$EDGERECO_CACHE_DIR" "$EDGERECO_INDEX_DIR" "$EDGERECO_BUNDLE_CACHE_DIR"

# `edgereco serve` self-syncs: with EDGERECO_BUNDLE_BASE_URL + EDGERECO_VERIFY_KEY_PATH
# set (baked into the image), it pulls the signed, content-addressed bundle from the
# edge origin, verifies it against the pinned public key (fail-closed), and loads the
# prebuilt indexes — no separate sync/index step exists or is needed.
echo "[edgereco] starting API server on 0.0.0.0:8000 (bundle origin: $EDGERECO_BUNDLE_BASE_URL)"
exec uv run edgereco serve "$EDGERECO_CACHE_DIR" "$EDGERECO_INDEX_DIR" \
    --host 0.0.0.0 --port 8000
