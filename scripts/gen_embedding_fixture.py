"""Generate the C3a query-embedding parity fixture.

Embeds a small set of representative query/product strings with edge-reco's
``ProductEncoder`` (sentence-transformers ``all-MiniLM-L6-v2``, mean-pooled and
L2-normalized) and commits the resulting 384-d vectors as JSON. The TS parity
test embeds the same strings in-browser with transformers.js and asserts cosine
>= 0.99 against these vectors — proving the in-browser embedder reproduces the
Python sentence-transformers embedding the rest of the pipeline is built on.

Run from the repo root::

    .venv/bin/python3 scripts/gen_embedding_fixture.py
    (cd demo/frontend && npx biome check --write \
        src/engine/__fixtures__/embedding_parity.json)
"""

from __future__ import annotations

import json
from pathlib import Path

from edgeproc.localvec.encoder import TextEncoder

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (
    REPO_ROOT
    / "demo"
    / "frontend"
    / "src"
    / "engine"
    / "__fixtures__"
    / "embedding_parity.json"
)
DIM = 384

# Representative of the real query/product surface: short queries, a multi-word
# query, and a long real product title (truncated by the model's max length).
STRINGS = [
    "polo shirt",
    "men's running shoes",
    "cotton t-shirt",
    "moisture wicking golf polo",
    (
        "COOFANDY Men's Polo Shirts Short Sleeve Moisture Wicking Golf Shirt "
        "Fashion Casual Collared T-Shirt"
    ),
]


def main() -> None:
    encoder = TextEncoder("sentence-transformers/all-MiniLM-L6-v2")
    vectors = [encoder.encode_query(s) for s in STRINGS]
    if any(v.shape[0] != DIM for v in vectors):
        raise ValueError("unexpected embedding dimension")
    fixture = {
        "description": (
            "C3a query-embedding parity fixture: sentence-transformers "
            "all-MiniLM-L6-v2 (mean-pool + L2-norm) vectors for representative "
            "strings. The TS transformers.js embedder must match each at cosine "
            ">= 0.99. Regenerate with scripts/gen_embedding_fixture.py."
        ),
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "embedding_dim": DIM,
        "items": [
            {"text": s, "vector": v.tolist()} for s, v in zip(STRINGS, vectors, strict=True)
        ],
    }
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture, indent="\t") + "\n")
    print(f"wrote {FIXTURE.relative_to(REPO_ROOT)} ({FIXTURE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
