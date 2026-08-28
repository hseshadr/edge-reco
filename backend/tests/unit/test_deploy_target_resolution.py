"""The Dagger deploy function must resolve and release current green main."""

from __future__ import annotations

import ast
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_MODULE = _ROOT / ".dagger" / "src" / "edge_reco" / "main.py"
_CLOUDFLARE = _ROOT / ".dagger" / "scripts" / "cloudflare-pages.sh"


def _source() -> str:
    return _MODULE.read_text(encoding="utf-8")


def _cloudflare_source() -> str:
    return _CLOUDFLARE.read_text(encoding="utf-8")


def _is_target_attribute(node: ast.AST, attribute: str) -> bool:
    if not isinstance(node, ast.Attribute) or not isinstance(node.value, ast.Name):
        return False
    return node.value.id == "target" and node.attr == attribute


def _is_target_repository_git_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
        return False
    repository = (_is_target_attribute(value, "repository") for value in ast.walk(node))
    return node.func.attr == "git" and any(repository)


def _green_main_uses_validated_target() -> bool:
    tree = ast.parse(_source())
    methods = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_green_main"
    ]
    assert len(methods) == 1
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "branch"
        and len(node.args) == 1
        and _is_target_attribute(node.args[0], "branch")
        and _is_target_repository_git_call(node.func.value)
        for node in ast.walk(methods[0])
    )


def test_should_resolve_validated_target_at_deploy_execution_time() -> None:
    # Given
    uses_validated_target = _green_main_uses_validated_target()
    # When
    commit = "commit = await remote.commit()"
    # Then
    assert uses_validated_target
    assert commit in _source()


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
    cloudflare = _cloudflare_source()
    disable = "await self._disable_git_deployments"
    upload = "await self._deploy_artifact"
    assert disable in source
    assert source.index(disable) < source.index(upload)
    assert '"production_deployments_enabled":false' in cloudflare
    assert '"preview_deployment_setting":"none"' in cloudflare
    assert "curl -sS --config -" in cloudflare
    assert "--fail-with-body" in cloudflare
    assert 'curl -sS -H "Authorization' not in cloudflare


def test_should_use_writable_api_response_scratch_paths() -> None:
    source = _source()
    cloudflare = _cloudflare_source()
    assert "mktemp -d" in source
    assert cloudflare.count("mktemp") == 2
    assert re.search(r"/work(?:/|\b)", source) is None
    assert re.search(r"/work(?:/|\b)", cloudflare) is None


def test_should_bound_exact_pages_api_verification() -> None:
    cloudflare = _cloudflare_source()
    assert "?env=production" in cloudflare
    assert ".deployment_trigger.metadata.commit_hash == $sha" in cloudflare
    assert '.latest_stage.status == "success"' in cloudflare
    assert "DEPLOY_VERIFY_TIMEOUT_SECONDS" in cloudflare
    assert 'sleep "$delay"' in cloudflare
    assert "exit 1" in cloudflare
