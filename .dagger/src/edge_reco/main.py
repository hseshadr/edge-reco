"""EdgeReco's complete build, security, and release graph."""

from __future__ import annotations

from dataclasses import dataclass, fields
from shlex import split as shell_split
from typing import Final, Self, cast

import dagger
from dagger import check, dag, field, function, object_type

from edge_reco.targets import EdgeRecoTarget

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
TARGET: Final = EdgeRecoTarget.production()
REPOSITORY: Final = TARGET.repository
REPOSITORY_URL: Final = f"https://github.com/{REPOSITORY}.git"
UV_VERSION: Final = "0.11.32"
PNPM_VERSION: Final = "11.5.0"
CHECK_SHA: Final = "0000000000000000000000000000000000000000"
SHA_LENGTH: Final = 40
DIGEST_LENGTH: Final = 64
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
GUARD_MARKERS: Final = frozenset(("guard-canary-detected", "guard-snapshot-nonempty", "guard-history-verified"))
WORKFLOW_SUFFIXES: Final = frozenset((".yml", ".yaml"))
GUARD_EVIDENCE_KEYS: Final = frozenset(
    (
        "workflow_suffixes",
        "actionlint",
        "runtime_canary",
        "snapshot_gitleaks",
        "history_gitleaks",
        "source_inventory",
        "manifest",
        "retains_git_history",
        "commit_sha",
    )
)
CODEQL_UPLOAD: Final = ("/opt/codeql/codeql", "github", "upload-results", "--github-auth-stdin")
AUTH_PIPE: Final = 'printf "%s" "$GITHUB_TOKEN" | exec "$@"'


class GuardParityError(ValueError):
    """Raised when shared and legacy repository-guard semantics diverge."""


@dataclass(frozen=True)
class GuardEvidence:
    """The security semantics that both repository-guard paths must prove."""

    workflow_suffixes: frozenset[str]
    actionlint: bool
    runtime_canary: bool
    snapshot_gitleaks: bool
    history_gitleaks: bool
    source_inventory: str
    manifest: str
    retains_git_history: bool
    commit_sha: str


def require_guard_parity(legacy: GuardEvidence, shared: GuardEvidence) -> None:
    """Reject the first semantic difference between shadow guard evidence."""
    for evidence_field in fields(GuardEvidence):
        if getattr(legacy, evidence_field.name) != getattr(shared, evidence_field.name):
            raise GuardParityError(f"legacy and shared guards disagree on {evidence_field.name}")


def parse_guard_evidence(output: str) -> GuardEvidence:
    """Deserialize complete observed evidence from one completed guard path."""
    records = _evidence_records(output)
    if frozenset(records) != GUARD_EVIDENCE_KEYS:
        raise GuardParityError("guard evidence keys are incomplete or malformed")
    return _guard_evidence_from_records(records)


def _guard_evidence_from_records(records: dict[str, str]) -> GuardEvidence:
    suffixes = frozenset(records["workflow_suffixes"].split(","))
    if not _valid_guard_records(records, suffixes):
        raise GuardParityError("guard evidence values are incomplete or malformed")
    return _observed_guard_evidence(suffixes, records)


def _observed_guard_evidence(suffixes: frozenset[str], records: dict[str, str]) -> GuardEvidence:
    actionlint, canary, snapshot, history, retains_history = _stage_results(records)
    return GuardEvidence(
        suffixes,
        actionlint,
        canary,
        snapshot,
        history,
        records["source_inventory"],
        records["manifest"],
        retains_history,
        records["commit_sha"],
    )


def _evidence_records(output: str) -> dict[str, str]:
    records: dict[str, str] = {}
    for line in output.splitlines():
        _add_evidence_record(records, line)
    return records


def _add_evidence_record(records: dict[str, str], line: str) -> None:
    key, separator, value = line.partition("=")
    if not all((separator, key, value)) or key in records:
        raise GuardParityError("source evidence is malformed")
    records[key] = value


def _valid_guard_records(records: dict[str, str], suffixes: frozenset[str]) -> bool:
    return _valid_suffixes(suffixes) and _completed_guard_stages(records) and _valid_source_records(records)


def _valid_suffixes(suffixes: frozenset[str]) -> bool:
    return bool(suffixes) and suffixes <= WORKFLOW_SUFFIXES


def _valid_source_records(records: dict[str, str]) -> bool:
    inventory = _is_digest(records["source_inventory"])
    manifest = _is_digest(records["manifest"])
    return inventory and manifest and _is_sha(records["commit_sha"])


def _is_digest(value: str) -> bool:
    return len(value) == DIGEST_LENGTH and all(character in "0123456789abcdef" for character in value)


def _completed_guard_stages(records: dict[str, str]) -> bool:
    stages = ("actionlint", "runtime_canary", "snapshot_gitleaks", "history_gitleaks", "retains_git_history")
    return all(records[stage] == "passed" for stage in stages)


def _stage_results(records: dict[str, str]) -> tuple[bool, bool, bool, bool, bool]:
    return (
        records["actionlint"] == "passed",
        records["runtime_canary"] == "passed",
        records["snapshot_gitleaks"] == "passed",
        records["history_gitleaks"] == "passed",
        records["retains_git_history"] == "passed",
    )


def _is_sha(value: str) -> bool:
    return len(value) == SHA_LENGTH and all(character in "0123456789abcdef" for character in value)


EVIDENCE_RUNTIME_SCRIPT: Final = r"""
import hashlib
import os
import stat

ROOT = b"/snapshot"


def frame(value):
    return len(value).to_bytes(8, "big") + value


def content_digest(path, entry):
    if entry.is_symlink():
        return hashlib.sha256(os.fsencode(os.readlink(path))).digest(), b"l"
    if entry.is_file(follow_symlinks=False):
        with open(path, "rb") as source:
            return hashlib.file_digest(source, "sha256").digest(), b"f"
    raise RuntimeError("unsupported source entry")


def source_records(path=ROOT, relative=b""):
    records = []
    with os.scandir(path) as entries:
        for entry in sorted(entries, key=lambda item: os.fsencode(item.name)):
            name = os.fsencode(entry.name)
            child_relative = relative + name
            child_path = os.path.join(path, name)
            if entry.is_dir(follow_symlinks=False):
                records.extend(source_records(child_path, child_relative + b"/"))
                continue
            digest, kind = content_digest(child_path, entry)
            mode = oct(stat.S_IMODE(entry.stat(follow_symlinks=False).st_mode)).encode()
            inventory = frame(kind) + frame(child_relative) + frame(mode)
            records.append((child_relative, inventory, inventory + frame(digest)))
    return records


def source_digests():
    records = sorted(source_records(), key=lambda item: item[0])
    inventory = b"".join(frame(record[1]) for record in records)
    manifest = b"".join(frame(record[2]) for record in records)
    return hashlib.sha256(inventory).hexdigest(), hashlib.sha256(manifest).hexdigest()


def workflow_suffixes():
    root = ROOT + b"/.github/workflows"
    suffixes = set()
    for directory, _, names in os.walk(root):
        for name in names:
            suffix = b".yaml" if name.endswith(b".yaml") else b".yml" if name.endswith(b".yml") else b""
            if suffix:
                suffixes.add(suffix.decode())
    if not suffixes:
        raise RuntimeError("no workflow files")
    return ",".join(sorted(suffixes))


def predecessor_records():
    lines = open("/guard-proof", encoding="utf-8").read().splitlines()
    records = {}
    for line in lines:
        key, separator, value = line.partition("=")
        if not separator or not key or not value or key in records:
            raise RuntimeError("malformed guard predecessor")
        records[key] = value
    expected = {
        "actionlint", "runtime_canary", "snapshot_gitleaks",
        "history_gitleaks", "retains_git_history", "commit_sha",
    }
    if set(records) != expected:
        raise RuntimeError("unexpected guard predecessor")
    return records


def main():
    if os.environ.get("DIGEST_ONLY") == "1":
        inventory, manifest = source_digests()
        print(f"inventory={inventory}")
        print(f"manifest={manifest}")
        return
    evidence = predecessor_records()
    inventory, manifest = source_digests()
    evidence.update({"workflow_suffixes": workflow_suffixes(), "source_inventory": inventory, "manifest": manifest})
    for key in sorted(evidence):
        print(f"{key}={evidence[key]}")


main()
"""


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
        quality = self._frontend(self.source).with_exec(["apt-get", "update"])
        quality = quality.with_exec(["apt-get", "install", "-y", "--no-install-recommends", "curl", "jq"])
        quality = quality.with_exec(["pnpm", "run", "gate:quality"])
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
    async def workflow_security(self) -> dagger.Container:
        """Validate every workflow with pinned actionlint."""
        source, commit_sha = await self._canonical_guard_source()
        await self._require_shadow_parity(source, commit_sha)
        return self._legacy_workflow_security(source)

    def _legacy_workflow_security(self, source: dagger.Directory) -> dagger.Container:
        """Retain the local actionlint behavior during shared-guard canarying."""
        workflows = source.directory(".github/workflows")
        return (
            self._actionlint()
            .with_directory("/repo/.github/workflows", workflows)
            .with_exec(
                [
                    "sh",
                    "-c",
                    (
                        "find .github/workflows -maxdepth 1 -type f \\( "
                        '-name "*.yml" -o -name "*.yaml" \\) -exec actionlint {} +'
                    ),
                ]
            )
        )

    @function
    @check
    async def secret_scan(self) -> dagger.Container:
        """Scan the snapshot and complete canonical Git history with Gitleaks."""
        source, commit_sha = await self._canonical_guard_source()
        await self._require_shadow_parity(source, commit_sha)
        return self._legacy_secret_scan(source, commit_sha)

    def _legacy_secret_scan(self, source: dagger.Directory, commit_sha: str) -> dagger.Container:
        """Retain local canary, snapshot, and full-history Gitleaks behavior."""
        history = dag.git(REPOSITORY_URL).commit(commit_sha).tree(depth=0, include_tags=True)
        scan = self._gitleaks().with_directory("/snapshot", source)
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

    @function
    async def security(self) -> str:
        """Run every credentialless scheduled security check through Dagger."""
        source, commit_sha = await self._canonical_guard_source()
        await self._require_shadow_parity(source, commit_sha)
        legacy_workflows, legacy_secrets = self._legacy_guard(source, commit_sha)
        checks = cast(
            tuple[dagger.Container, ...],
            (
                self._shared_guard(source, commit_sha),
                legacy_workflows,
                legacy_secrets,
                self.backend_audit(),
                self.frontend_audit(),
                self.codeql(),
            ),
        )
        for security_check in checks:
            await security_check.sync()
        return "security checks passed"

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
    ) -> str:
        """Deploy current green main and verify source, artifact, and live identity."""
        commit_sha = await self._green_main(github_token, TARGET)
        source = dag.git(f"https://github.com/{TARGET.repository}.git").commit(commit_sha).tree(depth=0)
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

    async def _green_main(self, token: dagger.Secret, target: EdgeRecoTarget) -> str:
        remote = dag.git(f"https://github.com/{target.repository}.git").branch(target.branch)
        commit = await remote.commit()
        await self._github_probe(token, target.repository, commit).sync()
        return commit

    async def _canonical_guard_source(self) -> tuple[dagger.Directory, str]:
        """Fetch public EdgeReco bytes that can be bound to complete Git history."""
        commit_sha = await dag.git(REPOSITORY_URL).branch(TARGET.branch).commit()
        self._require_sha(commit_sha)
        source = dag.git(REPOSITORY_URL).commit(commit_sha).tree(depth=0)
        return source, commit_sha

    def _shared_guard(self, source: dagger.Directory, commit_sha: str) -> dagger.Container:
        """Build the generated exact-SHA foundation guard shadow."""
        return dag.foundation().guard(source=source, repository=REPOSITORY, commit_sha=commit_sha)

    def _legacy_guard(self, source: dagger.Directory, commit_sha: str) -> tuple[dagger.Container, dagger.Container]:
        """Build both retained local security checks for shadow parity."""
        return self._legacy_workflow_security(source), self._legacy_secret_scan(source, commit_sha)

    async def _require_shadow_parity(self, source: dagger.Directory, commit_sha: str) -> None:
        """Fail closed unless independently executed guard evidence agrees."""
        legacy, shared = await self._guard_evidence_pair(source, commit_sha)
        require_guard_parity(legacy, shared)

    async def _guard_evidence_pair(
        self, source: dagger.Directory, commit_sha: str
    ) -> tuple[GuardEvidence, GuardEvidence]:
        legacy = await self._legacy_evidence(source, commit_sha)
        shared = await self._shared_evidence(source, commit_sha)
        return legacy, shared

    async def _legacy_evidence(self, source: dagger.Directory, commit_sha: str) -> GuardEvidence:
        """Collect local evidence from its own actionlint and Gitleaks execution."""
        history = self._guard_history(commit_sha)
        guard = await self._validated_proof_guard(self._legacy_shadow_probe(source, history, commit_sha), commit_sha)
        return await self._executed_evidence(guard, source, history, commit_sha)

    async def _shared_evidence(self, source: dagger.Directory, commit_sha: str) -> GuardEvidence:
        """Collect central evidence from the verified foundation binding and guard."""
        bound_source = dag.foundation().source(source=source, repository=REPOSITORY, commit_sha=commit_sha)
        history = self._guard_history(commit_sha)
        guard = await self._validated_proof_guard(self._shared_guard(bound_source, commit_sha), commit_sha)
        return await self._executed_evidence(guard, bound_source, history, commit_sha)

    async def _executed_evidence(
        self, guard: dagger.Container, source: dagger.Directory, history: dagger.Directory, commit_sha: str
    ) -> GuardEvidence:
        await guard.sync()
        output = await self._evidence_runtime(guard, source, history, commit_sha).stdout()
        return parse_guard_evidence(output)

    async def _validated_proof_guard(self, guard: dagger.Container, commit_sha: str) -> dagger.Container:
        await guard.sync()
        self._guard_markers(await guard.stderr())
        return self._proof_guard(guard, commit_sha)

    @staticmethod
    def _proof_guard(guard: dagger.Container, commit_sha: str) -> dagger.Container:
        return guard.with_exec(["sh", "-ceu", EdgeReco._proof_command(commit_sha)])

    @staticmethod
    def _guard_markers(stderr: str) -> frozenset[str]:
        markers = [line.strip() for line in stderr.splitlines() if line.strip().startswith("guard-")]
        if frozenset(markers) != GUARD_MARKERS or len(markers) != len(GUARD_MARKERS):
            raise GuardParityError("guard stage markers are incomplete or malformed")
        return frozenset(markers)

    def _guard_history(self, commit_sha: str) -> dagger.Directory:
        self._require_sha(commit_sha)
        return dag.git(REPOSITORY_URL).commit(commit_sha).tree(depth=0, include_tags=True)

    def _legacy_shadow_probe(
        self, source: dagger.Directory, history: dagger.Directory, commit_sha: str
    ) -> dagger.Container:
        actionlint = self._actionlint().file("/usr/local/bin/actionlint")
        probe = self._gitleaks().with_file("/usr/local/bin/actionlint", actionlint)
        probe = probe.with_directory("/snapshot", source).with_directory("/repo", history)
        return probe.with_exec(["sh", "-ceu", self._legacy_evidence_command(commit_sha)])

    def _evidence_runtime(
        self, guard: dagger.Container, source: dagger.Directory, history: dagger.Directory, commit_sha: str
    ) -> dagger.Container:
        runtime = dag.container().from_(PYTHON_IMAGE).with_file("/guard-proof", guard.file("/guard-proof"))
        runtime = runtime.with_directory("/snapshot", source).with_directory("/repo", history)
        runtime = runtime.with_new_file("/evidence.py", EVIDENCE_RUNTIME_SCRIPT)
        return runtime.with_exec(["python", "/evidence.py"])

    @staticmethod
    def _legacy_evidence_command(commit_sha: str) -> str:
        EdgeReco._require_sha(commit_sha)
        commands = EdgeReco._actionlint_evidence_commands() + EdgeReco._legacy_scan_commands(commit_sha)
        return "\n".join(commands)

    @staticmethod
    def _actionlint_evidence_commands() -> tuple[str, ...]:
        patterns = r"\( -name '*.yml' -o -name '*.yaml' \)"
        return (
            "test -d /snapshot/.github/workflows",
            f'test -n "$(find /snapshot/.github/workflows -type f {patterns} -print -quit)"',
            f"find /snapshot/.github/workflows -type f {patterns} -exec actionlint {{}} +",
        )

    @staticmethod
    def _legacy_scan_commands(commit_sha: str) -> tuple[str, ...]:
        history = EdgeReco._history_evidence_commands(commit_sha)
        return (
            "echo legacy-actionlint-passed >&2",
            "sh /snapshot/.dagger/scripts/gitleaks-canary.sh",
            "echo guard-canary-detected >&2",
            'test -n "$(find /snapshot -type f -print -quit)"',
            "echo guard-snapshot-nonempty >&2",
            "gitleaks detect --source /snapshot --no-git --redact --no-banner",
            *history,
            "echo guard-history-verified >&2",
            "gitleaks detect --source /repo --log-opts=--all --redact --no-banner",
        )

    @staticmethod
    def _proof_command(commit_sha: str) -> str:
        EdgeReco._require_sha(commit_sha)
        records = EdgeReco._proof_records(commit_sha)
        proof = "printf '%s\\n' " + " ".join(records) + " > /guard-proof"
        lines = (*EdgeReco._history_evidence_commands(commit_sha), proof)
        return "\n".join(lines)

    @staticmethod
    def _proof_records(commit_sha: str) -> tuple[str, ...]:
        return (
            "actionlint=passed",
            "runtime_canary=passed",
            "snapshot_gitleaks=passed",
            "history_gitleaks=passed",
            "retains_git_history=passed",
            f"commit_sha={commit_sha}",
        )

    @staticmethod
    def _history_evidence_commands(commit_sha: str) -> tuple[str, ...]:
        return (
            "test -d /repo/.git",
            'test "$(git -C /repo rev-parse --is-shallow-repository)" = false',
            f'test "$(git -C /repo rev-parse HEAD)" = {commit_sha}',
            'test -n "$(git -C /repo rev-list --all)"',
            "git -C /repo fsck --full --no-dangling",
        )

    async def _deploy_artifact(
        self,
        artifact: dagger.Directory,
        source: dagger.Directory,
        commit: str,
        token: dagger.Secret,
        account: dagger.Secret,
    ) -> None:
        tools = self._release_tools().with_secret_variable("CLOUDFLARE_API_TOKEN", token)
        tools = tools.with_secret_variable("CLOUDFLARE_ACCOUNT_ID", account)
        await tools.with_exec(["sh", "/scripts/cloudflare-pages.sh", "preflight"]).sync()
        container = self._wrangler(source, artifact, token, account)
        script = "app/scripts/wrangler-release.sh"
        await container.with_exec(["sh", script, "preflight", commit]).sync()
        await container.with_exec(["sh", script, "deploy", commit]).sync()
        tools = tools.with_env_variable("EXPECTED_SHA", commit)
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
        verified = self._frontend(source, commit).with_env_variable("LIVE_BASE_URL", f"https://{TARGET.domain}")
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
