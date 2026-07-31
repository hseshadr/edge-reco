"""Localize a product's REAL photo at build time so the browser never calls a CDN.

WHY THIS EXISTS: the storefront ships ``img-src 'self' data:``, so a remote product
photo cannot render at all — and if it could, every visitor's IP would be handed to
that CDN on page load, which is precisely what "runs on your device" promises not to
do. The fix is to download each photo ONCE, at build time, and serve it from our own
origin. Runtime third-party requests stay at zero.

TRUST BOUNDARY: these bytes come from an untrusted third party and are written into a
SIGNED bundle. A ``Content-Type`` header is a claim, not evidence — only the magic
bytes decide what a file is — and the download is size-capped so one hostile response
can neither exhaust the build nor bloat the bundle. Remote SVG is refused outright:
it is XML that can carry script, and nothing scriptable should ever sit behind our
signature. The locally GENERATED placeholder card is a separate, trusted path.

FAILURE POLICY: degrade, never fail the build. A 404, a timeout, a redirect to an
error page, an oversized body — each yields ``None`` for that one product, and the
caller falls back to the generated card. One dead url must not break a 720-product
catalog.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

import httpx

#: Hard cap per photo. Comfortably above a ~400px product shot, far below anything
#: that would bloat the signed bundle or stall the build.
MAX_IMAGE_BYTES: Final[int] = 2 * 1024 * 1024

#: Magic-byte signature -> file extension. Raster formats every browser renders; no
#: SVG, no anything that can execute.
_SIGNATURES: Final[tuple[tuple[bytes, str, str], ...]] = (
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"RIFF", "webp", "image/webp"),
)

#: Amazon renders a size into the path (``._AC_SL1500_.jpg``). Asking for a smaller
#: rendition of the SAME public asset is how that CDN is designed to be used — it is
#: not a bypass of anything, and it is what keeps the localized set to a sane size.
_SIZE_TOKEN: Final[re.Pattern[str]] = re.compile(
    r"\._([A-Z]*_?[A-Z]{2})\d{2,4}_\.(jpg|jpeg|png)$", re.IGNORECASE
)


class NotAnImageError(ValueError):
    """The bytes are not a raster image we accept, whatever the response claimed."""


class ImageTooLargeError(ValueError):
    """The body exceeded ``MAX_IMAGE_BYTES``."""


@dataclass(frozen=True)
class ProductPhoto:
    """A validated, ready-to-stage product photo."""

    body: bytes
    extension: str


def validated_extension(content_type: str, body: bytes) -> str:
    """Return the extension for ``body``, or raise if it is not an acceptable image.

    The declared ``content_type`` must AGREE with the magic bytes; neither alone is
    enough. That is what stops an error page, a polyglot, or a mislabelled payload
    from being written into the signed bundle.
    """
    if len(body) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError(f"{len(body)} bytes exceeds the {MAX_IMAGE_BYTES}-byte cap")
    declared = content_type.split(";")[0].strip().lower()
    for magic, extension, mime in _SIGNATURES:
        if body.startswith(magic) and declared == mime:
            return extension
    raise NotAnImageError(f"declared {declared!r}, leading bytes {body[:8]!r}")


def preview_url(url: str, max_px: int) -> str:
    """Ask the CDN for a card-sized rendition; unchanged when there is no size token."""
    return _SIZE_TOKEN.sub(
        lambda m: f"._{m.group(1)}{max_px}_.{m.group(2)}",
        url,
    )


def fetch_product_photo(
    client: httpx.Client, url: str, *, max_px: int = 400
) -> ProductPhoto | None:
    """Download and validate one product photo. ``None`` means "use the placeholder".

    Never raises: every failure mode a hostile or merely broken origin can produce is
    collapsed to ``None`` so a single bad url cannot fail the whole build.
    """
    if not url.startswith("https://"):
        return None
    try:
        response = client.get(preview_url(url, max_px), follow_redirects=True)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        extension = validated_extension(response.headers.get("content-type", ""), response.content)
    except (NotAnImageError, ImageTooLargeError):
        return None
    return ProductPhoto(body=response.content, extension=extension)
