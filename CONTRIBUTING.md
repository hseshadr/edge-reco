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
