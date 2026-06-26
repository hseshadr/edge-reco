"""Generate the committed synthetic demo session log for seed co-occurrence.

LABELED DEMO DATA — NOT real purchases. The static hosted demo runs no retrain, so
``examples/source/demo_sessions.jsonl`` ships a plausible set of co-purchase baskets
over the committed 720-product catalog. ``cooccurrence.py`` runs *real* co-occurrence
math on these, so "Customers also bought" rails are populated on edge-reco.com; a real
retrain regenerates the matrix from genuine events.

Baskets are **category-coherent**: each session draws 2-4 products from a single
category (shoppers browse within a category), with a few mixed cross-category baskets
for realism. Fully deterministic (fixed RNG seed) so the committed file is byte-stable.

Run from backend/::

    .venv/bin/python3 scripts/gen_demo_sessions.py
"""

from __future__ import annotations

import glob
import hashlib
import json
import random
from collections import defaultdict
from pathlib import Path

import zstandard as zstd

BACKEND_ROOT = Path(__file__).resolve().parent.parent
CATALOG = BACKEND_ROOT / "examples" / "catalog"
OUT = BACKEND_ROOT / "examples" / "source" / "demo_sessions.jsonl"
RNG_SEED = 1729
SESSION_COUNT = 120
MIXED_FRACTION = 0.15  # ~15% of baskets cross two categories
# Higher-intent events are rarer than clicks, mirroring a real funnel.
EVENT_TYPES = ["click", "click", "click", "view", "favorite", "cart"]


def _materialize(path: str) -> bytes:
    manifest = json.loads(Path(glob.glob(str(CATALOG / "manifest" / "*"))[0]).read_bytes())
    entry = next(f for f in manifest["files"] if f["path"] == path)
    dctx = zstd.ZstdDecompressor()
    parts = [dctx.decompress((CATALOG / "chunk" / r["hash"]).read_bytes()) for r in entry["chunks"]]
    blob = b"".join(parts)
    if hashlib.sha256(blob).hexdigest() != entry["file_sha256"]:
        raise ValueError(f"{path} failed reassembly check")
    return blob


def _ids_by_category() -> dict[str, list[str]]:
    """Group the committed catalog's product ids by category (sorted, deterministic)."""
    products = [json.loads(line) for line in _materialize("products.jsonl").splitlines() if line]
    grouped: dict[str, list[str]] = defaultdict(list)
    for product in products:
        grouped[product["category"]].append(product["id"])
    return {cat: sorted(ids) for cat, ids in sorted(grouped.items())}


def _basket(rng: random.Random, pool: list[str]) -> list[dict[str, str]]:
    """One basket: 2-4 distinct products from ``pool``, each with a weighted event."""
    size = rng.randint(2, min(4, len(pool)))
    chosen = rng.sample(pool, size)
    return [{"product_id": pid, "event_type": rng.choice(EVENT_TYPES)} for pid in chosen]


def _session_pool(rng: random.Random, by_cat: dict[str, list[str]]) -> list[str]:
    """A coherent pool: one category usually, two merged for a few mixed baskets."""
    categories = list(by_cat)
    primary = rng.choice(categories)
    if rng.random() < MIXED_FRACTION:
        secondary = rng.choice([c for c in categories if c != primary])
        return by_cat[primary] + by_cat[secondary]
    return by_cat[primary]


def main() -> None:
    by_cat = _ids_by_category()
    # Deterministic synthetic demo data — not security-sensitive, so stdlib random is fine.
    rng = random.Random(RNG_SEED)  # noqa: S311
    lines: list[str] = []
    for i in range(SESSION_COUNT):
        events = _basket(rng, _session_pool(rng, by_cat))
        lines.append(json.dumps({"session_id": f"demo-s{i:04d}", "events": events}))
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    rel = OUT.relative_to(BACKEND_ROOT)
    print(f"wrote {rel} ({SESSION_COUNT} sessions, {OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
