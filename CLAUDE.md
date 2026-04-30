# EdgeReco

Python-first local product discovery engine. Edge syncs a catalog, builds local indexes, runs hybrid search + session-aware rerank — zero backend calls after sync. OSS reference architecture.

## Status
Python v1 pivot — spec + plan approved, implementation on `python-v1-edge-discovery` branch. Main holds docs/scaffolding only. TS/WASM code from prior phases was removed in `a68a83a`.

## Docs
- [`docs/superpowers/specs/edgereco-python-v1.md`](docs/superpowers/specs/edgereco-python-v1.md) — current spec (authoritative)
- [`docs/superpowers/plans/edgereco-python-v1.md`](docs/superpowers/plans/edgereco-python-v1.md) — 26-task execution plan
- [`docs/PRD.md`](docs/PRD.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md), [`docs/MVP_ROADMAP.md`](docs/MVP_ROADMAP.md) — legacy (TS/WASM era, kept for reference)

## Stack
Python 3.13 · Pydantic v2 · Polars · FAISS · sentence-transformers · FastAPI · Typer · pytest-bdd · uv · Ruff · mypy strict · Docker Compose (origin + Caddy edge + app)

## Layout (post-implementation)
- `src/edgereco/` — catalog · embeddings · search · reco · telemetry · api · edge · cli · config
- `features/` — Gherkin feature files, **decoupled** from step implementations
- `tests/` — unit · bdd · integration · e2e
- `deploy/` — Dockerfile · docker-compose.yml · Caddy config
- `examples/catalog/` — preprocessed Amazon product demo data (10K subset)

## Invariants (don't break without updating the spec)
- **Scoring formula**: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- **Hybrid search**: BM25 + FAISS vector + Reciprocal Rank Fusion
- **Catalog sync**: manifest-based with checksums; Caddy edge cache
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
