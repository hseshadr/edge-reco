"""The Dagger deploy function must resolve and release current green main."""

from __future__ import annotations

import ast
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_MODULE = _ROOT / ".dagger" / "src" / "edge_reco" / "main.py"
_WRANGLER_RELEASE = _ROOT / "frontend" / "app" / "scripts" / "wrangler-release.sh"


def _source() -> str:
    return _MODULE.read_text(encoding="utf-8")


def _wrangler_release_source() -> str:
    return _WRANGLER_RELEASE.read_text(encoding="utf-8")


def _async_method(name: str) -> ast.AsyncFunctionDef:
    tree = ast.parse(_source())
    methods = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == name
    ]
    assert len(methods) == 1
    return methods[0]


def _call_attributes(statement: ast.stmt) -> list[str]:
    return [
        node.func.attr
        for node in ast.walk(statement)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    ]


def _top_level_calls(name: str) -> list[list[str]]:
    return [
        calls for statement in _async_method(name).body if (calls := _call_attributes(statement))
    ]


def test_should_resolve_validated_target_at_deploy_execution_time() -> None:
    calls = _top_level_calls("deploy")
    assert calls[0] == ["_release_context"]
    assert calls[1] == ["_provider_request", "_build_source"]
    assert calls[2] == ["cloudflare_pages"]


def test_should_delegate_exact_green_main_to_shared_foundation() -> None:
    source = _source()
    assert "dag.foundation().green_main(" in source
    assert "github_token=github_token, repository=TARGET.repository" in source
    assert "parse_release_evidence(await evidence.serialization())" in source
    assert "actions/workflows/dagger.yml/runs?head_sha={commit}" not in source
    assert 'select(.conclusion=="success")' not in source


def test_should_build_the_exact_resolved_remote_tree() -> None:
    source = _source()
    assert ".commit(commit_sha).tree(depth=0, include_tags=True)" in source
    assert "self._build_source(context.source, context.commit_sha)" in source


def test_should_mount_the_built_directory_without_exporting_it() -> None:
    source = _source()
    assert 'with_directory("/artifact", artifact)' in source
    assert "export(" not in source


def test_should_not_retain_checkout_local_pages_mutation() -> None:
    # Given / When
    source = _wrangler_release_source()

    # Then
    assert "pages deploy /artifact" not in source


def test_should_delegate_only_after_shared_envelope_verification() -> None:
    source = _source()
    calls = _top_level_calls("deploy")
    assert calls[3] == ["_verify_request_envelope"]
    assert calls[4] == ["_deliver"]
    assert "dag.foundation().envelope(" in source
    assert "dag.foundation().verify_envelope(" in source
    assert "dag.cloudflare_pages()" in source
    assert "_disable_git_deployments" not in source
    assert "_deploy_artifact" not in source
    assert "_github_probe" not in source
    assert '"wrangler-release.sh", "deploy"' not in source


def test_should_materialize_verified_provider_deploy_before_local_live_verification() -> None:
    delivery = _top_level_calls("_deliver")
    deploy = _top_level_calls("deploy")
    assert delivery[0] == ["_provider_preflight"]
    assert delivery[1] == ["_provider_deploy"]
    assert delivery[2] == ["_provider_identity"]
    assert "_provider_verify" not in _source()
    assert deploy[5] == ["stdout", "_live_container"]
    assert deploy[6] == ["_deployment_result"]
