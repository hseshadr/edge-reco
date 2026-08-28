"""Behavioral tests for the one-time production secret relay."""

from __future__ import annotations

from base64 import b64decode, b64encode
from collections.abc import Mapping
from email.message import Message
from io import BytesIO
from pathlib import Path
from typing import cast
from urllib.error import HTTPError

import pytest
import yaml
from nacl.public import PrivateKey, SealedBox

from edge_reco.secret_scope import (
    EncryptedSecretPayload,
    GitHubEnvironmentTransport,
    HttpRequest,
    PublicKeyPayload,
    SecretScopeError,
    SecretValues,
    UrllibClient,
    load_secret_values,
    run,
    scope_secret_values,
)


class RecordingTransport:
    """Capture encrypted environment-secret writes at the HTTP boundary."""

    def __init__(self, public_key: PublicKeyPayload) -> None:
        self.public_key_value = public_key
        self.updates: list[tuple[str, EncryptedSecretPayload]] = []

    def public_key(self) -> PublicKeyPayload:
        return self.public_key_value

    def put_secret(self, name: str, payload: EncryptedSecretPayload) -> None:
        self.updates.append((name, payload))


class RecordingHttpClient:
    """Record exact requests while replacing only the external GitHub socket."""

    def __init__(self, public_key: PublicKeyPayload) -> None:
        self.response = public_key.model_dump_json().encode()
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> bytes:
        self.requests.append(request)
        return self.response if request.method == "GET" else b""


def _mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise AssertionError("workflow node must be a mapping")
    return cast(Mapping[str, object], value)


def _deploy_workflow() -> Mapping[str, object]:
    path = Path(__file__).parents[2] / ".github/workflows/deploy.yml"
    return _mapping(yaml.load(path.read_text(), Loader=yaml.BaseLoader))  # noqa: S506 - non-constructing loader


def test_should_fail_closed_when_a_required_secret_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given
    monkeypatch.setenv("GITHUB_ADMIN_TOKEN", "github-admin")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "cloudflare-api")
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)

    # When / Then
    with pytest.raises(SecretScopeError, match="required migration secret is missing"):
        load_secret_values()


def test_should_fail_closed_when_a_required_secret_is_only_whitespace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setenv("GITHUB_ADMIN_TOKEN", "github-admin")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "cloudflare-api")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "   ")

    # When / Then
    with pytest.raises(SecretScopeError, match="required migration secret is missing"):
        load_secret_values()


def test_should_encrypt_exact_cloudflare_values_before_environment_writes() -> None:
    # Given
    private_key = PrivateKey.generate()
    public_key = PublicKeyPayload(key_id="key-7", key=b64encode(bytes(private_key.public_key)).decode())
    transport = RecordingTransport(public_key)
    values = SecretValues("github-admin", "cloudflare-api-value", "cloudflare-account-value")

    # When
    names = scope_secret_values(transport, values)

    # Then
    assert names == ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    assert [name for name, _ in transport.updates] == list(names)
    decrypted = [
        SealedBox(private_key).decrypt(b64decode(payload.encrypted_value)).decode() for _, payload in transport.updates
    ]
    assert decrypted == ["cloudflare-api-value", "cloudflare-account-value"]
    assert all("cloudflare" not in payload.encrypted_value for _, payload in transport.updates)


def test_should_reject_any_environment_secret_name_outside_fixed_pair() -> None:
    # Given
    key = PublicKeyPayload(key_id="key-8", key=b64encode(bytes(PrivateKey.generate().public_key)).decode())
    transport = GitHubEnvironmentTransport("github-admin", RecordingHttpClient(key))
    payload = EncryptedSecretPayload(encrypted_value="ciphertext", key_id="key-8")

    # When / Then
    with pytest.raises(SecretScopeError, match="environment secret name is not authorized"):
        transport.put_secret("PORTFOLIO_PAT", payload)


def test_should_write_only_encrypted_values_to_fixed_production_endpoints(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Given
    private_key = PrivateKey.generate()
    key = PublicKeyPayload(key_id="key-9", key=b64encode(bytes(private_key.public_key)).decode())
    client = RecordingHttpClient(key)
    transport = GitHubEnvironmentTransport("github-admin", client)
    values = SecretValues("github-admin", "api-plaintext", "account-plaintext")

    # When
    names = scope_secret_values(transport, values)

    # Then
    assert names == ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    assert [request.method for request in client.requests] == ["GET", "PUT", "PUT"]
    assert client.requests[0].url == (
        "https://api.github.com/repos/hseshadr/edge-reco/environments/production/secrets/public-key"
    )
    assert [request.url.rsplit("/", 1)[-1] for request in client.requests[1:]] == list(names)
    assert all(request.headers["Authorization"] == "Bearer github-admin" for request in client.requests)
    serialized = b"".join(request.body or b"" for request in client.requests)
    assert b"api-plaintext" not in serialized and b"account-plaintext" not in serialized
    assert capsys.readouterr() == ("", "")


def test_should_sanitize_github_api_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given
    def fail_request(*_arguments: object, **_keywords: object) -> bytes:
        raise HTTPError("https://api.github.com", 403, "denied", Message(), BytesIO(b"api-plaintext"))

    monkeypatch.setattr("edge_reco.secret_scope.urlopen", fail_request)
    request = HttpRequest("GET", "https://api.github.com/test", {})

    # When / Then
    with pytest.raises(SecretScopeError, match="GitHub secret API request failed with HTTP 403") as caught:
        UrllibClient().send(request)
    assert "api-plaintext" not in str(caught.value)


def test_should_reject_non_github_url_before_network(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given
    def unexpected_request(*_arguments: object, **_keywords: object) -> bytes:
        raise AssertionError("network must not run")

    monkeypatch.setattr("edge_reco.secret_scope.urlopen", unexpected_request)
    request = HttpRequest("GET", "file:///tmp/secret", {})

    # When / Then
    with pytest.raises(SecretScopeError, match="GitHub secret API URL is not authorized"):
        UrllibClient().send(request)


def test_should_run_complete_relay_without_emitting_values(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Given
    private_key = PrivateKey.generate()
    key = PublicKeyPayload(key_id="key-11", key=b64encode(bytes(private_key.public_key)).decode())
    client = RecordingHttpClient(key)
    monkeypatch.setenv("GITHUB_ADMIN_TOKEN", "github-admin")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "api-value")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account-value")

    # When
    names = run(client)

    # Then
    assert names == ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    assert capsys.readouterr() == ("", "")


def test_should_offer_isolated_dagger_only_secret_scope_dispatch() -> None:
    # Given
    workflow = _deploy_workflow()

    # When
    dispatch = _mapping(_mapping(workflow["on"])["workflow_dispatch"])
    flag = _mapping(_mapping(dispatch["inputs"])["scope_production_secrets"])
    job = _mapping(_mapping(workflow["jobs"])["scope-production-secrets"])
    steps = cast(list[object], job["steps"])
    dagger_step = _mapping(steps[1])

    # Then
    assert flag["type"] == "boolean" and flag["default"] == "false"
    assert job["environment"] == "production"
    assert "inputs.scope_production_secrets" in cast(str, job["if"])
    assert "dagger/dagger-for-github@496f1b3d" in cast(str, dagger_step["uses"])
    assert "scope-production-secrets" in cast(str, _mapping(dagger_step["with"])["call"])
