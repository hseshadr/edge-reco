# EdgeReco — Northstar Polish (Tier 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift EdgeReco from northstar grade B+ to A by burning down 15 punch-list items: docs polish (Tier 1), code-design tightening (Tier 2), and small craft fixes (Tier 3). No new features; no spec change.

**Architecture:** Apply each item as a small, self-contained commit on branch `polish/northstar-tier1-3`. TDD where behavior changes (T5, T10, T11, T12, T14). Pure refactors and deletes for the rest. After T16 the branch merges to `main` (solo-dev workflow).

**Tech Stack:** Python 3.13 · Pydantic v2 · FastAPI · Typer · pytest + pytest-bdd · Ruff · mypy strict · uv.

**Quality bar (must hold at every commit):**
- `uv run ruff check src tests` — clean
- `uv run mypy src` — clean (strict)
- `uv run pytest --cov=edgereco --cov-fail-under=90` — green

---

## Tier 1 — Public-face polish (docs only, no code)

### Task 1: Move legacy TS/WASM docs to `docs/legacy/`

**Files:**
- Move: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/TECH_SPEC.md`, `docs/MVP_ROADMAP.md` → `docs/legacy/`
- Move: `docs/specs/` → `docs/legacy/specs/`
- Move: `docs/plans/` → `docs/legacy/plans/`
- Move: `docs/diagrams/` → `docs/legacy/diagrams/`
- Create: `docs/legacy/README.md`
- Modify: `CLAUDE.md` (link line) and `README.md:94` if it references any moved file

- [ ] **Step 1: Move files via `git mv`**

```bash
mkdir -p docs/legacy
git mv docs/PRD.md docs/ARCHITECTURE.md docs/TECH_SPEC.md docs/MVP_ROADMAP.md docs/legacy/
git mv docs/specs docs/legacy/specs
git mv docs/plans docs/legacy/plans
git mv docs/diagrams docs/legacy/diagrams
```

- [ ] **Step 2: Create `docs/legacy/README.md`**

```markdown
# Legacy docs (pre-pivot)

These documents describe the **TS / WASM-in-browser** architecture that EdgeReco started with. They were superseded on 2026-04-24 by the Python v1 pivot.

**Authoritative spec for current code:** [`../superpowers/specs/edgereco-python-v1.md`](../superpowers/specs/edgereco-python-v1.md).

Kept for archaeological reference only — do not use them to reason about current behavior.
```

- [ ] **Step 3: Fix the legacy link in `CLAUDE.md` lines 11**

Old:
```markdown
- [`docs/PRD.md`](docs/PRD.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md), [`docs/MVP_ROADMAP.md`](docs/MVP_ROADMAP.md) — legacy (TS/WASM era, kept for reference)
```

New:
```markdown
- [`docs/legacy/`](docs/legacy/) — pre-pivot TS/WASM design (kept for reference)
```

- [ ] **Step 4: Verify nothing else in the repo links to moved paths**

```bash
grep -rn "docs/PRD\|docs/ARCHITECTURE\|docs/TECH_SPEC\|docs/MVP_ROADMAP\|docs/specs/\|docs/plans/\|docs/diagrams/" --include="*.md" --include="*.py" --include="*.yaml" --include="*.yml" --include="*.json" .
```
Expected: no matches outside `docs/legacy/` itself. Fix anything that surfaces.

- [ ] **Step 5: Commit**

```bash
git add -A docs/ CLAUDE.md
git commit -m "docs: move pre-pivot TS/WASM docs to docs/legacy/

A first-time visitor reading docs/ARCHITECTURE.md today gets a wrong
mental model. Park the pre-pivot artifacts under docs/legacy/ with a
README pointer to the authoritative Python v1 spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: README hook + CI/license badges + repo layout

**Files:** Modify `README.md`

- [ ] **Step 1: Insert hook line + badges immediately after `# EdgeReco`**

After line 1, prepend:

```markdown
> **Sync once. Run anywhere. Zero backend calls.**

[![CI](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml/badge.svg)](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)
```

- [ ] **Step 2: Add a "Repo layout" section just before the "License" section**

```markdown
## Repo layout

- `src/edgereco/` — runtime: `catalog/` `embeddings/` `search/` `reco/` `telemetry/` `api/` `edge/` `cli.py` `config.py`
- `features/` — Gherkin BDD specs, decoupled from step implementations
- `tests/` — `unit/` `bdd/` `integration/` `e2e/`
- `deploy/` — `Dockerfile`, `docker-compose.yml`, Caddy edge config
- `examples/catalog/` — synthetic 1000-product demo data + manifest
- `scripts/generate_demo_catalog.py` — deterministic demo catalog generator
- `docs/superpowers/` — current spec + plans
- `docs/legacy/` — pre-pivot TS/WASM design (archive only)
```

- [ ] **Step 3: Update license footer to link the file**

Change `MIT.` to `[MIT](LICENSE).` at the bottom.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): add tagline, badges, repo-layout section

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fix "10K" drift in CLAUDE.md + spec

**Files:**
- Modify: `CLAUDE.md:21`
- Modify: `docs/superpowers/specs/edgereco-python-v1.md` lines 20, 46, 53, 88, 232, 237

Reality (from `examples/catalog/manifest.json`): `catalog_id: "edgereco-demo"`, `rows: 1000`. The Amazon-CSV preprocessing path remains capable of handling ~10K — that is the *processable* upper bound, not what ships.

- [ ] **Step 1: Edit `CLAUDE.md:21`**

Old:
```markdown
- `examples/catalog/` — preprocessed Amazon product demo data (10K subset)
```
New:
```markdown
- `examples/catalog/` — synthetic 1000-product demo catalog (5 categories × 200; Amazon CSV processing available via `edgereco preprocess`)
```

- [ ] **Step 2: Edit spec line 20**

Old: `~10K products shipped, 1.4M processable`
New: `1000 synthetic products shipped, 1.4M Amazon CSV processable`

- [ ] **Step 3: Edit spec line 46**

Old: `Filter to 5 categories: Electronics, Clothing, Home & Kitchen, Sports, Books (~10K for demo)`
New: `Filter to 5 categories: Electronics, Clothing, Home & Kitchen, Sports, Books (~10K Amazon-derived; the shipped synthetic demo is 1000)`

- [ ] **Step 4: Edit spec line 53**

Old: `A preprocessed 10K-product subset in \`examples/catalog/\``
New: `A 1000-product synthetic catalog in \`examples/catalog/\` (`scripts/generate_demo_catalog.py`)`

- [ ] **Step 5: Edit spec line 88**

Old: `but is YAGNI for the 10K-product demo`
New: `but is YAGNI for the 1000-product demo`

- [ ] **Step 6: Edit spec lines 232/237 example**

Change `"catalog_id": "amazon-demo"` → `"catalog_id": "edgereco-demo"` and `"rows": 10000` → `"rows": 1000` to match the shipped manifest.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/edgereco-python-v1.md
git commit -m "docs: align spec/CLAUDE.md with shipped 1000-product synthetic demo

Reality: examples/catalog/manifest.json ships 1000 rows under
catalog_id=edgereco-demo. The 10K Amazon-derived path remains
processable via 'edgereco preprocess' but is not what ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add `CHANGELOG.md` and `CONTRIBUTING.md`

**Files:**
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-30

First public release. Python v1 reference architecture for edge-first product discovery.

### Added
- Manifest-based catalog sync with sha256 checksums (`edgereco sync`)
- BM25 keyword index (`rank-bm25`) and FAISS vector index (`sentence-transformers/all-MiniLM-L6-v2`)
- Reciprocal Rank Fusion hybrid search (`edgereco search`, `GET /search`)
- Session-aware reranker: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- Interaction event ingest (`POST /events`) with click / view / favorite / cart weights
- Recommendation endpoint with session signals (`GET /recommend`)
- Typer CLI: `sync`, `index`, `serve`, `search`, `preprocess`
- FastAPI app with Protocol-based DI for edge clients (HTTP + filesystem adapters)
- Synthetic 1000-product demo catalog (`scripts/generate_demo_catalog.py`)
- Docker Compose stack: origin + Caddy edge + app, with healthcheck-gated startup
- BDD test suite (5 Gherkin features), integration + e2e coverage, 98%+ line coverage
- GitHub Actions CI: ruff + mypy strict + pytest with 90% coverage gate
```

- [ ] **Step 2: Create `CONTRIBUTING.md`**

```markdown
# Contributing

Contributions are welcome. EdgeReco is small enough to read end-to-end in an afternoon — start with [`docs/superpowers/specs/edgereco-python-v1.md`](docs/superpowers/specs/edgereco-python-v1.md).

## Local setup

```bash
uv sync --group dev
```

## Quality gate (run before opening a PR)

```bash
uv run ruff check src tests
uv run mypy src
uv run pytest --cov=edgereco --cov-fail-under=90
```

All three must pass. The CI workflow (`.github/workflows/ci.yml`) runs the same commands.

## Test layout

- `tests/unit/` — fast, isolated unit tests
- `tests/bdd/` — pytest-bdd step impls (features live in `features/`, decoupled by design)
- `tests/integration/` — FastAPI `TestClient` + CLI integration
- `tests/e2e/` — full sync → index → search → events → recommend loops

New behavior: write the failing test first, then the smallest implementation that turns it green.

## Invariants

The scoring formula and interaction weights are spec-locked — see `docs/superpowers/specs/edgereco-python-v1.md` §5. Changes there require a spec PR alongside the code change.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CONTRIBUTING.md
git commit -m "docs: add CHANGELOG.md (v0.1.0) and CONTRIBUTING.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Tier 2 — Code-design tightening

### Task 5: Tighten `InteractionEvent.event_type` to `Literal[...]` + drop signals fallback

**Files:**
- Modify: `src/edgereco/catalog/models.py:73-79`
- Modify: `src/edgereco/reco/signals.py:20-25`
- Add test: `tests/integration/test_events_validation.py`
- Possibly modify: `tests/unit/reco/test_signals.py` (if it exercises the unknown-type fallback path)

**Behavior change:** Today an event with `event_type: "unknown"` returns 200 and silently uses `view` weights. After: returns 422 at the Pydantic boundary.

- [ ] **Step 1: Write the failing test**

`tests/integration/test_events_validation.py`:

```python
"""POST /events rejects unknown event_type values at the Pydantic boundary."""
from __future__ import annotations

from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.models import Product


def _client() -> TestClient:
    products = [Product(id="p1", title="t", category="c")]
    return TestClient(create_app(ServiceContainer.from_catalog(products)))


def test_unknown_event_type_is_rejected_with_422() -> None:
    client = _client()
    resp = client.post(
        "/events",
        json={
            "events": [
                {"event_type": "tap", "product_id": "p1", "timestamp": "2026-01-01T00:00:00Z"}
            ]
        },
    )
    assert resp.status_code == 422


def test_known_event_types_accepted() -> None:
    client = _client()
    for kind in ("click", "view", "favorite", "cart"):
        resp = client.post(
            "/events",
            json={
                "events": [
                    {"event_type": kind, "product_id": "p1", "timestamp": "2026-01-01T00:00:00Z"}
                ]
            },
        )
        assert resp.status_code == 200, f"{kind}: {resp.json()}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/integration/test_events_validation.py -v
```
Expected: `test_unknown_event_type_is_rejected_with_422` FAILS (returns 200).

- [ ] **Step 3: Tighten the type in `catalog/models.py`**

Add `from typing import Literal` near the top (or import line), then replace the class body:

```python
EventType = Literal["click", "view", "favorite", "cart"]


class InteractionEvent(BaseModel):
    """A user interaction event."""

    event_type: EventType
    product_id: str
    timestamp: str
    metadata: dict[str, str] = {}
```

- [ ] **Step 4: Drop the silent fallback in `reco/signals.py:20-25`**

Old:
```python
def apply_interaction(
    profile: SessionProfile,
    product: Product,
    event_type: str,
) -> SessionProfile:
    weights = INTERACTION_WEIGHTS.get(event_type, INTERACTION_WEIGHTS["view"])
```
New:
```python
from edgereco.catalog.models import EventType, Product, SessionProfile  # update existing import

def apply_interaction(
    profile: SessionProfile,
    product: Product,
    event_type: EventType,
) -> SessionProfile:
    weights = INTERACTION_WEIGHTS[event_type]
```

(Also retype the dict to `dict[EventType, dict[str, float]]` for full strictness.)

- [ ] **Step 5: Run targeted tests + full suite**

```bash
uv run pytest tests/integration/test_events_validation.py tests/unit/reco -v
uv run pytest --cov=edgereco --cov-fail-under=90 -q
uv run mypy src
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/edgereco/catalog/models.py src/edgereco/reco/signals.py tests/integration/test_events_validation.py tests/unit/reco
git commit -m "refactor(types): event_type to Literal, drop silent 'view' fallback

Today POST /events with event_type='tap' returns 200 and silently
uses view weights. Tighten the type at the Pydantic boundary so the
API rejects unknown types with 422, and drop the dict.get fallback
in apply_interaction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Drop unused `Settings.embedding_dim`

**Files:**
- Modify: `src/edgereco/config.py:17`
- Modify: `tests/unit/test_config.py:9`

`Settings.embedding_dim` is referenced only in its own test. Encoder reads dim from the loaded model. Manifest carries it as data. The Settings field is dead.

- [ ] **Step 1: Remove the field**

In `src/edgereco/config.py` delete line 17 (`embedding_dim: int = 384`).

- [ ] **Step 2: Remove the test assertion**

In `tests/unit/test_config.py` delete line 9 (`assert settings.embedding_dim == 384`).

- [ ] **Step 3: Run gates**

```bash
uv run ruff check src tests && uv run mypy src && uv run pytest -q
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/edgereco/config.py tests/unit/test_config.py
git commit -m "refactor(config): drop unused Settings.embedding_dim

Field had no callers in src/. Encoder dim is read from the loaded
model; manifest carries dim as data. Removing the duplicate avoids
silent divergence if the embedding model ever changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Hoist `Container = Annotated[ServiceContainer, Depends]` alias

**Files:**
- Modify: `src/edgereco/api/deps.py` (add alias)
- Modify: `src/edgereco/api/routes/{search,recommend,events,catalog}.py` (use it)

- [ ] **Step 1: Add alias to `api/deps.py` (append)**

```python
from fastapi import Depends, Header, Request

# ... existing code ...

Container = Annotated[ServiceContainer, Depends(get_container)]
"""Pre-bound DI alias for routes."""
```

(`Depends` is already in scope via `fastapi`; if not, import it.)

- [ ] **Step 2: Update each route**

For each of `routes/search.py`, `routes/recommend.py`, `routes/events.py`, `routes/catalog.py`:

Replace:
```python
from edgereco.api.deps import ServiceContainer, get_container, get_session_id
# ...
container: Annotated[ServiceContainer, Depends(get_container)] = ...,  # type: ignore[assignment]
```

With:
```python
from edgereco.api.deps import Container, get_session_id
# ...
container: Container,
```

(For `catalog.py` which has no `get_session_id` import — drop only `ServiceContainer`/`get_container`.)

- [ ] **Step 3: Confirm no `# type: ignore[assignment]` remains in routes**

```bash
grep -n "type: ignore\[assignment\]" src/edgereco/api/routes/*.py
```
Expected: no output.

- [ ] **Step 4: Run gates**

```bash
uv run ruff check src tests && uv run mypy src && uv run pytest -q
```

- [ ] **Step 5: Commit**

```bash
git add src/edgereco/api
git commit -m "refactor(api): hoist Container DI alias, drop 4x type:ignore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Delete `DeltaFile` + `CatalogManifest.deltas`

**Files:**
- Modify: `src/edgereco/catalog/models.py` (remove `DeltaFile`, remove `deltas` field)
- Regenerate: `examples/catalog/manifest.json` (drop `"deltas": []`)
- Modify: any test fixture / spec mention referencing deltas

- [ ] **Step 1: Verify no real usage**

```bash
grep -rn "DeltaFile\|\.deltas" src tests scripts examples
```
Confirm only schema/fixture references — no code that produces or consumes deltas.

- [ ] **Step 2: Remove `DeltaFile` class and `CatalogManifest.deltas` field** in `src/edgereco/catalog/models.py:35-52`

Drop lines 35-42 (the `DeltaFile` class) and `deltas: list[DeltaFile] = []` from `CatalogManifest`.

- [ ] **Step 3: Regenerate the demo manifest**

```bash
uv run python scripts/generate_demo_catalog.py
```
Confirm `examples/catalog/manifest.json` no longer contains `"deltas"`.

- [ ] **Step 4: Update any test fixtures that reference `deltas`**

```bash
grep -rln "\"deltas\"\|deltas:" tests
```
Remove the key from any JSON fixture and any keyword arg from test data builders.

- [ ] **Step 5: Update spec section 2(3) "delta support"**

In `docs/superpowers/specs/edgereco-python-v1.md` section 2 (Goals), remove the delta-sync goal or mark it explicitly deferred:

> ~~3. Delta-sync support: incremental updates via versioned delta files between manifests.~~

Replace with:
> 3. (Deferred to v2) Delta-sync support — schema removed in v0.1; full re-sync only.

- [ ] **Step 6: Run full suite**

```bash
uv run ruff check src tests && uv run mypy src && uv run pytest -q
```

- [ ] **Step 7: Commit**

```bash
git add -A src tests examples docs scripts
git commit -m "refactor(catalog): remove unused DeltaFile schema

DeltaFile + CatalogManifest.deltas were declared but never produced
or consumed. Listed as a v1 goal in the spec but never implemented
- removing dead schema + flagging as deferred-to-v2 in the spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Delete `load_csv` + `examples/scripts/preprocess_amazon.py`

**Files:**
- Delete from: `src/edgereco/catalog/loader.py` (lines 22-30, plus the `import polars as pl` if it becomes unused)
- Delete: `examples/scripts/preprocess_amazon.py`
- Delete: `examples/scripts/__pycache__/`

- [ ] **Step 1: Verify zero callers**

```bash
grep -rn "load_csv\|preprocess_amazon" src tests scripts examples deploy
```
Expect only the definitions themselves.

- [ ] **Step 2: Remove `load_csv` from `loader.py:22-30`**

Resulting `loader.py` should contain only `load_jsonl`. The `import polars as pl` was inside the function — no module-level cleanup needed.

- [ ] **Step 3: Delete the example script**

```bash
git rm examples/scripts/preprocess_amazon.py
rm -rf examples/scripts/__pycache__
```

- [ ] **Step 4: If `examples/scripts/` is now empty, drop it; otherwise add a tiny README**

```bash
[ -z "$(ls -A examples/scripts 2>/dev/null)" ] && rmdir examples/scripts
```

- [ ] **Step 5: Run full suite**

```bash
uv run ruff check src tests && uv run mypy src && uv run pytest -q
```
Coverage should hold (`load_csv` had no test coverage to begin with).

- [ ] **Step 6: Commit**

```bash
git add -A src examples
git commit -m "chore: remove dead load_csv + duplicate preprocess_amazon.py

load_csv had no callers anywhere in the repo. examples/scripts/preprocess_amazon.py
duplicated 'edgereco preprocess'; the CLI is the canonical entry point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `/recommend` top-N pre-filter before rerank

**Files:**
- Modify: `src/edgereco/api/routes/recommend.py:21-25`
- Add test: `tests/unit/api/test_recommend_prefilter.py`

**Behavior preserved:** for any `limit ≤ N`, the top-`limit` results must be identical to the unfiltered version when the candidate pool is small. The pre-filter takes `limit * 5` candidates by `popularity_score` *before* rerank — this is a perf optimization, not a semantic change for typical limits.

- [ ] **Step 1: Write the failing test**

`tests/unit/api/test_recommend_prefilter.py`:

```python
"""/recommend pre-filters by popularity before rerank without changing top-N output."""
from __future__ import annotations

from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.models import Product


def _products(n: int) -> list[Product]:
    return [
        Product(id=f"p{i}", title=f"Product {i}", category="C", popularity_score=i / n)
        for i in range(n)
    ]


def test_recommend_top_n_stable_under_prefilter() -> None:
    client = TestClient(create_app(ServiceContainer.from_catalog(_products(50))))
    resp = client.get("/recommend?limit=5")
    assert resp.status_code == 200
    ids = [r["product"]["id"] for r in resp.json()["results"]]
    # Top 5 by popularity (no session signals) — descending popularity
    assert ids == [f"p{i}" for i in (49, 48, 47, 46, 45)]
```

- [ ] **Step 2: Run test to verify it passes today and will continue to pass**

```bash
uv run pytest tests/unit/api/test_recommend_prefilter.py -v
```
Expected: PASS (today's behavior already returns top-5 by popularity for an empty session).

- [ ] **Step 3: Refactor `recommend.py` to pre-filter**

Replace the current body:

```python
@router.get("/recommend")
def recommend(
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    session_id: Annotated[str, Depends(get_session_id)] = "",
    container: Container,
) -> dict[str, Any]:
    profile = container.sessions.get(session_id)

    pool_size = min(limit * 5, len(container.catalog))
    pool = sorted(
        container.catalog, key=lambda p: p.popularity_score, reverse=True
    )[:pool_size]

    candidates = [
        SearchResult(product=p, score=p.popularity_score) for p in pool
    ]
    ranked = rerank(candidates, profile)
    return {
        "results": [r.model_dump() for r in ranked[:limit]],
        "session_clicks": profile.click_count,
    }
```

(Note: depends on Task 7's `Container` alias — sequence T7 before T10.)

- [ ] **Step 4: Run gates + the new test + the full e2e**

```bash
uv run pytest tests/unit/api/test_recommend_prefilter.py tests/e2e -v
uv run pytest --cov=edgereco --cov-fail-under=90 -q
uv run mypy src
```

- [ ] **Step 5: Commit**

```bash
git add src/edgereco/api/routes/recommend.py tests/unit/api/test_recommend_prefilter.py
git commit -m "perf(recommend): pre-filter top (limit*5) by popularity before rerank

Today /recommend builds a SearchResult for every product in the
catalog on every call. Fine at 1k, problematic at 10k+. Pre-filter
to a popularity-sorted candidate pool of size limit*5 before the
session reranker runs - stable for typical limits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Tier 3 — Small craft

### Task 11: Cap `EventBuffer` with `deque(maxlen=10_000)`

**Files:**
- Modify: `src/edgereco/telemetry/buffer.py`
- Add test: `tests/unit/telemetry/test_buffer_cap.py`

- [ ] **Step 1: Write the failing test**

```python
"""EventBuffer drops oldest events past maxlen."""
from __future__ import annotations

from edgereco.catalog.models import InteractionEvent
from edgereco.telemetry.buffer import EventBuffer, EVENT_BUFFER_MAXLEN


def _ev(i: int) -> InteractionEvent:
    return InteractionEvent(event_type="view", product_id=f"p{i}", timestamp="t")


def test_buffer_caps_at_maxlen() -> None:
    buf = EventBuffer()
    for i in range(EVENT_BUFFER_MAXLEN + 5):
        buf.append(_ev(i))
    assert len(buf) == EVENT_BUFFER_MAXLEN
    # Oldest 5 dropped
    assert buf.all()[0].product_id == "p5"
    assert buf.all()[-1].product_id == f"p{EVENT_BUFFER_MAXLEN + 4}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/unit/telemetry/test_buffer_cap.py -v
```
Expected: FAIL (`EVENT_BUFFER_MAXLEN` undefined; current buffer is unbounded).

- [ ] **Step 3: Replace `buffer.py` body**

```python
"""Capped in-memory event buffer."""
from __future__ import annotations

from collections import deque
from typing import Deque

from edgereco.catalog.models import InteractionEvent

EVENT_BUFFER_MAXLEN = 10_000


class EventBuffer:
    """Thread-unsafe single-process ring buffer for interaction events."""

    def __init__(self, maxlen: int = EVENT_BUFFER_MAXLEN) -> None:
        self._events: Deque[InteractionEvent] = deque(maxlen=maxlen)

    def append(self, event: InteractionEvent) -> None:
        self._events.append(event)

    def all(self) -> list[InteractionEvent]:
        return list(self._events)

    def __len__(self) -> int:
        return len(self._events)
```

- [ ] **Step 4: Re-run the new test + full suite**

```bash
uv run pytest tests/unit/telemetry tests/integration -q
uv run mypy src
```

- [ ] **Step 5: Commit**

```bash
git add src/edgereco/telemetry/buffer.py tests/unit/telemetry/test_buffer_cap.py
git commit -m "feat(telemetry): cap EventBuffer at 10K events (ring buffer)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Fix `amazon_row_to_product` price-zero handling

**Files:**
- Modify: `src/edgereco/catalog/preprocessor.py:54`
- Add test: `tests/unit/catalog/test_preprocessor_price.py`

- [ ] **Step 1: Write the failing test**

```python
"""amazon_row_to_product treats None as missing price; preserves 0.0."""
from __future__ import annotations

from edgereco.catalog.preprocessor import amazon_row_to_product


def _row(price: object) -> dict[str, object]:
    return {
        "asin": "X1",
        "title": "t",
        "category_id": "Books",
        "stars": 4.0,
        "reviews": 10,
        "boughtInLastMonth": 1,
        "price": price,
    }


def _kwargs() -> dict[str, float]:
    return dict(pop_min=0.0, pop_max=10.0, fresh_min=0.0, fresh_max=10.0)


def test_zero_price_preserved() -> None:
    p = amazon_row_to_product(_row(0.0), **_kwargs())
    assert p.price == 0.0


def test_missing_price_is_none() -> None:
    row = _row(None)
    row["price"] = None
    p = amazon_row_to_product(row, **_kwargs())
    assert p.price is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/unit/catalog/test_preprocessor_price.py -v
```
Expected: `test_zero_price_preserved` FAILS — `0.0` is currently treated as missing.

- [ ] **Step 3: Replace the price line in `preprocessor.py:54`**

Old:
```python
        price=float(row["price"]) if row.get("price") else None,
```
New:
```python
        price=(float(row["price"]) if "price" in row and row["price"] is not None else None),
```

- [ ] **Step 4: Re-run + full suite**

```bash
uv run pytest tests/unit/catalog -q
```

- [ ] **Step 5: Commit**

```bash
git add src/edgereco/catalog/preprocessor.py tests/unit/catalog/test_preprocessor_price.py
git commit -m "fix(preprocessor): preserve 0.0 price (treat None as missing only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Replace lambda-with-defaults in `events.py:36` with named local fn

**Files:**
- Modify: `src/edgereco/api/routes/events.py`

- [ ] **Step 1: Replace the body of `post_events`**

Old:
```python
@router.post("/events")
def post_events(
    body: EventsBody,
    session_id: Annotated[str, Depends(get_session_id)] = "",
    container: Container,
) -> dict[str, Any]:
    for event in body.events:
        product = container.by_id.get(event.product_id)
        if product is None:
            logger.warning("unknown product_id in event: %s", event.product_id)
        else:
            container.sessions.update(
                session_id,
                lambda profile, p=product, et=event.event_type: apply_interaction(profile, p, et),  # type: ignore[misc]
            )
        container.events.append(event)
    return {"received": len(body.events)}
```

New:
```python
@router.post("/events")
def post_events(
    body: EventsBody,
    container: Container,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> dict[str, Any]:
    for event in body.events:
        product = container.by_id.get(event.product_id)
        if product is None:
            logger.warning("unknown product_id in event: %s", event.product_id)
        else:
            def _update(
                profile: SessionProfile,
                product: Product = product,
                event_type: EventType = event.event_type,
            ) -> SessionProfile:
                return apply_interaction(profile, product, event_type)

            container.sessions.update(session_id, _update)
        container.events.append(event)
    return {"received": len(body.events)}
```

Add the imports at the top: `from edgereco.catalog.models import EventType, InteractionEvent, Product, SessionProfile`.

- [ ] **Step 2: Confirm no `# type: ignore[misc]` left**

```bash
grep -n "type: ignore\[misc\]" src/edgereco/api/routes/events.py
```
Expected: empty.

- [ ] **Step 3: Run gates**

```bash
uv run ruff check src tests && uv run mypy src && uv run pytest -q
```

- [ ] **Step 4: Commit**

```bash
git add src/edgereco/api/routes/events.py
git commit -m "refactor(api/events): named-fn closure over lambda+defaults

Drops the # type: ignore[misc] dance; intent is clearer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: CLI `preprocess --category` repeatable option

**Files:**
- Modify: `src/edgereco/cli.py:198-263`
- Add test: `tests/integration/test_cli_preprocess_categories.py`

- [ ] **Step 1: Write the failing test**

```python
"""edgereco preprocess --category flag overrides the default 5-category set."""
from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from edgereco.cli import app


def _make_csv(tmp: Path) -> Path:
    src = tmp / "in.csv"
    src.write_text(
        "asin,title,category_id,stars,reviews,boughtInLastMonth,price,imgUrl,productURL\n"
        "A,bag,Luggage,4,10,1,9.99,,\n"
        "B,book,Books,5,20,2,12.0,,\n"
    )
    return src


def test_default_categories_drop_luggage(tmp_path: Path) -> None:
    out = tmp_path / "out"
    runner = CliRunner()
    result = runner.invoke(app, ["preprocess", str(_make_csv(tmp_path)), str(out)])
    assert result.exit_code == 0
    products = (out / "products.jsonl").read_text().strip().splitlines()
    ids = [json.loads(p)["id"] for p in products]
    assert ids == ["B"]


def test_custom_category_keeps_luggage(tmp_path: Path) -> None:
    out = tmp_path / "out"
    runner = CliRunner()
    result = runner.invoke(
        app,
        ["preprocess", str(_make_csv(tmp_path)), str(out), "--category", "Luggage"],
    )
    assert result.exit_code == 0
    products = (out / "products.jsonl").read_text().strip().splitlines()
    ids = [json.loads(p)["id"] for p in products]
    assert ids == ["A"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/integration/test_cli_preprocess_categories.py -v
```
Expected: `test_custom_category_keeps_luggage` FAILS — flag doesn't exist.

- [ ] **Step 3: Replace `preprocess` signature + filter**

In `src/edgereco/cli.py:198-263`:

```python
@app.command()
def preprocess(
    input_path: Annotated[Path, typer.Argument(help="Path to Amazon CSV")],
    output_dir: Annotated[Path, typer.Argument(help="Output directory")],
    limit: Annotated[int, typer.Option(help="Max products to output")] = 10000,
    category: Annotated[
        list[str] | None,
        typer.Option(
            "--category",
            help="Top-level category to keep (repeatable). "
            "Defaults to the 5 demo categories.",
        ),
    ] = None,
) -> None:
    """Convert Amazon CSV to EdgeReco JSONL + manifest."""
    import hashlib

    import polars as pl

    from edgereco.catalog.models import CatalogFile, CatalogManifest
    from edgereco.catalog.preprocessor import amazon_row_to_product

    target_categories = (
        set(category)
        if category
        else {"Electronics", "Clothing", "Home & Kitchen", "Sports", "Books"}
    )
    # ... rest unchanged ...
```

- [ ] **Step 4: Run gates**

```bash
uv run pytest tests/integration/test_cli_preprocess_categories.py tests/integration/test_cli.py -q
uv run ruff check src tests && uv run mypy src
```

- [ ] **Step 5: Commit**

```bash
git add src/edgereco/cli.py tests/integration/test_cli_preprocess_categories.py
git commit -m "feat(cli): preprocess --category repeatable, defaults to demo set

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Pick one `__init__.py` style (all empty)

**Files:**
- Modify: `src/edgereco/api/__init__.py` — drop `__all__` and the import that supports it
- Modify: `src/edgereco/telemetry/__init__.py` — same

The other 7 packages are empty `__init__.py`. Match.

- [ ] **Step 1: Replace `src/edgereco/api/__init__.py` with empty content**

```python
"""EdgeReco FastAPI application."""
```

- [ ] **Step 2: Replace `src/edgereco/telemetry/__init__.py` with empty content**

```python
"""Telemetry: interaction event buffer."""
```

- [ ] **Step 3: Find and update any `from edgereco.api import create_app` or `from edgereco.telemetry import EventBuffer`**

```bash
grep -rn "from edgereco.api import\|from edgereco.telemetry import" src tests scripts
```
Replace with the canonical sub-paths (e.g. `from edgereco.api.app import create_app`, `from edgereco.telemetry.buffer import EventBuffer`).

- [ ] **Step 4: Run gates**

```bash
uv run ruff check src tests && uv run mypy src && uv run pytest -q
```

- [ ] **Step 5: Commit**

```bash
git add -A src tests scripts
git commit -m "chore: empty __init__.py everywhere (consistency)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final

### Task 16: Full quality gate + finish branch

- [ ] **Step 1: Run the full gate one more time**

```bash
uv run ruff check src tests
uv run mypy src
uv run pytest --cov=edgereco --cov-fail-under=90 -q
```
All three must be green.

- [ ] **Step 2: Run inline quality skill**

Invoke `python-quality` via the Skill tool. Resolve any findings.

- [ ] **Step 3: Run security scan**

Invoke `aikido:scan` over the diff vs `main`. Resolve any findings.

- [ ] **Step 4: Run code review**

Dispatch `pr-review-toolkit:code-reviewer` against `git diff main...HEAD`. Resolve any blocking comments.

- [ ] **Step 5: Run docs-sync**

Invoke the `docs-sync` skill. Confirm zero drift.

- [ ] **Step 6: Re-run northstar**

Dispatch the `northstar` agent for a fresh grade. Target: A.

- [ ] **Step 7: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to merge to `main` and push.

---

## Dependency / sequencing notes

- T7 (Container alias) **must precede** T10 and T13 (both reference `Container`).
- T5 (event_type Literal) **must precede** T13 (closure types use `EventType`).
- T8 (delete deltas) **regenerates** the demo manifest — run `scripts/generate_demo_catalog.py` after.
- T15 (empty `__init__.py`) might break imports elsewhere — Step 3 in T15 handles the sweep.
- T16 must run **last** and on a clean working tree.

## Out of scope

- New API endpoints, new search backends
- Spec changes beyond fixing drift (T3) and the deferred-deltas note (T8)
- Performance optimizations beyond T10
- Frontend / UI work (none in repo)
- Publishing to PyPI, tagging a v0.1.0 release (separate decision)
