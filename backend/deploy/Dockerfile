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

# The query encoder's model. edge-proc >=0.4.0 never downloads it implicitly, and
# this server fetches all-MiniLM-L6-v2 from Hugging Face on first boot, as it always
# has, so it opts in explicitly. That fetch is NOT pinned to a model commit; why, and
# how to run with a pinned local model (EDGEPROC_MODEL_PATH + EDGEPROC_MODEL_DIGEST)
# instead, is in docs/DEPLOY.md#the-server-images-and-the-embedding-model. The
# shopper's browser tier self-hosts its own sha256-pinned weights and never reads this.
ENV EDGEPROC_ALLOW_MODEL_DOWNLOAD=1

WORKDIR /app
RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
COPY src/ src/
RUN uv sync --no-dev --frozen

# avow (through 0.4.1) ships its own older `assay/` package, and both it and
# assay-engine write site-packages/assay/, so the sync above can leave avow's copy on
# top and `edgereco.reco.formula` fails to import. Reinstall ONLY assay-engine, from
# the lock (hash-checked), as the last sync. Mirrors the Dagger ASSAY_INSTALL step.
RUN uv sync --no-dev --frozen --reinstall-package assay-engine

# The demo catalog's committed PUBLIC verify key (examples/keys/public.key) — the
# same trust root that signed examples/catalog. Verification stays fail-closed.
COPY examples/keys/public.key keys/public.key
COPY deploy/entrypoint.sh /usr/local/bin/edgereco-entrypoint
RUN chmod +x /usr/local/bin/edgereco-entrypoint

EXPOSE 8000
ENTRYPOINT ["edgereco-entrypoint"]
