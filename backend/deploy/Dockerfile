FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    EDGERECO_CACHE_DIR=/data/cache \
    EDGERECO_INDEX_DIR=/data/index \
    EDGERECO_MANIFEST_URL=http://edge:8081/manifest.json \
    EDGERECO_FILE_BASE_URL=http://edge:8081

WORKDIR /app
RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
COPY src/ src/
RUN uv sync --no-dev --frozen

COPY deploy/entrypoint.sh /usr/local/bin/edgereco-entrypoint
RUN chmod +x /usr/local/bin/edgereco-entrypoint

EXPOSE 8000
ENTRYPOINT ["edgereco-entrypoint"]
