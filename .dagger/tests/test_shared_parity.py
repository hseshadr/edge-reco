"""Semantic shadow-parity contracts for the shared repository guard."""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Self, cast

import dagger
import pytest

from edge_reco import main as main_module
from edge_reco.main import (
    EVIDENCE_RUNTIME_SCRIPT,
    PYTHON_IMAGE,
    EdgeReco,
    GuardEvidence,
    GuardParityError,
    parse_guard_evidence,
    require_guard_parity,
)

VALID_DEPLOYMENT_ID = "f621dc42-3cf9-4217-b4fb-0392c1d39020"


class FakeDirectory:
    def directory(self, _: str) -> dagger.Directory:
        return cast(dagger.Directory, self)

    def file(self, _: str) -> dagger.File:
        return cast(dagger.File, object())

    def with_directory(self, _: str, __: dagger.Directory) -> dagger.Directory:
        return cast(dagger.Directory, self)

    async def digest(self) -> str:
        return "digest"


class FakeContainer:
    def from_(self, _: str) -> Self:
        return self

    def with_entrypoint(self, _: list[str]) -> Self:
        return self

    def with_directory(self, _: str, __: dagger.Directory) -> Self:
        return self

    def with_exec(self, _: list[str]) -> Self:
        return self

    def with_file(self, _: str, __: dagger.File) -> Self:
        return self

    def file(self, _: str) -> dagger.File:
        return cast(dagger.File, object())

    def with_workdir(self, _: str) -> Self:
        return self

    def with_env_variable(self, _: str, __: str) -> Self:
        return self

    def with_mounted_cache(self, _: str, __: object) -> Self:
        return self

    def with_exposed_port(self, _: int) -> Self:
        return self

    def with_service_binding(self, _: str, __: dagger.Service) -> Self:
        return self

    def with_secret_variable(self, _: str, __: dagger.Secret) -> Self:
        return self

    def as_service(self, *, args: list[str]) -> dagger.Service:
        return cast(dagger.Service, self)

    def directory(self, _: str) -> dagger.Directory:
        return cast(dagger.Directory, FakeDirectory())

    async def sync(self) -> None:
        return None

    async def stdout(self) -> str:
        return "passed"

    async def stderr(self) -> str:
        return "guard-canary-detected\nguard-snapshot-nonempty\nguard-history-verified\n"


class FakeGitRef:
    async def commit(self) -> str:
        return "a" * 40

    def tree(self, *, depth: int, include_tags: bool = False) -> dagger.Directory:
        return cast(dagger.Directory, FakeDirectory())


class FakeGitRepository:
    def branch(self, _: str) -> FakeGitRef:
        return FakeGitRef()

    def commit(self, _: str) -> FakeGitRef:
        return FakeGitRef()


class FakeFoundation:
    def green_main(self, **_: object) -> FakeGreenEvidence:
        return FakeGreenEvidence()

    def guard(self, **_: object) -> dagger.Container:
        return cast(dagger.Container, FakeContainer())

    def source(self, **_: object) -> dagger.Directory:
        return cast(dagger.Directory, FakeDirectory())

    def envelope(self, *_: object) -> dagger.Directory:
        return cast(dagger.Directory, FakeDirectory())

    def verify_envelope(self, *_: object) -> dagger.Directory:
        return cast(dagger.Directory, FakeDirectory())


class FakeGreenEvidence:
    async def serialization(self) -> str:
        return json.dumps(
            {
                "branch": "main",
                "commit_sha": "a" * 40,
                "repository": "hseshadr/edge-reco",
                "run_attempt": 1,
                "workflow_run_id": "1",
            }
        )


class FakeDeployment:
    async def deployment_id(self) -> str:
        return VALID_DEPLOYMENT_ID


class FakeCloudflarePages:
    async def preflight(self, *_: object) -> str:
        return "preflight"

    def deploy(self, *_: object) -> dagger.CloudflarePagesDeploymentEvidence:
        return cast(dagger.CloudflarePagesDeploymentEvidence, FakeDeployment())

    def verify(self, *_: object) -> dagger.CloudflarePagesDeploymentEvidence:
        return cast(dagger.CloudflarePagesDeploymentEvidence, FakeDeployment())


class FakeDag:
    def container(self, *, platform: dagger.Platform | None = None) -> FakeContainer:
        return FakeContainer()

    def git(self, _: str) -> FakeGitRepository:
        return FakeGitRepository()

    def cache_volume(self, _: str) -> object:
        return object()

    def cloudflare_pages(self) -> FakeCloudflarePages:
        return FakeCloudflarePages()

    def directory(self) -> FakeDirectory:
        return FakeDirectory()

    def http(self, _: str, *, checksum: str) -> dagger.File:
        return cast(dagger.File, object())

    def foundation(self) -> FakeFoundation:
        return FakeFoundation()


def _evidence_output(**changes: str) -> str:
    evidence = {
        "workflow_suffixes": ".yml,.yaml",
        "actionlint": "passed",
        "runtime_canary": "passed",
        "snapshot_gitleaks": "passed",
        "history_gitleaks": "passed",
        "source_inventory": "1" * 64,
        "manifest": "2" * 64,
        "retains_git_history": "passed",
        "commit_sha": "a" * 40,
    }
    evidence.update(changes)
    return "\n".join(f"{key}={value}" for key, value in sorted(evidence.items()))


def _complete_evidence(commit_sha: str = "a" * 40) -> GuardEvidence:
    return parse_guard_evidence(_evidence_output(commit_sha=commit_sha))


def test_should_build_evidence_from_observed_success_records() -> None:
    # Given / When
    evidence = parse_guard_evidence(_evidence_output())

    # Then
    assert evidence == _complete_evidence()


def test_should_use_generated_foundation_guard_for_shared_shadow() -> None:
    # Given
    source = inspect.getsource(EdgeReco._shared_guard)

    # When / Then
    assert "dag.foundation().guard" in source
    assert "repository=REPOSITORY" in source
    assert "commit_sha=commit_sha" in source


def test_should_keep_local_guard_as_the_legacy_shadow() -> None:
    # Given
    source = inspect.getsource(EdgeReco._legacy_guard)

    # When / Then
    assert "self._legacy_workflow_security" in source
    assert "self._legacy_secret_scan" in source
    assert "dag.foundation" not in source


@pytest.mark.parametrize("commit_sha", ("c" * 39, "C" * 40))
def test_should_reject_abbreviated_or_noncanonical_shadow_sha(commit_sha: str) -> None:
    # Given / When / Then
    with pytest.raises(ValueError, match="lowercase 40-character Git SHA"):
        EdgeReco._require_sha(commit_sha)


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("workflow_suffixes", ".yml"),
        ("source_inventory", "3" * 64),
        ("manifest", "4" * 64),
        ("commit_sha", "b" * 40),
    ),
)
def test_should_fail_closed_for_every_required_guard_semantic(field: str, value: str) -> None:
    # Given
    legacy = _complete_evidence()
    shared = parse_guard_evidence(_evidence_output(**{field: value}))

    # When / Then
    with pytest.raises(GuardParityError, match=field):
        require_guard_parity(legacy, shared)


@pytest.mark.parametrize(
    "field",
    (
        "actionlint",
        "runtime_canary",
        "snapshot_gitleaks",
        "history_gitleaks",
        "retains_git_history",
    ),
)
def test_should_reject_each_failed_predecessor_before_evidence_construction(field: str) -> None:
    # Given / When / Then
    with pytest.raises(GuardParityError):
        parse_guard_evidence(_evidence_output(**{field: "failed"}))


@pytest.mark.parametrize("output", ("unexpected=value", "actionlint=passed\nactionlint=passed"))
def test_should_reject_missing_duplicate_or_unexpected_guard_evidence(output: str) -> None:
    # Given / When / Then
    with pytest.raises(GuardParityError):
        parse_guard_evidence(output)


@pytest.mark.parametrize(
    "field",
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
    ),
)
def test_should_reject_each_omitted_observed_evidence_field(field: str) -> None:
    # Given
    lines = [line for line in _evidence_output().splitlines() if not line.startswith(f"{field}=")]

    # When / Then
    with pytest.raises(GuardParityError):
        parse_guard_evidence("\n".join(lines))


@pytest.mark.parametrize(
    "stderr",
    (
        "guard-canary-detected\nguard-snapshot-nonempty\n",
        "guard-canary-detected\nguard-snapshot-nonempty\nguard-history-verified\nguard-history-verified\n",
        "guard-canary-detected\nguard-snapshot-nonempty\nguard-history-broken\n",
    ),
)
def test_should_reject_missing_or_malformed_guard_markers(stderr: str) -> None:
    # Given / When / Then
    with pytest.raises(GuardParityError, match="markers"):
        EdgeReco._guard_markers(stderr)


def test_should_accept_each_required_guard_marker_once() -> None:
    # Given
    stderr = "guard-canary-detected\nguard-snapshot-nonempty\nguard-history-verified\n"

    # When
    markers = EdgeReco._guard_markers(stderr)

    # Then
    assert markers == frozenset(("guard-canary-detected", "guard-snapshot-nonempty", "guard-history-verified"))


class RecordingFoundation:
    def __init__(self, bound: dagger.Directory) -> None:
        self.bound = bound
        self.guard_source: dagger.Directory | None = None

    def source(self, **_: object) -> dagger.Directory:
        return self.bound

    def guard(self, *, source: dagger.Directory, **_: object) -> dagger.Container:
        self.guard_source = source
        if source is not self.bound:
            raise GuardParityError("tampered caller source reached Foundation.guard")
        return cast(dagger.Container, FakeContainer())


class RecordingDag:
    def __init__(self, foundation: RecordingFoundation) -> None:
        self.recording_foundation = foundation

    def git(self, _: str) -> FakeGitRepository:
        return FakeGitRepository()

    def foundation(self) -> RecordingFoundation:
        return self.recording_foundation


def test_should_bind_the_exact_foundation_source_to_the_shared_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given
    caller = cast(dagger.Directory, FakeDirectory())
    bound = cast(dagger.Directory, FakeDirectory())
    foundation = RecordingFoundation(bound)
    edge_reco = EdgeReco.__new__(EdgeReco)
    monkeypatch.setattr(main_module, "dag", RecordingDag(foundation))

    async def executed(_: dagger.Container, __: dagger.Directory, ___: dagger.Directory, ____: str) -> GuardEvidence:
        return _complete_evidence()

    monkeypatch.setattr(edge_reco, "_executed_evidence", executed)

    # When
    asyncio.run(edge_reco._shared_evidence(caller, "a" * 40))

    # Then
    assert foundation.guard_source is bound
    assert foundation.guard_source is not caller


@pytest.mark.skipif(os.getenv("DAGGER_REAL_PARITY") != "1", reason="set DAGGER_REAL_PARITY=1 for the real guard")
def test_should_pass_real_dagger_shadow_parity() -> None:
    # Given
    root = Path(__file__).parents[2]
    environment = {**os.environ, "DAGGER_NO_NAG": "1"}
    dagger_binary = shutil.which("dagger")
    assert dagger_binary is not None

    # When
    result = subprocess.run(  # noqa: S603 -- the resolved local Dagger executable is the test subject.
        [dagger_binary, "call", "workflow-security", "stdout"], cwd=root, env=environment, check=False, text=True
    )

    # Then
    assert result.returncode == 0


@pytest.mark.skipif(os.getenv("DAGGER_REAL_PARITY") != "1", reason="set DAGGER_REAL_PARITY=1 for pinned runtime probes")
def test_should_distinguish_newline_backslash_content_and_mode_in_pinned_runtime(tmp_path: Path) -> None:
    # Given
    docker = shutil.which("docker")
    assert docker is not None
    first, second, backslash = tmp_path / "first", tmp_path / "second", tmp_path / "backslash"
    first.mkdir()
    second.mkdir()
    backslash.mkdir()
    (first / "a\nz").write_text("same"), (first / "b").write_text("same")
    (second / "a").write_text("same"), (second / "b\nz").write_text("same")
    (backslash / "a\\nz").write_text("same"), (backslash / "b").write_text("same")

    # When
    first_digests = _pinned_runtime_digests(docker, first)
    second_digests = _pinned_runtime_digests(docker, second)
    backslash_digests = _pinned_runtime_digests(docker, backslash)
    (second / "a").write_text("different")
    changed_digests = _pinned_runtime_digests(docker, second)
    (second / "a").chmod(0o755)
    executable_digests = _pinned_runtime_digests(docker, second)

    # Then
    assert first_digests != second_digests
    assert first_digests != backslash_digests
    assert second_digests != changed_digests
    assert changed_digests != executable_digests
    assert changed_digests[1] != executable_digests[1]


def _pinned_runtime_digests(docker: str, source: Path) -> tuple[str, str]:
    command = [docker, "run", "--rm", "-e", "DIGEST_ONLY=1", "-v", f"{source}:/snapshot:ro"]
    command += [PYTHON_IMAGE, "python", "-c", EVIDENCE_RUNTIME_SCRIPT]
    result = subprocess.run(command, check=True, capture_output=True, text=True)  # noqa: S603 -- fixed image/runtime regression.
    values = dict(line.split("=", maxsplit=1) for line in result.stdout.splitlines())
    return values["inventory"], values["manifest"]


def test_should_build_every_shadow_guard_path_with_typed_graph_inputs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    edge_reco = EdgeReco.__new__(EdgeReco)
    edge_reco.source = cast(dagger.Directory, FakeDirectory())
    monkeypatch.setattr(main_module, "dag", FakeDag())
    secret = cast(dagger.Secret, object())

    async def evidence_pair(_: dagger.Directory, __: str) -> tuple[GuardEvidence, GuardEvidence]:
        evidence = _complete_evidence()
        return evidence, evidence

    monkeypatch.setattr(edge_reco, "_guard_evidence_pair", evidence_pair)

    # When
    edge_reco.backend_quality(), edge_reco.backend_audit(), edge_reco.parity()
    edge_reco.frontend_quality(), edge_reco.browser_e2e(), edge_reco.frontend_audit()
    asyncio.run(edge_reco.workflow_security()), asyncio.run(edge_reco.secret_scan())
    edge_reco.build("a" * 40), edge_reco.release_preflight("a" * 40), edge_reco.codeql()
    asyncio.run(edge_reco.security()), asyncio.run(edge_reco.codeql_upload(secret, "a" * 40))
    asyncio.run(edge_reco.verify_live("a" * 40)), asyncio.run(edge_reco.deploy(secret, secret, secret))

    # Then
    assert edge_reco.codeql_sarif() is not None
