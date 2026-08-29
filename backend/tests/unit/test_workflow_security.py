"""EdgeReco keeps thin workflow ingress while Foundation owns repository guards."""

from __future__ import annotations

from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parents[3]


def _load_workflow(name: str) -> dict[str, object]:
    document = yaml.safe_load((_ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def _dagger_source() -> str:
    path = _ROOT / ".dagger" / "src" / "edge_reco" / "main.py"
    return path.read_text(encoding="utf-8")


def test_should_delegate_repository_guard_to_exact_sha_foundation() -> None:
    # Given / When
    source = _dagger_source()

    # Then
    assert "dag.foundation().guard(" in source
    assert "def workflow_security(" in source
    assert "def secret_scan(" in source
    assert "_legacy" not in source


def test_should_keep_unprivileged_dagger_checks_free_of_release_credentials() -> None:
    # Given / When
    workflow = (_ROOT / ".github" / "workflows" / "dagger.yml").read_text(encoding="utf-8")
    job = workflow.split("  dagger:\n", 1)[1].split("\n  ", 1)[0]

    # Then
    assert "name: Dagger" in job
    assert "CLOUDFLARE_API_TOKEN" not in job
    assert "CLOUDFLARE_ACCOUNT_ID" not in job
    assert "security-events: write" not in job


def test_should_bind_the_protected_dagger_job_to_the_exact_checkout_sha() -> None:
    # Given / When
    workflow = _load_workflow("dagger.yml")
    steps = workflow["jobs"]["dagger"]["steps"]

    # Then
    assert steps[0]["with"] == {
        "fetch-depth": 0,
        "persist-credentials": False,
        "ref": "${{ github.sha }}",
    }
    assert steps[1]["with"] == {
        "version": "0.21.8",
        "call": "ci --commit-sha=${{ github.sha }}",
    }


def test_should_project_sarif_only_from_the_fork_guarded_privileged_job() -> None:
    workflow = (_ROOT / ".github" / "workflows" / "dagger.yml").read_text(encoding="utf-8")
    assert "security-events: write" in workflow
    assert "head.repo.full_name == github.repository" in workflow
    assert "codeql-upload" in workflow
    assert "--github-token=env:GITHUB_TOKEN" in workflow


def test_should_consolidate_manual_and_weekly_security_into_the_protected_dagger_job() -> None:
    # Given / When
    workflow = _load_workflow("dagger.yml")
    triggers = workflow[True]

    # Then
    assert triggers["workflow_dispatch"] is None
    assert triggers["schedule"] == [{"cron": "0 9 * * 1"}]
    assert workflow["permissions"] == {"contents": "read"}
    assert not (_ROOT / ".github" / "workflows" / "security-audit.yml").exists()


def test_should_call_deploy_without_repository_override() -> None:
    # Given / When
    workflow = _load_workflow("deploy.yml")
    call = workflow["jobs"]["deploy"]["steps"][1]["with"]["call"]

    # Then
    assert "--repository=" not in call
