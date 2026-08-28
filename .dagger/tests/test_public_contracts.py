"""Behavioral contracts for EdgeReco's public release graph."""

from __future__ import annotations

import inspect
import json
import re
import tomllib
from pathlib import Path
from typing import cast

import dagger
import pytest

from edge_reco.main import EdgeReco

FOUNDATION_SHA = "2f4e5e67573be2c7a157871f40da48e187f30285"


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


def test_should_bind_edge_reco_repository_pages_and_domain() -> None:
    # Given
    from edge_reco.targets import EdgeRecoTarget

    # When
    target = EdgeRecoTarget.production()
    # Then
    assert target.repository == "hseshadr/edge-reco"
    assert target.project == "edge-reco"
    assert target.branch == "main"
    assert target.domain == "edge-reco.com"


def test_should_reject_mismatched_delivery_target_tuple() -> None:
    # Given
    from edge_reco.targets import EdgeRecoTarget

    # When / Then
    with pytest.raises(ValueError, match="validated production values"):
        EdgeRecoTarget("hseshadr/another-repository", "edge-reco", "main", "edge-reco.com")


def test_should_reject_unvalidated_repository_override() -> None:
    # Given
    deploy = inspect.signature(EdgeReco.deploy)
    # Then
    assert "repository" not in deploy.parameters


def test_should_actionlint_yml_and_yaml() -> None:
    # Given
    source = inspect.getsource(EdgeReco._legacy_workflow_security)
    # Then
    assert "*.yml" in source
    assert "*.yaml" in source


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
    module = inspect.getmodule(EdgeReco)
    # Then
    assert module is not None
    module_source = inspect.getsource(module)
    assert "ghp_" not in module_source


def test_should_pin_foundation_to_literal_central_sha() -> None:
    # Given
    config = json.loads((Path(__file__).parents[2] / "dagger.json").read_text())
    dependency = next(item for item in config.get("dependencies", ()) if item["name"] == "foundation")

    # When
    source = dependency["source"]
    pin = dependency["pin"]

    # Then
    assert config["engineVersion"] == "v0.21.8"
    assert source == f"github.com/hseshadr/ci/modules/portfolio-foundation@{FOUNDATION_SHA}"
    assert pin == FOUNDATION_SHA
    assert re.fullmatch(r"[0-9a-f]{40}", pin)


def test_should_enforce_the_complete_dagger_quality_gate() -> None:
    # Given
    project = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    tasks = project["tool"]["poe"]["tasks"]

    # When
    gate = tuple(tasks["gate"])

    # Then
    assert project["tool"]["coverage"]["run"]["branch"] is True
    assert any(item.startswith("pytest-cov") for item in project["dependency-groups"]["dev"])
    assert gate == ("lint", "typecheck", "complexity", "test", "branchrate")
    assert "--cov-branch" in tasks["test"]
    assert "--cov-fail-under=90" in tasks["test"]
