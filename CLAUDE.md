# EdgeReco

Python-first local product discovery engine. Edge syncs a catalog, builds local indexes, runs hybrid search + session-aware rerank — zero backend calls after sync. OSS reference architecture.

## Status
Python v1 shipped on `main`: full FastAPI runtime + signed-bundle sync + hybrid
search + session-aware reranker, 90%+ coverage. The Nimbus demo is **backend-free**:
the React SPA syncs the signed bundle into OPFS and runs the whole engine in the
browser via the `@edgeproc/browser` workspace package (`frontend/packages/edgeproc-browser/`),
parity-tested against the Python core. The FastAPI runtime remains available for
the optional server-side API use case but is not in the default demo path. The
**flywheel is closed end-to-end**: clicks → in-tab uplink → mimicked-cloud
collector → `edgereco retrain` (recompute popularity, re-sign, republish the
bundle) → both tiers re-sync the new ranking. See `poe demo-flywheel` +
`poe demo-retrain`.

## Docs
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current architecture, embeds d2 diagrams
- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — clone → backend gate → frontend test → run demo
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — backend-free vs edge-origin deployment patterns
- [`docs/diagrams/`](docs/diagrams/) — d2 sources + rendered SVGs
- [`docs/archive/`](docs/archive/) — historical phase docs

## Stack
Python 3.13 · Pydantic v2 · Polars · FAISS · sentence-transformers · FastAPI · Typer · pytest-bdd · uv · Ruff · mypy strict · Docker Compose (origin + Caddy edge + app)

## Layout
- `backend/` — Python project root (pyproject.toml + uv.lock + .venv live here)
  - `backend/src/edgereco/` — catalog · embeddings · search · reco · telemetry · api · edge · cli · config
  - `backend/tests/` — unit · bdd · integration · e2e
  - `backend/features/` — Gherkin feature files, **decoupled** from step implementations
  - `backend/examples/catalog/` — committed signed 720-product **real Amazon** catalog bundle (balanced across 12 categories); built from `examples/source/catalog.csv` via `build-catalog` → `index` → `bundle`
  - `backend/examples/keys/` — `public.key` (pinned, committed) + `private.key` (gitignored)
  - `backend/deploy/` — Dockerfile · docker-compose.yml · Caddy config
  - `backend/demo_server/` — optional FastAPI API-server launcher (not in main test path)
  - `backend/scripts/` — fixture generators for browser-tier parity tests
- `frontend/` — npm workspace root
  - `frontend/app/` — the Nimbus React storefront (Vite + TS)
  - `frontend/packages/edgeproc-browser/` — `@edgeproc/browser`, the in-browser tier (signed-bundle sync + OPFS + transformers.js embedder + hybrid search engine); parity-tested against the Python core
- `docs/` — ARCHITECTURE / QUICKSTART / DEPLOY / diagrams / archive (no `legacy/`)

## Invariants (don't break without updating the spec)
- **Scoring formula**: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- **Hybrid search**: BM25 + FAISS vector + Reciprocal Rank Fusion
- **Catalog sync**: signed, content-addressed bundle (`latest` → `manifest/<hash>` → `chunk/<hash>`), Ed25519-verified fail-closed; Caddy edge cache. Bundle ships the prebuilt FAISS `vector/` (zero recompute on the edge).
- **Architecture**: all-Pydantic models throughout v1 (wire/domain split is a future concern); Protocol-based DI for infrastructure
- **Zero backend calls after sync** — runtime is offline-capable
- **Uplink optional & off the inference path** — the flywheel uplink (clicks → batched beacon → `/events`) is gated by `VITE_EVENTS_URL` (unset = disabled), fire-and-forget, and never blocks/breaks the app or gates the in-tab rail re-rank
- **Retrain moves data, not the formula** — the cloud retrain (`edgereco retrain`: `/events/export` → recompute `popularity_score` → re-sign + republish) must only change popularity values, never the scoring weights, so both tiers re-rank on sync with no code change. Reuses the prebuilt FAISS `vector/` verbatim. Republishes to a runtime origin (`.demo-origin`), leaving the committed seed bundle + browser parity fixture byte-stable

## Workflow
- **Spec-first**: brainstorm → spec → plan → subagent implementation (see `superpowers:*` skills)
- **TDD**: failing test before implementation — `superpowers:test-driven-development`
- **BDD**: Gherkin in `backend/features/`, steps in `backend/tests/bdd/` — never coupled
- **Coverage target**: ≥90% lines
- Solo dev — merge locally, no PRs required

## Quality entry points
- Inline quality gate → `python-quality` skill
- Publish-readiness grade → `northstar` agent
- Security scan → `aikido:scan` skill
- Code review → `pr-review-toolkit:code-reviewer`
- Docs↔code drift → `docs-sync` skill (code is truth; docs follow)

## Diagrams (D2 + Tala)
- `direction: down`
- Pastel fills: `#e8f4f8` blue · `#f0e8f8` purple · `#e8f8e8` green · `#f8f0e8` orange · `#f8e8e8` red
- Render: `d2 --layout tala <in>.d2 <out>.svg`
