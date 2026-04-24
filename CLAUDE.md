# EdgeReco — Claude Code Guidelines

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Last Updated** | 2026-03-01 |

## Project Overview

EdgeReco is a browser-based recommendation engine. WASM inference runs on-device, artifacts distribute via CDN, and interaction events feed back to server-side training. See key documents below for full architecture.

## Key Documents

- [`docs/PRD.md`](docs/PRD.md) — Goals, user stories, success metrics
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Component design, data flows, failure handling
- [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md) — API contracts, storage schemas, event schemas, performance budgets
- [`docs/MVP_ROADMAP.md`](docs/MVP_ROADMAP.md) — Phased TDD task list with pipeline catalog and acceptance criteria

## Conventions

- **TDD/BDD** — Write failing tests first. Each pipeline step gets unit tests before implementation.
- **Pipeline-first** — The five pipelines in `MVP_ROADMAP.md` Section 3 define the system's runtime behavior. New code should map to a pipeline step.
- **TypeScript strict** — All packages use strict tsconfig. No `any` types.
- **Biome** — Linting and formatting. Run `biome check .` before committing.
- **Vitest** — Test runner for TypeScript. `describe`/`it` BDD syntax.
- **cargo test + wasm-pack test** — Test runner for Rust/WASM engine code.
- **Pure functions over side effects** — Pipeline steps that don't need I/O should be pure. This makes them trivially testable.
- **File naming** — Source files: kebab-case (`manifest-diff.ts`, not `manifestDiff.ts`). Folders: kebab-case matching package names.
- **Test naming** — Test files: `*.test.ts` co-located or in `__tests__/` directories (Vitest convention).

## Code Quality Standards

This project enforces industry-standard style guides with automated tooling:

| Language | Style Guide | Tooling |
|----------|------------|---------|
| TypeScript | [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) | Biome (lint + format), `tsc --noEmit` |
| Rust | [Official Rust Style Guide](https://doc.rust-lang.org/style-guide/) | `rustfmt`, `clippy --pedantic` |

**Enforcement agent**: Use the `code-quality-guardian` agent (Task tool, `subagent_type: "code-quality-guardian"`) after writing code to run a full quality check covering security, linting, type checking, tests, and style review.

**Key rules (quick reference):**

- **TS naming**: `camelCase` functions/vars, `PascalCase` types, `UPPER_SNAKE_CASE` constants, `kebab-case` files
- **Rust naming**: `snake_case` functions/vars/modules, `PascalCase` types/traits, `SCREAMING_SNAKE_CASE` constants
- **No `any`** in TypeScript — use `unknown` and narrow
- **No default exports** in TypeScript (unless framework-required)
- **Interface over type alias** for object shapes
- **Explicit return types** on exported functions
- **No `unwrap()`/`expect()` in Rust library code** — propagate with `?`
- **`thiserror`** for Rust library errors, `anyhow` only in binaries/tests
- **Clippy pedantic**: `#![warn(clippy::all, clippy::pedantic)]`
- **Function size**: TS target < 30 lines (max 50), Rust target < 40 lines (max 60)
- **No dynamic code evaluation** in TypeScript
- **No `unsafe`** in Rust unless benchmarked and documented with `// SAFETY:` comment

## Monorepo Layout

```
packages/sdk/              # EdgeReco class, Hybrid Router
packages/service-worker/   # SW lifecycle, Manifest Manager, Artifact Cache
packages/compute-worker/   # Compute Worker, SQLite integration
packages/storage/          # OPFS + IDB abstractions
packages/events/           # Event capture, queue, uplink
packages/shared/           # Shared types, constants, interfaces
crates/engine/             # Rust WASM engine
test-fixtures/             # Shared mock catalogs, manifests, WASM stubs
playwright/                # E2E test suites
```

## LLM-Assisted Development Note

When using Claude Code on this project, be aware of the **generation vs. comprehension asymmetry**: LLMs are significantly better at understanding and reviewing code than at generating large, correct implementations from scratch. Leverage this by:

- **Generating test files first** — Tests are smaller, more declarative, and easier to verify. Let TDD drive the implementation.
- **Implementing one pipeline step at a time** — Small, focused functions with clear type signatures are in the LLM sweet spot.
- **Using comprehension for review** — After generating code, ask Claude to review it against the TECH_SPEC contracts and ARCHITECTURE.md data flows.
- **Avoiding large-file generation** — Break implementations into small files per function/class. Don't ask for an entire package in one shot.

## Agent Parallelization

For complex tasks, decompose work into independent subtasks and run them as parallel agents using the Task tool. This prevents context window overflow and maximizes throughput.

**When to parallelize:**
- Implementing multiple independent pipeline steps
- Running tests + linting + type checking simultaneously
- Researching multiple files or components at once
- Writing tests and reviewing architecture docs in parallel

**When to serialize:**
- When one task's output feeds into another (e.g., test results inform implementation fixes)
- When tasks modify the same files
- When there is a true data dependency between steps

**Example — implementing a pipeline step:**
1. **Parallel**: Write test file (agent 1) + research existing types/interfaces (agent 2)
2. **Serial**: Implement the function (depends on test spec and type research)
3. **Parallel**: Run quality guardian (agent 3) + update docs (agent 4)

Aim for maximum concurrency — only serialize when there are true data dependencies.

## D2 Diagrams

Diagrams use D2 with the Tala layout engine. Style conventions:

- `direction: down`
- Pastel fills: `"#e8f4f8"` (blue), `"#f0e8f8"` (purple), `"#e8f8e8"` (green), `"#f8f0e8"` (orange), `"#f8e8e8"` (red)
- Labeled edges describing the relationship
- Render command: `d2 --layout tala <input>.d2 <output>.svg`
