"""Behavioral contracts for EdgeReco's public release graph."""

from __future__ import annotations

import inspect
from pathlib import Path
from typing import cast

import dagger

from edge_reco.main import EdgeReco


class RecordingWorkspace:
    """Record the source selection made by the module constructor."""

    def __init__(self) -> None:
        self.path = ""

    def directory(self, path: str, **_options: object) -> dagger.Directory:
        self.path = path
        return cast(dagger.Directory, object())


def test_should_select_explicit_root_directory_when_module_is_constructed() -> None:
    # Given
    workspace = RecordingWorkspace()
    # When
    EdgeReco.create(cast(dagger.Workspace, workspace))
    # Then
    assert workspace.path == "/"


def test_should_require_typed_workspace_when_module_is_constructed() -> None:
    # Given
    signature = inspect.signature(EdgeReco.create, eval_str=True)
    # When
    workspace = signature.parameters.get("workspace")
    # Then
    assert workspace is not None
    assert workspace.annotation is dagger.Workspace


def test_should_expose_typed_build_artifact_contract() -> None:
    # Given
    build = inspect.signature(EdgeReco.build, eval_str=True)
    # When
    commit = build.parameters.get("commit_sha")
    # Then
    assert commit is not None
    assert commit.annotation is str
    assert build.return_annotation is dagger.Directory


def test_should_require_typed_secrets_when_deploying_exact_artifact() -> None:
    # Given
    deploy = inspect.signature(EdgeReco.deploy, eval_str=True)
    # When
    secret_types = {
        name: deploy.parameters[name].annotation
        for name in ("cloudflare_api_token", "cloudflare_account_id", "github_token")
    }
    # Then
    assert set(secret_types.values()) == {dagger.Secret}


def test_should_expose_security_and_live_release_functions() -> None:
    # Given
    expected = {
        "secret_scan",
        "codeql",
        "codeql_sarif",
        "codeql_upload",
        "release_preflight",
        "verify_live",
    }
    # When
    available = {name for name in expected if hasattr(EdgeReco, name)}
    # Then
    assert available == expected


def test_should_run_bundled_codeql_code_scanning_queries() -> None:
    # Given
    script = (Path(__file__).parents[1] / "scripts/codeql-analysis.sh").read_text()
    # Then
    assert "/opt/codeql/codeql database analyze" in script
    assert "--format=sarifv2.1.0" in script
    assert "--download" not in script
    assert "codeql/javascript" not in script


def test_should_not_commit_a_secret_shaped_gitleaks_canary() -> None:
    # Given
    module_source = inspect.getsource(inspect.getmodule(EdgeReco))
    # Then
    assert "ghp_" not in module_source
