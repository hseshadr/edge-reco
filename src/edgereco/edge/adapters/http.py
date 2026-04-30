"""HTTP catalog adapter for edge/CDN servers."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urljoin

import httpx

from edgereco.catalog.models import CatalogManifest


class HttpAdapter:
    def __init__(
        self,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._timeout = timeout
        self._transport = transport

    def fetch_manifest(self, base_url: str) -> CatalogManifest:
        with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
            response = client.get(base_url)
            response.raise_for_status()
            return CatalogManifest.model_validate(response.json())

    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None:
        url = urljoin(base_url.rstrip("/") + "/", path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=self._timeout, transport=self._transport) as client, \
             client.stream("GET", url) as response:
            response.raise_for_status()
            with local_path.open("wb") as f:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)
