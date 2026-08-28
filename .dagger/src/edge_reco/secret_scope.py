"""One-time, fail-closed relay from repository to environment secrets."""

from __future__ import annotations

import os
from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Literal, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from nacl.public import PublicKey, SealedBox
from pydantic import BaseModel, ConfigDict, Field

GITHUB_API_ORIGIN: Final = "https://api.github.com"
ENVIRONMENT_PATH: Final = "/repos/hseshadr/edge-reco/environments/production/secrets"
SECRET_NAMES: Final[tuple[str, str]] = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
HTTP_TIMEOUT_SECONDS: Final = 30


class SecretScopeError(RuntimeError):
    """Report a sanitized production secret migration failure."""


@dataclass(frozen=True)
class SecretValues:
    """Opaque values required by the one-time migration boundary."""

    github_admin_token: str
    cloudflare_api_token: str
    cloudflare_account_id: str


class PublicKeyPayload(BaseModel):  # type: ignore[explicit-any]  # Pydantic v2 stub base
    """Strict GitHub environment public-key response."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    key_id: str = Field(min_length=1)
    key: str = Field(min_length=1)


class EncryptedSecretPayload(BaseModel):  # type: ignore[explicit-any]  # Pydantic v2 stub base
    """Strict GitHub environment-secret update payload."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    encrypted_value: str = Field(min_length=1)
    key_id: str = Field(min_length=1)


class SecretTransport(Protocol):
    """Minimal GitHub environment-secret transport."""

    def public_key(self) -> PublicKeyPayload: ...

    def put_secret(self, name: str, payload: EncryptedSecretPayload) -> None: ...


@dataclass(frozen=True)
class HttpRequest:
    """One fully projected GitHub API request."""

    method: Literal["GET", "PUT"]
    url: str
    headers: Mapping[str, str]
    body: bytes | None = None


class HttpClient(Protocol):
    """External HTTP execution boundary."""

    def send(self, request: HttpRequest) -> bytes: ...


class UrllibClient:
    """Execute one bounded GitHub API request without response logging."""

    def send(self, request: HttpRequest) -> bytes:
        _require_github_url(request.url)
        outgoing = Request(  # noqa: S310 - URL was restricted to the fixed GitHub HTTPS origin
            request.url, data=request.body, headers=dict(request.headers), method=request.method
        )
        try:
            with urlopen(outgoing, timeout=HTTP_TIMEOUT_SECONDS) as response:  # noqa: S310 - validated HTTPS origin
                return cast(bytes, response.read())
        except HTTPError as error:
            raise SecretScopeError(f"GitHub secret API request failed with HTTP {error.code}") from error
        except (TimeoutError, URLError) as error:
            raise SecretScopeError("GitHub secret API transport failed") from error


def _require_github_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "api.github.com" or parsed.query or parsed.fragment:
        raise SecretScopeError("GitHub secret API URL is not authorized")


@dataclass(frozen=True)
class GitHubEnvironmentTransport:
    """Write only fixed EdgeReco production environment secrets."""

    token: str
    client: HttpClient

    def public_key(self) -> PublicKeyPayload:
        request = HttpRequest("GET", f"{GITHUB_API_ORIGIN}{ENVIRONMENT_PATH}/public-key", self._headers())
        return PublicKeyPayload.model_validate_json(self.client.send(request))

    def put_secret(self, name: str, payload: EncryptedSecretPayload) -> None:
        if name not in SECRET_NAMES:
            raise SecretScopeError("environment secret name is not authorized")
        request = HttpRequest("PUT", f"{GITHUB_API_ORIGIN}{ENVIRONMENT_PATH}/{name}", self._headers(), _body(payload))
        self.client.send(request)

    def _headers(self) -> Mapping[str, str]:
        values = {"Accept": "application/vnd.github+json", "Authorization": f"Bearer {self.token}"}
        values["X-GitHub-Api-Version"] = "2022-11-28"
        return MappingProxyType(values)


def _required_secret(name: str) -> str:
    try:
        value = os.environ[name]
    except KeyError as error:
        raise SecretScopeError("required migration secret is missing") from error
    if not value.strip():
        raise SecretScopeError("required migration secret is missing")
    return value


def load_secret_values() -> SecretValues:
    """Load every secret without defaults or diagnostic disclosure."""
    return SecretValues(
        github_admin_token=_required_secret("GITHUB_ADMIN_TOKEN"),
        cloudflare_api_token=_required_secret("CLOUDFLARE_API_TOKEN"),
        cloudflare_account_id=_required_secret("CLOUDFLARE_ACCOUNT_ID"),
    )


def _public_key(payload: PublicKeyPayload) -> PublicKey:
    try:
        return PublicKey(b64decode(payload.key, validate=True))
    except (Base64Error, ValueError) as error:
        raise SecretScopeError("GitHub environment public key is malformed") from error


def _encrypted(value: str, public_key: PublicKeyPayload) -> EncryptedSecretPayload:
    ciphertext = SealedBox(_public_key(public_key)).encrypt(value.encode())
    return EncryptedSecretPayload(encrypted_value=b64encode(ciphertext).decode(), key_id=public_key.key_id)


def _body(payload: EncryptedSecretPayload) -> bytes:
    return payload.model_dump_json().encode()


def scope_secret_values(transport: SecretTransport, values: SecretValues) -> tuple[str, str]:
    """Encrypt and write both fixed Cloudflare environment secrets."""
    public_key = transport.public_key()
    secrets = tuple(zip(SECRET_NAMES, (values.cloudflare_api_token, values.cloudflare_account_id), strict=True))
    for name, value in secrets:
        transport.put_secret(name, _encrypted(value, public_key))
    return SECRET_NAMES


def run(client: HttpClient | None = None) -> tuple[str, str]:
    """Execute the complete no-output migration transaction."""
    values = load_secret_values()
    transport = GitHubEnvironmentTransport(values.github_admin_token, client or UrllibClient())
    return scope_secret_values(transport, values)


if __name__ == "__main__":
    run()
