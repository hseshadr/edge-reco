"""The Dagger deploy function must resolve and release current green main."""

from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_MODULE = _ROOT / ".dagger" / "src" / "edge_reco" / "main.py"


def _source() -> str:
    return _MODULE.read_text(encoding="utf-8")


def test_should_resolve_main_at_execution_time() -> None:
    source = _source()
    assert '.branch("main")' in source
    assert "commit = await remote.commit()" in source


def test_should_require_successful_dagger_run_for_exact_main() -> None:
    source = _source()
    assert "actions/workflows/dagger.yml/runs?head_sha={commit}" in source
    assert 'select(.conclusion=="success")' in source


def test_should_build_the_exact_resolved_remote_tree() -> None:
    source = _source()
    assert ".commit(commit_sha).tree(depth=0)" in source
    assert "artifact = self._build_source(source, commit_sha)" in source


def test_should_mount_the_built_directory_without_exporting_it() -> None:
    source = _source()
    assert 'with_directory("/artifact", artifact)' in source
    assert "export(" not in source


def test_should_disable_cloudflare_git_before_direct_upload() -> None:
    source = _source()
    disable = "await self._disable_git_deployments"
    upload = "await self._deploy_artifact"
    assert disable in source
    assert source.index(disable) < source.index(upload)
    assert '"production_deployments_enabled":false' in source
    assert '"preview_deployment_setting":"none"' in source
    assert "| curl -fsS -X PATCH --config -" in source
    assert 'curl -fsS -X PATCH -H "Authorization' not in source


def test_should_use_writable_api_response_scratch_paths() -> None:
    source = _source()
    assert source.count("mktemp -d") == 2
    assert "/work/runs.json" not in source
    assert "/work/project.json" not in source
