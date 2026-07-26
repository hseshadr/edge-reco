"""Deterministic, license-clean product-card images baked into the signed bundle.

The Nimbus demo ships product images INSIDE the signed, offline catalog bundle.
Remote CDN images (the raw Amazon URLs) would leak every visitor's IP on page
load and break the "one signed file, then zero backend calls" promise, so each
product is rendered here as a small, tasteful SVG card derived purely from the
product's own fields. Same catalog in -> byte-identical SVGs out (no timestamps,
no randomness), so the bundle hash stays stable.

Seam: ``generate_product_image`` is the single, swappable renderer. A future
license-clean *raster* localizer can replace it behind this exact signature
without touching the publish or serve paths.
"""

from __future__ import annotations

import hashlib
import re
from xml.sax.saxutils import escape, quoteattr

from .models import Product

_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")
_FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

#: Tasteful two-stop gradients, chosen deterministically per category. Muted,
#: high-contrast-with-white palette so the card reads as intentional editorial art.
_PALETTE: tuple[tuple[str, str], ...] = (
    ("#4f46e5", "#7c3aed"),
    ("#0ea5e9", "#2563eb"),
    ("#059669", "#0d9488"),
    ("#d97706", "#dc2626"),
    ("#db2777", "#9d174d"),
    ("#0891b2", "#0e7490"),
    ("#7c3aed", "#c026d3"),
    ("#ea580c", "#b45309"),
    ("#16a34a", "#65a30d"),
    ("#e11d48", "#be123c"),
)


def _require_safe_id(product_id: str) -> str:
    """Reject anything that could escape the ``images/`` dir or a URL path."""
    if not _SAFE_ID.match(product_id):
        raise ValueError(f"unsafe product id for an image path: {product_id!r}")
    return product_id


def image_relpath(product_id: str) -> str:
    """Bundle-relative path for a product's card (staged + covered by the signature)."""
    return f"images/{_require_safe_id(product_id)}.svg"


def local_image_url(product_id: str) -> str:
    """Root-relative same-origin URL the SPA renders (passes ``isLocalImage``)."""
    return f"/images/{_require_safe_id(product_id)}.svg"


def _gradient(category: str) -> tuple[str, str]:
    digest = hashlib.sha256(category.strip().lower().encode("utf-8")).digest()
    return _PALETTE[digest[0] % len(_PALETTE)]


def _monogram_source(product: Product) -> str:
    return (product.brand or product.category or product.title).strip()


def _monogram(product: Product) -> str:
    words = _monogram_source(product).split()[:2]
    initials = "".join(word[0] for word in words if word)
    return escape(initials.upper() or "•")


def _price_text(product: Product) -> str:
    if product.price is None:
        return ""
    symbol = "$" if product.currency == "USD" else f"{escape(product.currency)} "
    return f"{symbol}{product.price:.2f}"


def _wrap(text: str, *, width: int = 22, max_lines: int = 3) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        if lines and len(lines[-1]) + 1 + len(word) <= width:
            lines[-1] = f"{lines[-1]} {word}"
        else:
            lines.append(word)
    return _clamp(lines, max_lines)


def _clamp(lines: list[str], max_lines: int) -> list[str]:
    if len(lines) <= max_lines:
        return lines
    kept = lines[:max_lines]
    kept[-1] = f"{kept[-1][:20].rstrip()}…"
    return kept


def _title_tspans(title: str) -> str:
    lines = _wrap(title) or ["Product"]
    return "".join(
        f'<tspan x="60" dy="{0 if i == 0 else 46}">{escape(line)}</tspan>'
        for i, line in enumerate(lines)
    )


def generate_product_image(product: Product) -> str:
    """Render one product as a deterministic, self-contained SVG card."""
    start, end = _gradient(product.category)
    grad_id = f"g{hashlib.sha256(product.category.strip().lower().encode()).hexdigest()[:8]}"
    body = "".join(
        (
            _defs(grad_id, start, end),
            f'<rect width="600" height="600" fill="url(#{grad_id})"/>',
            _monogram_badge(product),
            _category_label(product),
            _title_block(product),
            _footer(product),
        )
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" '
        f'width="600" height="600" role="img" aria-label={quoteattr(product.title)}>'
        f"{body}</svg>"
    )


def _defs(grad_id: str, start: str, end: str) -> str:
    return (
        f'<defs><linearGradient id="{grad_id}" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{start}"/>'
        f'<stop offset="1" stop-color="{end}"/></linearGradient></defs>'
    )


def _monogram_badge(product: Product) -> str:
    return (
        '<circle cx="300" cy="212" r="96" fill="#ffffff" fill-opacity="0.16"/>'
        f'<text x="300" y="212" font-family="{_FONT}" font-size="96" '
        'font-weight="700" fill="#ffffff" text-anchor="middle" '
        f'dominant-baseline="central">{_monogram(product)}</text>'
    )


def _category_label(product: Product) -> str:
    return (
        f'<text x="300" y="70" font-family="{_FONT}" font-size="24" '
        'letter-spacing="3" fill="#ffffff" fill-opacity="0.85" '
        f'text-anchor="middle">{escape(product.category.upper())}</text>'
    )


def _title_block(product: Product) -> str:
    return (
        f'<text x="60" y="392" font-family="{_FONT}" font-size="38" '
        f'font-weight="600" fill="#ffffff">{_title_tspans(product.title)}</text>'
    )


def _footer(product: Product) -> str:
    brand = (
        f'<text x="60" y="548" font-family="{_FONT}" font-size="26" '
        f'fill="#ffffff" fill-opacity="0.9">{escape(product.brand)}</text>'
        if product.brand
        else ""
    )
    price = _price_text(product)
    price_el = (
        f'<text x="540" y="548" font-family="{_FONT}" font-size="34" '
        f'font-weight="700" fill="#ffffff" text-anchor="end">{price}</text>'
        if price
        else ""
    )
    rule = '<line x1="60" y1="500" x2="540" y2="500" stroke="#ffffff" stroke-opacity="0.35"/>'
    return f"{rule}{brand}{price_el}"
