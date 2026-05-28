# EdgeReco

Python-first local product discovery engine. Edge syncs a catalog, builds local indexes, runs hybrid search + session-aware rerank — zero backend calls after sync. OSS reference architecture.

## Status
Python v1 shipped on `main`: full FastAPI runtime + signed-bundle sync + hybrid
search + session-aware reranker, 90%+ coverage. The Nimbus demo is **backend-free**:
the React SPA syncs the signed bundle into OPFS and runs the whole engine in the
browser via the `@edgeproc/browser` workspace package (`demo/packages/edgeproc-browser/`),
parity-tested against the Python core. The FastAPI runtime remains available for
the optional server-side API use case but is not in the default demo path.

## Docs
- [`docs/superpowers/specs/edgereco-python-v1.md`](docs/superpowers/specs/edgereco-python-v1.md) — current spec (authoritative)
- [`docs/superpowers/plans/edgereco-python-v1.md`](docs/superpowers/plans/edgereco-python-v1.md) — 26-task execution plan
- [`docs/legacy/`](docs/legacy/) — pre-pivot TS/WASM design (kept for reference)

## Stack
Python 3.13 · Pydantic v2 · Polars · FAISS · sentence-transformers · FastAPI · Typer · pytest-bdd · uv · Ruff · mypy strict · Docker Compose (origin + Caddy edge + app)

## Layout (post-implementation)
- `src/edgereco/` — catalog · embeddings · search · reco · telemetry · api · edge · cli · config
- `features/` — Gherkin feature files, **decoupled** from step implementations
- `tests/` — unit · bdd · integration · e2e
- `deploy/` — Dockerfile · docker-compose.yml · Caddy config
- `examples/catalog/` — committed signed 728-product **real Amazon** catalog bundle (`latest` + `manifest/<hash>` + `chunk/<hash>`); built via `build-catalog` → `index` → `bundle`. Amazon CSV ingest also available via `edgereco preprocess`.
- `examples/keys/` — `public.key` (pinned verify key, committed) + `private.key` (gitignored)
- `demo/` — Nimbus React storefront (backend-free; syncs in-browser via `@edgeproc/browser`) + optional FastAPI API-server variant under `demo/backend/`
- `demo/packages/edgeproc-browser/` — `@edgeproc/browser`, the in-browser tier (signed-bundle sync + OPFS + transformers.js embedder + hybrid search engine); private npm workspace member, parity-tested against the Python core

## Invariants (don't break without updating the spec)
- **Scoring formula**: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- **Hybrid search**: BM25 + FAISS vector + Reciprocal Rank Fusion
- **Catalog sync**: signed, content-addressed bundle (`latest` → `manifest/<hash>` → `chunk/<hash>`), Ed25519-verified fail-closed; Caddy edge cache. Bundle ships the prebuilt FAISS `vector/` (zero recompute on the edge).
- **Architecture**: all-Pydantic models throughout v1 (wire/domain split is a future concern); Protocol-based DI for infrastructure
- **Zero backend calls after sync** — runtime is offline-capable

## Workflow
- **Spec-first**: brainstorm → spec → plan → subagent implementation (see `superpowers:*` skills)
- **TDD**: failing test before implementation — `superpowers:test-driven-development`
- **BDD**: Gherkin in `features/`, steps in `tests/bdd/` — never coupled
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
