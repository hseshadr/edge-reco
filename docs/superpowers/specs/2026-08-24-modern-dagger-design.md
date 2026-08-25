# EdgeReco Modern Dagger Design

## TL;DR

EdgeReco has one native Dagger v0.21.8 graph that owns repository-authored CI, security analysis, artifact construction, Cloudflare Pages deployment, and live verification. GitHub Actions is a thin, SHA-pinned trigger. GitHub CodeQL Default Setup remains enabled only as the safe shadow authority until hosted Dagger SARIF is proven green.

## Why

The current CI behavior is correct but repeated across 503 lines of CI, parity, and security workflow YAML. Setup order also differs between local and hosted runs: a fresh `make gate` fails until the MiniLM model is downloaded, while hosted CI supplies that prerequisite in a separate step. Dagger should make the complete execution graph explicit, portable, cached, and locally runnable without inventing a controller framework.

## Architecture

The root `dagger.json` pins engine v0.21.8 and points to a Python module under `.dagger/`. Its explicit alternate constructor accepts a typed `Workspace` and stores the selected root as a typed `Directory`; repository code never reaches for an ambient workspace. The module composes pinned `Container` images, shares dependency/model state through `CacheVolume`, and uses a `Service` for the production-preview browser check.

Every public validation is an argument-free `@check`:

- `backend-quality`: `uv run poe gate`
- `frontend-quality`: model prefetch, `pnpm gate:quality`, relevance freshness, and the production i18n drive
- `browser-e2e`: `pnpm gate:e2e`
- `parity`: regenerate and compare all five Python/browser fixtures
- `backend-audit`: `uv run poe audit`, with no suppressions
- `frontend-audit`: `pnpm audit`, with no suppressions
- `workflow-security`: actionlint over the committed workflows
- `secret-scan`: a detector canary, the exact snapshot, and complete canonical Git history
- `codeql`: official JavaScript/TypeScript and Python CodeQL bundle analysis with validated SARIF 2.1.0

`dagger check` discovers these checks and runs them concurrently. Shared container prefixes ensure Python sync, pnpm install, model download, and browser preparation are content-addressed once instead of repeated by YAML jobs.

## GitHub boundary

`.github/workflows/dagger.yml` checks out full history without persisted credentials and invokes only the pinned Dagger action at v0.21.8. Its single unprivileged job is explicitly named `Dagger`, giving branch protection one stable context. `.github/workflows/deploy.yml` is separately privileged and likewise performs only checkout plus a typed Dagger deploy call.

After the shadow head passes both implementations:

1. Replace the legacy required contexts with `Dagger` while retaining `CodeQL`.
2. Delete `ci.yml`, `parity-fixtures.yml`, and `security-audit.yml` in the same rollout.
3. Keep the weekly schedule on `dagger.yml`, so audits and full parity remain recurring checks.
4. Keep `deploy.yml` pointed at successful same-repository Dagger push runs. Dagger itself owns exact-main resolution, typed artifact construction, Wrangler upload, Pages metadata verification, live identity, canonical redirect, and zero-egress browser proof.

## Contracts

- Dagger engine: exactly `v0.21.8`.
- Python: pinned 3.13 image and `uv`; exact registry reinstall of `assay-engine==0.5.0.dev3` after sync.
- Node: exactly `24.16.0`; pnpm exactly `11.5.0`.
- Browser: Playwright exactly `1.62.1` with Chromium.
- No package publication and no registry writes.
- No Dagger controller, adapter layer, service locator, or speculative ABI.
- Module implementation target: 100–200 handwritten Python lines.
- GitHub Dagger trigger target: 15–30 lines.
- CodeQL Default Setup stays enabled until hosted Dagger SARIF is shadow-green; only then may its equivalent Dagger upload replace it.
- Cloudflare and GitHub tokens are typed `Secret` inputs confined to the deploy function and are never CLI arguments.

## Failure behavior

Container exit codes fail their check directly. Fixture generation occurs only inside immutable Dagger snapshots; comparison failures name the existing comparator path. Audits retain zero suppressions. The production preview is a Dagger `Service`, so readiness is dependency-driven rather than a background process and arbitrary sleep loop.

## Verification

The rollout proves:

- RED: no required checks are discoverable before the module exists.
- GREEN: required checks are listed and each focused check passes.
- Full local `dagger check` matches all hosted contexts.
- Shadow PR runs both legacy and Dagger gates on the exact same commit.
- After migration, the final PR head is protected by `Dagger` plus `CodeQL`.
- Main deploys only after successful Dagger, and production still reports the exact merge SHA with clean headers, browser journeys, parity evidence, and zero external runtime egress.
