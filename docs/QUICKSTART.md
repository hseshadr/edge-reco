# Quickstart

Goal: clone the repo, gate both subprojects, then run the headline demo end-to-end. Ten minutes.

## Prereqs

- Python 3.13+
- [`uv`](https://docs.astral.sh/uv/) (`brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Node ≥ 22.12 (required by Vite 8)
- Docker (only for the headline demo)

The Python backend depends on two sibling repos via uv local sources: [`edge-proc`](https://github.com/hseshadr/edge-proc) and [`shared-libs-python`](https://github.com/hseshadr/shared-libs-python). Clone all three side-by-side:

```bash
~/dev/oss/
├── edge-reco/
├── edge-proc/
└── shared-libs-python/
```

## 1. Backend gate (Python)

```bash
cd backend
uv sync --group dev
uv run pytest --cov=edgereco --cov-fail-under=90    # full suite + coverage gate
uv run ruff format --check .
uv run ruff check .
uv run mypy src
```

If all four are green, the Python tier is healthy.

## 2. Frontend gate (pnpm workspaces)

```bash
cd ../frontend
pnpm install                                    # resolves the whole workspace
pnpm -r run lint                                # biome on app + package
pnpm -r run typecheck                           # tsc -b on both
pnpm -r run test                                # vitest on both
pnpm -F frontend run build                      # prove the workspace link resolves
```

The pnpm workspace is rooted at `frontend/`; the SPA lives in `frontend/app/` and the in-browser engine in `frontend/packages/edgeproc-browser/`.

## 3. Run the demo (backend-free, in-browser)

```bash
cd frontend
docker compose up --build
```

Then open <http://localhost:5173>. You should see the boot screen step through:

1. *Syncing the signed bundle* — pulled from the Caddy edge on `:8081`.
2. *Reassembling the index* — into OPFS.
3. *Loading the model* — transformers.js fetches `Xenova/all-MiniLM-L6-v2`.

Then the 728-product Amazon storefront. Click a few products: the "Recommended for you" rail re-ranks toward your taste, **no network round trip per click**. Stop `origin` + `edge` and reload: the bundle is in OPFS and the model is cached, so it keeps working offline.

## 4. Iterate on the SPA locally

Without rebuilding the full Docker stack:

```bash
cd frontend
make install     # one-time: pnpm workspace deps
make dev         # edge (docker) + Vite dev server (foreground)
```

`make dev` boots the Caddy edge in the background, then runs the Vite dev server on `:5173`. Ctrl-C tears the edge down. See `frontend/Makefile` for the full target list.

## 5. Index a fresh catalog

```bash
cd backend

# Scraped Amazon CSV → products.jsonl
uv run edgereco build-catalog ~/data/amazon.csv /tmp/staging/products.jsonl

# Build the FAISS index
uv run edgereco index /tmp/staging /tmp/staging

# Sign + publish a content-addressed bundle origin
uv run edgereco bundle /tmp/staging /tmp/origin examples/keys/private.key \
    --catalog-id my-catalog --version v1 --product-count <N>
```

Drop `/tmp/origin` behind any static HTTP server / CDN and point the SPA at it (`VITE_BUNDLE_BASE_URL` at build time).

## 6. Run as an API server (optional)

For server-side recommendations instead of in-browser:

```bash
cd backend
EDGERECO_BUNDLE_BASE_URL=/path/to/origin \
EDGERECO_VERIFY_KEY_PATH=examples/keys/public.key \
EDGERECO_BUNDLE_CACHE_DIR=/tmp/edge-cache \
    uv run edgereco serve /tmp/staging /tmp/staging --port 8000
```

Or use the alternative API-server launcher with the demo's CORS + browse route:

```bash
cd backend
uv run python -m demo_server.serve
```

That's the FastAPI variant of the same engine, on `:8000`.

## Next steps

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system context, request lifecycle, module map, parity contract.
- [`DEPLOY.md`](DEPLOY.md) — backend-free in-browser vs edge-origin API server.
- `frontend/README.md` — storefront walkthrough, screenshots, e2e tests.
