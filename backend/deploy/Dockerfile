FROM python:3.13-slim

# EDGERECO_BUNDLE_BASE_URL + EDGERECO_VERIFY_KEY_PATH switch `edgereco serve` into
# signed-bundle mode: it syncs the content-addressed bundle from the edge origin at
# boot and verifies every chunk against the pinned public key (fail-closed).
ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    EDGERECO_CACHE_DIR=/data/cache \
    EDGERECO_INDEX_DIR=/data/index \
    EDGERECO_BUNDLE_BASE_URL=http://edge:8081 \
    EDGERECO_VERIFY_KEY_PATH=/app/keys/public.key \
    EDGERECO_BUNDLE_CACHE_DIR=/data/bundle

WORKDIR /app
RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
COPY src/ src/
RUN uv sync --no-dev --frozen

# The demo catalog's committed PUBLIC verify key (examples/keys/public.key) — the
# same trust root that signed examples/catalog. Verification stays fail-closed.
COPY examples/keys/public.key keys/public.key
COPY deploy/entrypoint.sh /usr/local/bin/edgereco-entrypoint
RUN chmod +x /usr/local/bin/edgereco-entrypoint

EXPOSE 8000
ENTRYPOINT ["edgereco-entrypoint"]
