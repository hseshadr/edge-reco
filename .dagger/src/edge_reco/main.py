"""EdgeReco's complete build, security, and release graph."""

from __future__ import annotations

from shlex import split as shell_split
from typing import Final, Self

import dagger
from dagger import check, dag, field, function, object_type

PYTHON_IMAGE: Final = "python:3.13.14-slim@sha256:9662417aace5ae7b8e2609cce472b72a8958e134ba372808abe9cc1a0c0125e6"
NODE_IMAGE: Final = "node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203"
ACTIONLINT_IMAGE: Final = (
    "rhysd/actionlint:1.7.10@sha256:ef8299f97635c4c30e2298f48f30763ab782a4ad2c95b744649439a039421e36"
)
GITLEAKS_IMAGE: Final = (
    "ghcr.io/gitleaks/gitleaks:v8.29.1@sha256:aa036a2f4bdfe3cc3c55fa4326308efabb4a6be498c883c864fd1d0d5585438a"
)
CODEQL_IMAGE: Final = "ubuntu:24.04@sha256:353675e2a41babd526e2b837d7ec780c2a05bca0164f7ea5dbbd433d21d166fc"
CODEQL_URL: Final = (
    "https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.26.2/codeql-bundle-linux64.tar.zst"
)
CODEQL_CHECKSUM: Final = "sha256:0b152b004dec9fd57ccaf58d3fc410efa5be409e1b331cde280b0b8db7bc6dd6"
REPOSITORY: Final = "hseshadr/edge-reco"
REPOSITORY_URL: Final = f"https://github.com/{REPOSITORY}.git"
UV_VERSION: Final = "0.11.32"
PNPM_VERSION: Final = "11.5.0"
CHECK_SHA: Final = "0000000000000000000000000000000000000000"
SHA_LENGTH: Final = 40
PREVIEW_ARGS: Final = tuple(shell_split("pnpm -C app exec vite preview --host --port 4173 --strictPort"))
ASSAY_INSTALL: Final = tuple(
    shell_split("uv pip install --python /opt/venv --no-cache --reinstall --no-deps assay-engine==0.5.0.dev3")
)
PLAYWRIGHT_INSTALL: Final = tuple(shell_split("pnpm -C app exec playwright install --with-deps chromium"))
FIXTURES: Final = tuple(shell_split("search_parity cooccurrence_parity strategy_parity embedding_parity hybrid_parity"))
FIXTURE_DIR: Final = "../frontend/packages/edgeproc-browser/src/engine/__fixtures__"
SOURCE_EXCLUDES: Final = list(
    shell_split(".venv **/.venv **/node_modules **/dist **/coverage frontend/app/public/models frontend/app/public/ort")
)
GITLEAKS_SNAPSHOT: Final = tuple(shell_split("gitleaks detect --source /snapshot --no-git --redact --no-banner"))
GITLEAKS_HISTORY: Final = tuple(shell_split("gitleaks detect --source /repo --log-opts=--all --redact --no-banner"))
CODEQL_UPLOAD: Final = ("/opt/codeql/codeql", "github", "upload-results", "--github-auth-stdin")
AUTH_PIPE: Final = 'printf "%s" "$GITHUB_TOKEN" | exec "$@"'


@object_type
class EdgeReco:
    """Run the same typed release graph locally and on GitHub Actions."""

    source: dagger.Directory = field()

    @classmethod
    def create(cls, workspace: dagger.Workspace) -> Self:
        """Construct the graph from an explicit typed workspace snapshot."""
        instance = cls.__new__(cls)
        instance.source = workspace.directory("/", exclude=SOURCE_EXCLUDES)
        return instance

    @function
    @check
    def backend_quality(self) -> dagger.Container:
        """Run the strict Python gate with coverage and complexity floors."""
        return self._python(self.source).with_exec(["uv", "run", "poe", "gate"])

    @function
    @check
    def backend_audit(self) -> dagger.Container:
        """Audit the exact Python lock without vulnerability suppressions."""
        return self._python(self.source).with_exec(["uv", "run", "poe", "audit"])

    @function
    @check
    def parity(self) -> dagger.Container:
        """Regenerate and compare all Python-to-browser parity fixtures."""
        container = self._python(self.source).with_directory("/baseline", self._fixtures(self.source))
        for name in FIXTURES:
            script = f"scripts/gen_{name.removesuffix('_parity')}_fixture.py"
            container = container.with_exec(["uv", "run", "python", script])
        return container.with_exec(["sh", "-ceu", self._parity_command()])

    @function
    @check
    def frontend_quality(self) -> dagger.Container:
        """Run frontend quality, artifact freshness, and production i18n."""
        quality = self._frontend(self.source).with_exec(["pnpm", "run", "gate:quality"])
        quality = quality.with_exec(["cmp", self._relevance_path(), "/baseline/relevance.json"])
        preview = self._preview(quality)
        return quality.with_service_binding("preview", preview).with_exec(
            ["node", "app/scripts/verify-i18n.mjs", "http://preview:4173"]
        )

    @function(name="browser")
    @check
    def browser_e2e(self) -> dagger.Container:
        """Run storefront, real-model, offline, and cold-network browser proofs."""
        return self._frontend(self.source).with_exec(["pnpm", "run", "gate:e2e"])

    @function
    @check
    def frontend_audit(self) -> dagger.Container:
        """Audit the exact pnpm lock without vulnerability suppressions."""
        return self._node(self.source).with_exec(["pnpm", "audit"])

    @function
    @check
    def workflow_security(self) -> dagger.Container:
        """Validate every workflow with pinned actionlint."""
        workflows = self.source.directory(".github/workflows")
        return (
            self._actionlint()
            .with_directory("/repo/.github/workflows", workflows)
            .with_exec(["sh", "-c", "actionlint .github/workflows/*.yml"])
        )

    @function
    @check
    def secret_scan(self) -> dagger.Container:
        """Scan the snapshot and complete canonical Git history with Gitleaks."""
        history = dag.git(REPOSITORY_URL).branch("main").tree(depth=0, include_tags=True)
        scan = self._gitleaks().with_directory("/snapshot", self.source)
        scan = scan.with_exec(["sh", "/snapshot/.dagger/scripts/gitleaks-canary.sh"])
        scan = scan.with_exec(list(GITLEAKS_SNAPSHOT)).with_directory("/repo", history)
        return scan.with_exec(list(GITLEAKS_HISTORY))

    @function
    def build(self, commit_sha: str) -> dagger.Directory:
        """Build and validate the immutable Pages artifact for ``commit_sha``."""
        return self._build_source(self.source, commit_sha)

    @function
    def release_preflight(self, commit_sha: str) -> dagger.Container:
        """Validate pinned Wrangler and an exact Dagger-built artifact without credentials."""
        artifact = self._build_source(self.source, commit_sha)
        return self._wrangler_base(self.source, artifact).with_exec(
            ["sh", "app/scripts/wrangler-release.sh", "preflight", commit_sha]
        )

    @function
    @check
    def codeql(self) -> dagger.Container:
        """Run both official CodeQL analyses as a shadow gate before SARIF cutover."""
        return self._codeql_analysis(self.source)

    @function
    def codeql_sarif(self) -> dagger.Directory:
        """Analyze JavaScript/TypeScript and Python with the official CodeQL CLI."""
        return self._codeql_analysis(self.source).directory("/sarif")

    def _codeql_analysis(self, source: dagger.Directory) -> dagger.Container:
        container = self._codeql().with_directory("/src", source).with_workdir("/src")
        return container.with_exec(["sh", ".dagger/scripts/codeql-analysis.sh"])

    @function
    async def codeql_upload(
        self,
        github_token: dagger.Secret,
        commit_sha: str,
        ref: str = "refs/heads/main",
        repository: str = REPOSITORY,
    ) -> str:
        """Upload Dagger-generated SARIF after GitHub default setup is retired."""
        container = self._codeql().with_directory("/src", self.source).with_workdir("/src")
        container = container.with_directory("/sarif", self.codeql_sarif())
        container = container.with_secret_variable("GITHUB_TOKEN", github_token)
        for language in ("javascript-typescript", "python"):
            args = [*CODEQL_UPLOAD, f"--repository={repository}", f"--ref={ref}", f"--commit={commit_sha}"]
            command = ["sh", "-ceu", AUTH_PIPE, "upload", *args, f"--sarif=/sarif/{language}.sarif"]
            container = container.with_exec(command)
        return await container.stdout()

    @function
    async def verify_live(self, commit_sha: str) -> str:
        """Verify public identity, canonical routing, and zero-egress browser behavior."""
        return await self._live_container(self.source, commit_sha).stdout()

    @function
    async def deploy(
        self,
        cloudflare_api_token: dagger.Secret,
        cloudflare_account_id: dagger.Secret,
        github_token: dagger.Secret,
        repository: str = REPOSITORY,
    ) -> str:
        """Deploy current green main and verify source, artifact, and live identity."""
        commit_sha = await self._green_main(github_token, repository)
        source = dag.git(f"https://github.com/{repository}.git").commit(commit_sha).tree(depth=0)
        artifact = self._build_source(source, commit_sha)
        await self._disable_git_deployments(cloudflare_api_token, cloudflare_account_id)
        await self._deploy_artifact(artifact, source, commit_sha, cloudflare_api_token, cloudflare_account_id)
        return await self._live_container(source, commit_sha).stdout()

    async def _disable_git_deployments(self, token: dagger.Secret, account: dagger.Secret) -> None:
        tools = self._release_tools().with_secret_variable("CLOUDFLARE_API_TOKEN", token)
        tools = tools.with_secret_variable("CLOUDFLARE_ACCOUNT_ID", account)
        await tools.with_exec(["sh", "/scripts/cloudflare-pages.sh", "disable"]).sync()

    def _build_source(self, source: dagger.Directory, commit_sha: str) -> dagger.Directory:
        self._require_sha(commit_sha)
        built = self._modeled(source, commit_sha).with_exec(["pnpm", "-F", "frontend", "run", "build:pages"])
        checked = built.with_exec(["pnpm", "-F", "frontend", "run", "test:artifacts"])
        return checked.directory("/src/frontend/app/dist")

    async def _green_main(self, token: dagger.Secret, repository: str) -> str:
        remote = dag.git(f"https://github.com/{repository}.git").branch("main")
        commit = await remote.commit()
        await self._github_probe(token, repository, commit).sync()
        return commit

    async def _deploy_artifact(
        self,
        artifact: dagger.Directory,
        source: dagger.Directory,
        commit: str,
        token: dagger.Secret,
        account: dagger.Secret,
    ) -> None:
        container = self._wrangler(source, artifact, token, account)
        script = "app/scripts/wrangler-release.sh"
        await container.with_exec(["sh", script, "preflight", commit]).sync()
        await container.with_exec(["sh", script, "deploy", commit]).sync()
        tools = self._release_tools().with_secret_variable("CLOUDFLARE_API_TOKEN", token)
        tools = tools.with_secret_variable("CLOUDFLARE_ACCOUNT_ID", account).with_env_variable("EXPECTED_SHA", commit)
        await tools.with_exec(["sh", "/scripts/cloudflare-pages.sh", "verify"]).sync()

    def _github_probe(self, token: dagger.Secret, repository: str, commit: str) -> dagger.Container:
        url = f"https://api.github.com/repos/{repository}/actions/workflows/dagger.yml/runs?head_sha={commit}&event=push&per_page=20"
        script = (
            'tmp=$(mktemp -d); curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" '
            f'-H "Accept: application/vnd.github+json" "{url}" -o "$tmp/runs.json"; '
            'test "$(jq \'[.workflow_runs[]|select(.conclusion=="success")]|length\' '
            '"$tmp/runs.json")" -gt 0'
        )
        return self._release_tools().with_secret_variable("GITHUB_TOKEN", token).with_exec(["sh", "-ceu", script])

    def _wrangler(
        self,
        source: dagger.Directory,
        artifact: dagger.Directory,
        token: dagger.Secret,
        account: dagger.Secret,
    ) -> dagger.Container:
        container = self._wrangler_base(source, artifact)
        container = container.with_secret_variable("CLOUDFLARE_API_TOKEN", token)
        return container.with_secret_variable("CLOUDFLARE_ACCOUNT_ID", account)

    def _wrangler_base(self, source: dagger.Directory, artifact: dagger.Directory) -> dagger.Container:
        container = self._dependencies(source)
        return container.with_directory("/artifact", artifact).with_workdir("/src/frontend")

    def _live_container(self, source: dagger.Directory, commit: str) -> dagger.Container:
        self._require_sha(commit)
        verified = self._frontend(source, commit).with_env_variable("LIVE_BASE_URL", "https://edge-reco.com")
        return verified.with_exec(
            [
                "pnpm",
                "-C",
                "app",
                "exec",
                "playwright",
                "test",
                "--config=playwright.live.config.ts",
            ]
        )

    def _python(self, source: dagger.Directory) -> dagger.Container:
        base = self._python_toolchain().with_directory("/src", source).with_workdir("/src/backend")
        base = base.with_env_variable("UV_PROJECT_ENVIRONMENT", "/opt/venv")
        base = base.with_mounted_cache("/root/.cache/uv", dag.cache_volume("edge-reco-uv"))
        return base.with_exec(["uv", "sync", "--group", "dev"]).with_exec(list(ASSAY_INSTALL))

    def _python_toolchain(self) -> dagger.Container:
        base = dag.container().from_(PYTHON_IMAGE).with_exec(["apt-get", "update"])
        base = base.with_exec(["apt-get", "install", "-y", "--no-install-recommends", "build-essential", "git"])
        return base.with_exec(["python", "-m", "pip", "install", f"uv=={UV_VERSION}"])

    def _node(self, source: dagger.Directory, commit: str = CHECK_SHA) -> dagger.Container:
        base = dag.container().from_(NODE_IMAGE).with_exec(["corepack", "enable", "pnpm"])
        base = base.with_exec(["corepack", "install", "--global", f"pnpm@{PNPM_VERSION}"])
        base = base.with_directory("/src", source).with_workdir("/src/frontend")
        return base.with_env_variable("EXPECTED_SHA", commit).with_mounted_cache(
            "/pnpm/store", dag.cache_volume("edge-reco-pnpm")
        )

    def _dependencies(self, source: dagger.Directory, commit: str = CHECK_SHA) -> dagger.Container:
        container = self._node(source, commit).with_exec(["pnpm", "config", "set", "store-dir", "/pnpm/store"])
        return container.with_exec(["pnpm", "install", "--frozen-lockfile"])

    def _modeled(self, source: dagger.Directory, commit: str = CHECK_SHA) -> dagger.Container:
        container = self._dependencies(source, commit).with_mounted_cache(
            "/src/frontend/app/public/models", dag.cache_volume("edge-reco-model")
        )
        return container.with_exec(["node", "app/scripts/download-model.mjs"])

    def _frontend(self, source: dagger.Directory, commit: str = CHECK_SHA) -> dagger.Container:
        container = self._modeled(source, commit)
        container = container.with_file(
            "/baseline/relevance.json",
            self._fixtures(source).file("relevance_export.json"),
        )
        return container.with_mounted_cache(
            "/root/.cache/ms-playwright", dag.cache_volume("edge-reco-playwright")
        ).with_exec(list(PLAYWRIGHT_INSTALL))

    def _preview(self, quality: dagger.Container) -> dagger.Service:
        preview = quality.with_exec(["sed", "-i", "s/; upgrade-insecure-requests//", "app/public/_headers"])
        preview = preview.with_env_variable("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", "preview")
        return preview.with_exposed_port(4173).as_service(args=list(PREVIEW_ARGS))

    @staticmethod
    def _fixtures(source: dagger.Directory) -> dagger.Directory:
        return source.directory("frontend/packages/edgeproc-browser/src/engine/__fixtures__")

    @staticmethod
    def _actionlint() -> dagger.Container:
        return dag.container().from_(ACTIONLINT_IMAGE).with_entrypoint([]).with_workdir("/repo")

    @staticmethod
    def _gitleaks() -> dagger.Container:
        return dag.container().from_(GITLEAKS_IMAGE).with_entrypoint([])

    @staticmethod
    def _codeql() -> dagger.Container:
        base = EdgeReco._codeql_base()
        archive = dag.http(CODEQL_URL, checksum=CODEQL_CHECKSUM)
        base = base.with_file("/opt/codeql.tar.zst", archive).with_exec(
            ["tar", "--zstd", "-xf", "/opt/codeql.tar.zst", "-C", "/opt"]
        )
        return base.with_exec(["mkdir", "-p", "/db", "/sarif"])

    @staticmethod
    def _codeql_base() -> dagger.Container:
        packages = ["ca-certificates", "git", "nodejs", "python3", "zstd"]
        base = dag.container(platform=dagger.Platform("linux/amd64")).from_(CODEQL_IMAGE)
        base = base.with_env_variable("DEBIAN_FRONTEND", "noninteractive")
        return base.with_exec(["apt-get", "update"]).with_exec(
            ["apt-get", "install", "-y", "--no-install-recommends", *packages]
        )

    def _release_tools(self) -> dagger.Container:
        base = dag.container().from_(CODEQL_IMAGE).with_exec(["apt-get", "update"])
        base = base.with_exec(["apt-get", "install", "-y", "--no-install-recommends", "ca-certificates", "curl", "jq"])
        return base.with_directory("/scripts", self.source.directory(".dagger/scripts"))

    @staticmethod
    def _require_sha(commit: str) -> None:
        if len(commit) != SHA_LENGTH or any(char not in "0123456789abcdef" for char in commit):
            raise ValueError("commit_sha must be a lowercase 40-character Git SHA")

    @staticmethod
    def _relevance_path() -> str:
        return "packages/edgeproc-browser/src/engine/__fixtures__/relevance_export.json"

    @staticmethod
    def _parity_command() -> str:
        pairs = " ".join(f"--pair /baseline/{name}.json {FIXTURE_DIR}/{name}.json" for name in FIXTURES)
        return f"uv run python scripts/compare_parity_fixtures.py {pairs}"
