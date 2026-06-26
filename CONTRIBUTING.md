# Contributing

Contributions are welcome. EdgeReco is small enough to read end-to-end in an afternoon — start with the [README](README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

The scoring formula and interaction weights are spec-locked — see the scoring section of [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The weights ship as bundle-carried config (`ranking_config.json`), so retuning ranking is a data republish, not a code change; altering the formula itself requires updating the docs alongside the code.
