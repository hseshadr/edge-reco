# VENDORED — `@edgeproc/errors`

This directory is a **vendored copy** of the `@edgeproc/errors` package — the
portfolio's canonical-errors standard library: register a per-app catalog of
stable error codes, classify raw transport failures into those codes, describe
them via your own i18next, and serialize to RFC 9457 Problem Details.
**Zero runtime dependencies.**

It was vendored so a fresh clone of this repo builds with `pnpm install` alone —
no sibling checkout, no npm publish, no extra credentials — exactly the way this
repo already vendors `@edgeproc/browser` at `packages/edgeproc-browser/`.

| | |
|---|---|
| Source repo | `hseshadr/errors` (`~/dev/oss/errors`) |
| Source path | repo root (`src/`, `test/`) |
| Vendored commit | `7705a72c938c0e0e18ae51c87f38820d31b8be6e` (`Initial @edgeproc/errors: canonical error glue (TDD)`) |
| Vendored on | 2026-07-14 |
| License | MIT (see `LICENSE`, copied verbatim from the source repo) |

## Why edge-reco is a reference consumer

edge-reco adopts `@edgeproc/errors` for the one user-facing failure the demo can
actually hit: the one-time signed-bundle catalog sync (download / integrity /
device-unsupported / timeout / network). The bundle-sync classification seam in
`app/src/api/syncErrors.ts` (`bundleErrorRegistry`) routes through this library's
registry instead of an ad-hoc `if`-chain. The mapping is
**behaviour-identical** — the same raw failure still produces the same coded
error and the same existing `errors.*` i18n string. See
`app/src/api/syncErrors.ts` and `app/src/api/syncErrors.test.ts`.

## What was copied / what wasn't

- **Copied byte-identical:** `src/**` (the library), `test/**` (its 56-test
  suite), `tsconfig.json`, `vitest.config.ts`, `biome.json`, `README.md`,
  `.gitignore`.
- **Not copied:** git history, `node_modules/`, `dist/`, `coverage/`, the source
  repo's `pnpm-lock.yaml` / `pnpm-workspace.yaml` (this repo has its own),
  `tsconfig.build.json` (no build step — see below), `CHANGELOG.md`,
  `examples/`, `.github/`.
- **Added here (not upstream):** `LICENSE` travels with the redistribution and
  this file.

## Local adaptations (the only diffs from upstream)

1. **`package.json`** — rewritten for this pnpm workspace, mirroring
   `@edgeproc/browser`:
   - `exports["."]` points at **`./src/index.ts`** (TypeScript source consumed
     directly by Vite/Vitest/`tsc`), so there is **no build step and no `dist/`**.
   - Kept `lint` / `typecheck` / `test` / `test:coverage` — all four run in the
     workspace gate (`pnpm -r run lint`, `pnpm -r run typecheck`,
     `pnpm -r run test:coverage`), so the vendored 56-test suite is part of the
     gate here.
   - Dropped upstream's `build` / `demo` / `gate` scripts and the
     `packageManager` / `engines` / `files` fields.
   - Pinned `typescript` / `@types/node` / `vitest` / `@biomejs/biome` /
     `@vitest/coverage-v8` to this workspace's versions so `pnpm install`
     resolves a single shared copy.
2. **No source diffs.** `src/**` and `test/**` are byte-identical to upstream;
   `tsconfig.json` (NodeNext, `noEmit`), `vitest.config.ts` and `biome.json` are
   unchanged.
