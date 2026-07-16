# Optional flywheel collector. Build with backend/ as the context; never expose
# the parent OSS workspace (or sibling repositories) to the Docker daemon.

FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_CACHE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Resolve the release-tagged edge-proc/shared-libs-python sources before copying
# application code, preserving Docker's dependency cache without local siblings.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen --no-install-project

COPY src/ src/
COPY demo_server/ demo_server/
COPY examples/keys/public.key examples/keys/public.key
RUN uv sync --no-dev --frozen

ENV DEMO_HOST=0.0.0.0 \
    DEMO_PORT=8000 \
    DEMO_CORS_ORIGINS=http://localhost:5174

EXPOSE 8000

CMD ["python", "-m", "demo_server.serve"]
