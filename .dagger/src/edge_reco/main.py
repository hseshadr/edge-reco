"""EdgeReco's complete quality graph, composed from native Dagger types."""

from __future__ import annotations

from shlex import split as shell_split
from typing import Final

import dagger
from dagger import check, dag, function, object_type

PYTHON_IMAGE: Final = (
    "python:3.13.14-slim@sha256:9662417aace5ae7b8e2609cce472b72a8958e134ba372808abe9cc1a0c0125e6"
)
NODE_IMAGE: Final = (
    "node:24.16.0-bookworm-slim@sha256:"
    "2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203"
)
ACTIONLINT_IMAGE: Final = (
    "rhysd/actionlint:1.7.10@sha256:"
    "ef8299f97635c4c30e2298f48f30763ab782a4ad2c95b744649439a039421e36"
)
UV_VERSION: Final = "0.11.32"
PNPM_VERSION: Final = "11.5.0"
CHECK_SHA: Final = "0000000000000000000000000000000000000000"
PREVIEW_ARGS: Final = tuple(
    shell_split("pnpm -C app exec vite preview --host --port 4173 --strictPort")
)
ASSAY_INSTALL: Final = tuple(
    shell_split(
        "uv pip install --python /opt/venv --no-cache --reinstall "
        "--no-deps assay-engine==0.5.0.dev3"
    )
)
PLAYWRIGHT_INSTALL: Final = tuple(
    shell_split("pnpm -C app exec playwright install --with-deps chromium")
)
FIXTURES: Final = (
    "search_parity",
    "cooccurrence_parity",
    "strategy_parity",
    "embedding_parity",
    "hybrid_parity",
)
FIXTURE_DIR: Final = "../frontend/packages/edgeproc-browser/src/engine/__fixtures__"
SOURCE_EXCLUDES: Final = [
    ".venv",
    "**/.venv",
    "**/node_modules",
    "**/dist",
    "**/coverage",
    "frontend/app/public/models",
    "frontend/app/public/ort",
]


@object_type
class EdgeReco:
    """Run EdgeReco quality, parity, browser, and security contracts."""

    @function
    @check
    def backend_quality(self) -> dagger.Container:
        """Run the strict Python gate with coverage and complexity floors."""
        return self._python().with_exec(["uv", "run", "poe", "gate"])

    @function
    @check
    def backend_audit(self) -> dagger.Container:
        """Audit the exact Python lock without vulnerability suppressions."""
        return self._python().with_exec(["uv", "run", "poe", "audit"])

    @function
    @check
    def parity(self) -> dagger.Container:
        """Regenerate and compare all Python-to-browser parity fixtures."""
        container = self._python().with_directory("/baseline", self._fixtures())
        for name in FIXTURES:
            script = f"scripts/gen_{name.removesuffix('_parity')}_fixture.py"
            container = container.with_exec(["uv", "run", "python", script])
        return container.with_exec(["sh", "-ceu", self._parity_command()])

    @function
    @check
    def frontend_quality(self) -> dagger.Container:
        """Run frontend quality, artifact freshness, and production i18n."""
        quality = self._frontend().with_exec(["pnpm", "run", "gate:quality"])
        quality = quality.with_exec(["cmp", self._relevance_path(), "/baseline/relevance.json"])
        preview = (
            quality.with_exec(
                ["sed", "-i", "s/; upgrade-insecure-requests//", "app/public/_headers"]
            )
            .with_env_variable("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", "preview")
            .with_exposed_port(4173)
            .as_service(args=list(PREVIEW_ARGS))
        )
        return quality.with_service_binding("preview", preview).with_exec(
            ["node", "app/scripts/verify-i18n.mjs", "http://preview:4173"]
        )

    @function(name="browser")
    @check
    def browser_e2e(self) -> dagger.Container:
        """Run storefront, real-model, offline, and cold-network browser proofs."""
        return self._frontend().with_exec(["pnpm", "run", "gate:e2e"])

    @function
    @check
    def frontend_audit(self) -> dagger.Container:
        """Audit the exact pnpm lock without vulnerability suppressions."""
        return self._node().with_exec(["pnpm", "audit"])

    @function
    @check
    def workflow_security(self) -> dagger.Container:
        """Validate every GitHub Actions workflow with pinned actionlint."""
        workflows = dag.current_workspace().directory("/.github/workflows")
        return (
            dag.container()
            .from_(ACTIONLINT_IMAGE)
            .with_entrypoint([])
            .with_directory("/repo/.github/workflows", workflows)
            .with_workdir("/repo")
            .with_exec(["sh", "-c", "actionlint .github/workflows/*.yml"])
        )

    def _source(self) -> dagger.Directory:
        workspace: dagger.Workspace = dag.current_workspace()
        return workspace.directory(
            "/",
            include=[".github/workflows/**", "README.md", "backend/**", "frontend/**"],
            exclude=SOURCE_EXCLUDES,
        )

    def _fixtures(self) -> dagger.Directory:
        return dag.current_workspace().directory(
            "/frontend/packages/edgeproc-browser/src/engine/__fixtures__"
        )

    def _python(self) -> dagger.Container:
        return (
            self._python_toolchain()
            .with_directory("/src", self._source())
            .with_workdir("/src/backend")
            .with_env_variable("UV_PROJECT_ENVIRONMENT", "/opt/venv")
            .with_mounted_cache("/root/.cache/uv", dag.cache_volume("edge-reco-uv"))
            .with_exec(["uv", "sync", "--group", "dev"])
            .with_exec(list(ASSAY_INSTALL))
        )

    def _python_toolchain(self) -> dagger.Container:
        return (
            dag.container()
            .from_(PYTHON_IMAGE)
            .with_exec(["apt-get", "update"])
            .with_exec(
                ["apt-get", "install", "-y", "--no-install-recommends", "build-essential", "git"]
            )
            .with_exec(["python", "-m", "pip", "install", f"uv=={UV_VERSION}"])
        )

    def _node(self) -> dagger.Container:
        return (
            dag.container()
            .from_(NODE_IMAGE)
            .with_exec(["corepack", "enable", "pnpm"])
            .with_exec(["corepack", "install", "--global", f"pnpm@{PNPM_VERSION}"])
            .with_directory("/src", self._source())
            .with_workdir("/src/frontend")
            .with_env_variable("EXPECTED_SHA", CHECK_SHA)
            .with_mounted_cache("/pnpm/store", dag.cache_volume("edge-reco-pnpm"))
        )

    def _frontend(self) -> dagger.Container:
        container = (
            self._node()
            .with_exec(["pnpm", "config", "set", "store-dir", "/pnpm/store"])
            .with_exec(["pnpm", "install", "--frozen-lockfile"])
            .with_mounted_cache(
                "/src/frontend/app/public/models", dag.cache_volume("edge-reco-model")
            )
            .with_file("/baseline/relevance.json", self._fixtures().file("relevance_export.json"))
            .with_exec(["node", "app/scripts/download-model.mjs"])
        )
        return container.with_mounted_cache(
            "/root/.cache/ms-playwright", dag.cache_volume("edge-reco-playwright")
        ).with_exec(list(PLAYWRIGHT_INSTALL))

    @staticmethod
    def _relevance_path() -> str:
        return "packages/edgeproc-browser/src/engine/__fixtures__/relevance_export.json"

    @staticmethod
    def _parity_command() -> str:
        pairs = " ".join(
            f"--pair /baseline/{name}.json {FIXTURE_DIR}/{name}.json" for name in FIXTURES
        )
        return f"uv run python scripts/compare_parity_fixtures.py {pairs}"
