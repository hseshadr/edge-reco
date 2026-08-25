# EdgeReco Modern Dagger Design

## TL;DR

EdgeReco will have one native Dagger v0.21.8 check graph that runs the repository's existing Python, TypeScript, browser, parity, audit, and workflow-security commands. GitHub Actions will become a thin, SHA-pinned trigger. Cloudflare deployment and GitHub CodeQL remain independent authorities.

## Why

The current CI behavior is correct but repeated across 503 lines of CI, parity, and security workflow YAML. Setup order also differs between local and hosted runs: a fresh `make gate` fails until the MiniLM model is downloaded, while hosted CI supplies that prerequisite in a separate step. Dagger should make the complete execution graph explicit, portable, cached, and locally runnable without inventing a controller framework.

## Architecture

The root `dagger.json` pins engine v0.21.8 and points to a Python module under `.dagger/`. The module uses `dag.current_workspace()` as the v0.21.8 `Workspace` input, selects narrow `Directory` snapshots, composes pinned `Container` images, shares dependency/model state through `CacheVolume`, and uses a `Service` for the production-preview browser check.

Every public validation is an argument-free `@check`:

- `backend-quality`: `uv run poe gate`
- `frontend-quality`: model prefetch, `pnpm gate:quality`, relevance freshness, and the production i18n drive
- `browser-e2e`: `pnpm gate:e2e`
- `parity`: regenerate and compare all five Python/browser fixtures
- `backend-audit`: `uv run poe audit`, with no suppressions
- `frontend-audit`: `pnpm audit`, with no suppressions
- `workflow-security`: actionlint over the committed workflows

`dagger check` discovers these checks and runs them concurrently. Shared container prefixes ensure Python sync, pnpm install, model download, and browser preparation are content-addressed once instead of repeated by YAML jobs.

## GitHub boundary

During shadowing, `.github/workflows/dagger.yml` runs alongside all legacy required checks. It checks out full history, runs the existing pinned Gitleaks action, then invokes the pinned Dagger action at v0.21.8. Its single job is explicitly named `Dagger`, giving branch protection one stable context.

After the shadow head passes both implementations:

1. Replace the legacy required contexts with `Dagger` while retaining `CodeQL`.
2. Delete `ci.yml`, `parity-fixtures.yml`, and `security-audit.yml` in the same rollout.
3. Keep the weekly schedule on `dagger.yml`, so audits and full parity remain recurring checks.
4. Point `deploy.yml` at successful `Dagger` workflow runs and `dagger.yml`; retain its fork guard, exact-main resolution, credentials, Cloudflare deployment, and live identity verification unchanged.

## Contracts

- Dagger engine: exactly `v0.21.8`.
- Python: pinned 3.13 image and `uv`; exact registry reinstall of `assay-engine==0.5.0.dev3` after sync.
- Node: exactly `24.16.0`; pnpm exactly `11.5.0`.
- Browser: Playwright exactly `1.62.1` with Chromium.
- No package publication and no registry writes.
- No Dagger controller, adapter layer, service locator, or speculative ABI.
- Module implementation target: 100–200 handwritten Python lines.
- GitHub Dagger trigger target: 15–30 lines.
- CodeQL remains GitHub-managed; deploy secrets remain confined to the existing deployment authority.

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
