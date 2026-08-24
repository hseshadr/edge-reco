# EdgeReco Modern Dagger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated GitHub CI orchestration with a small native Dagger v0.21.8 check graph without changing EdgeReco's quality, security, deployment, or production contracts.

**Architecture:** A root Dagger module lazily selects workspace directories and composes the repository's existing commands in pinned containers. One SHA-pinned GitHub job runs Gitleaks and `dagger check`; Cloudflare deployment and CodeQL remain independent authorities.

**Tech Stack:** Dagger v0.21.8 Python SDK, Python 3.13, uv, Node 24.16.0, pnpm 11.5.0, Playwright 1.62.1, GitHub Actions, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-08-24-modern-dagger-design.md`

## Global Constraints

- Use RED → GREEN → refactor for every behavior change.
- Keep the Dagger module between 100 and 200 handwritten Python lines.
- Keep `.github/workflows/dagger.yml` between 15 and 30 lines.
- Use only native Dagger core composition; no controller, adapter framework, or service locator.
- Do not publish packages or write to registries.
- Do not weaken coverage, audits, parity tolerances, Gitleaks history, CodeQL, deploy guards, or live verification.

---

### Task 1: Scaffold the native module from an executable RED contract

**Files:**
- Create: `dagger.json`
- Create: `.dagger/pyproject.toml`
- Create: `.dagger/src/edge_reco/main.py`
- Create: `.dagger/uv.lock`

**Interfaces:**
- Consumes: the current checkout through `dag.current_workspace()`.
- Produces: discoverable `@check` functions named by the design spec.

- [ ] Run `dagger --silent check -l` and assert that each required check name is present.
- [ ] Record the expected failure because no Dagger module/checks exist.
- [ ] Scaffold the official Python SDK with `dagger init --sdk=python --source=.dagger --name=edge-reco .`.
- [ ] Pin `engineVersion` to `v0.21.8` and the module runtime to Python 3.13.
- [ ] Run `dagger check -l` and require all seven named checks.

### Task 2: Compose backend and parity checks

**Files:**
- Modify: `.dagger/src/edge_reco/main.py`

**Interfaces:**
- Consumes: `backend/` plus the five committed frontend parity fixtures.
- Produces: `backend-quality`, `backend-audit`, and `parity` checks.

- [ ] Add a shared Python container from the digest-pinned Python 3.13 image with an uv `CacheVolume`.
- [ ] Install pinned uv, copy the selected sources, run `uv sync --group dev`, and reinstall exact registry `assay-engine==0.5.0.dev2` without cache.
- [ ] Execute `uv run poe gate` for backend quality.
- [ ] Execute `uv run poe audit` for dependency security without suppressions.
- [ ] Regenerate all five fixture files in the container and compare each against a copied committed baseline with `scripts/compare_parity_fixtures.py`.
- [ ] Run each focused check and require a zero exit code.

### Task 3: Compose frontend, browser, and workflow checks

**Files:**
- Modify: `.dagger/src/edge_reco/main.py`

**Interfaces:**
- Consumes: `frontend/` and `.github/workflows/`.
- Produces: `frontend-quality`, `browser-e2e`, `frontend-audit`, and `workflow-security` checks.

- [ ] Add shared Node/Playwright containers with pnpm, model, and browser `CacheVolume` instances.
- [ ] Run `pnpm install --frozen-lockfile`, prefetch the SHA-verified MiniLM model, and preserve the existing ORT staging hook.
- [ ] Run `pnpm gate:quality` and compare the regenerated relevance export to the committed baseline.
- [ ] Serve the production build as a Dagger `Service`, bind it as `preview`, and run `verify-i18n.mjs` against `http://preview:4173`.
- [ ] Run `pnpm gate:e2e` in the Playwright container.
- [ ] Run `pnpm audit` with no suppressions and actionlint against every workflow.
- [ ] Run each focused check and require a zero exit code.

### Task 4: Add the shadow GitHub trigger

**Files:**
- Create: `.github/workflows/dagger.yml`

**Interfaces:**
- Consumes: pull requests, pushes to `main`, weekly schedule, and manual dispatch.
- Produces: one stable GitHub check context named `Dagger`.

- [ ] Write a 15–30 line workflow with `contents: read` only.
- [ ] Pin checkout, Gitleaks, and Dagger actions to immutable 40-character SHAs.
- [ ] Fetch full history for Gitleaks and invoke Dagger v0.21.8 with `check: "**"`.
- [ ] Run actionlint locally.
- [ ] Commit and push the shadow implementation without deleting legacy workflows.

### Task 5: Prove shadow parity and migrate protection

**Files:**
- Delete after shadow success: `.github/workflows/ci.yml`
- Delete after shadow success: `.github/workflows/parity-fixtures.yml`
- Delete after shadow success: `.github/workflows/security-audit.yml`
- Modify after shadow success: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: a successful exact-head shadow run from every legacy context plus `Dagger`.
- Produces: required contexts `Dagger` and `CodeQL`, with deploy listening to `Dagger`.

- [ ] Run the complete local repository and Dagger gates, then open the shadow PR.
- [ ] Wait until all legacy checks, `Dagger`, CodeQL, and external scanners are green on the exact head.
- [ ] Update branch protection to replace legacy contexts with `Dagger` while retaining `CodeQL`, strict mode, admin enforcement, and conversation resolution.
- [ ] Update the deploy trigger from workflow `CI`/file `ci.yml` to workflow `Dagger`/file `dagger.yml`.
- [ ] Delete the three duplicated workflows and push the migration commit immediately.
- [ ] Require the new exact head to pass `Dagger`, CodeQL, external scanning, and deploy-contract tests before merge.

### Task 6: Merge, deploy, and verify production

**Files:**
- No new implementation files.

**Interfaces:**
- Consumes: mergeable exact-head PR with all required checks green.
- Produces: live `edge-reco.com` at the exact merge SHA.

- [ ] Merge the non-Dependabot PR and confirm remote `main` equals the merge SHA.
- [ ] Monitor main Dagger, CodeQL, and Cloudflare deployment to success.
- [ ] Verify `/build.json`, signed manifest identity, HSTS/CSP/cache/MIME headers, and www canonical redirect.
- [ ] Run a fresh production browser journey covering launch, search, recommendation rails, PDP/back, Assay/Avow evidence, and backend calls `0`.
- [ ] Assert zero external runtime origins, failed requests, and console/page errors.
- [ ] Report before/after workflow LOC, handwritten Dagger LOC, total diff, and exact deleted orchestration.
