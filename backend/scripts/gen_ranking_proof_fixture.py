"""Generate the deterministic Python-to-browser ranking proof fixture.

The fixed seed is test-only. Production catalog publication always loads the
maintainer key supplied to ``edgereco publish`` and must never reuse this seed.

Run from ``backend/``::

    uv run python scripts/gen_ranking_proof_fixture.py
"""

from __future__ import annotations

import json
from pathlib import Path

from nacl.signing import SigningKey

from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG
from edgereco.reco.score_receipt import sign_ranking_receipt

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
FIXTURE = (
    REPO_ROOT / "frontend/packages/edgeproc-browser/src/engine/__fixtures__/ranking_proof_v1.json"
)
TEST_SEED = b"\x07" * 32


def main() -> None:
    """Write one stable Avow envelope containing EdgeReco's static proof."""
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, SigningKey(TEST_SEED))
    rendered = json.dumps(json.loads(receipt.model_dump_json(by_alias=True)), indent="\t")
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(rendered + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(REPO_ROOT)} ({FIXTURE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
