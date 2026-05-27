# Nimbus demo backend image.
#
# IMPORTANT — build context: this Dockerfile MUST be built with the build
# context rooted at the PARENT of the edge-reco repo (i.e. ~/dev/oss), because
# the engine depends on TWO sibling repos via uv local path sources:
#   edge-reco/pyproject.toml      -> edge-proc          = ../edgeproc
#   edgeproc/pyproject.toml       -> shared-libs-python = ../shared-libs-python
# A context rooted inside edge-reco cannot COPY those siblings. docker-compose.yml
# sets `build.context: ../../..` so all three repos land side-by-side here.
#
# Layout reconstructed inside the image (preserves the ../ relative sources):
#   /workspace/edge-reco
#   /workspace/edgeproc
#   /workspace/shared-libs-python

FROM python:3.13-slim AS base

# uv: fast, reproducible Python installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

# Copy all three sibling repos, preserving the relative directory structure the
# uv local sources (`../edgeproc`, `../shared-libs-python`) expect.
#
# NOTE: the build context is ~/dev/oss (outside this repo), so there is no
# .dockerignore at the context root to exclude host artifacts. We therefore
# scrub host-built virtualenvs, caches and the frontend's node_modules AFTER
# copy — host .venv dirs are Linux-incompatible and would break `uv sync`, and
# node_modules/.git just bloat the image. (The backend image needs none of them.)
COPY edgeproc/ ./edgeproc/
COPY shared-libs-python/ ./shared-libs-python/
COPY edge-reco/ ./edge-reco/

RUN find . \( -name '.venv' -o -name '__pycache__' -o -name '.git' \
        -o -name 'node_modules' -o -name '.pytest_cache' -o -name '.mypy_cache' \) \
        -prune -exec rm -rf {} + 2>/dev/null || true

WORKDIR /workspace/edge-reco

# Install the engine + its sibling deps (edge-proc[localvec] pulled in via the
# pyproject local source). --no-dev: demo runtime doesn't need test/lint tools.
RUN uv sync --no-dev

# Demo runtime wiring: bind all interfaces (containerised) and allow the
# frontend's served origin through CORS. Overridable via compose env.
ENV DEMO_HOST=0.0.0.0 \
    DEMO_PORT=8000 \
    DEMO_CORS_ORIGINS=http://localhost:5173

EXPOSE 8000

# Use the launcher (NOT bare uvicorn) — the index build calls asyncio.run() at
# import time, which the launcher handles before any event loop exists.
CMD ["uv", "run", "python", "-m", "demo.backend.serve"]
