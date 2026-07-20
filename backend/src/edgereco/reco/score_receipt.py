"""The ranking attestation: the bundle's scoring weights sealed as a signed
Assay weighted-composite receipt (``ranking_receipt.json``).

Why: the weights in ``ranking_config.json`` govern every recommendation a shopper
sees. The bundle signature already covers that file's *bytes*; this receipt
additionally seals the weights' *content hash* as the composite's
``metric_version`` and replays the weighted formula over a fixed golden fixture,
so any offline verifier — the browser demo, or a cold reader holding the
publisher's public key — can confirm both WHICH weights governed ranking and that
the composite math reproduces. Signing happens once at publish time (never in the
per-request scoring loop), with the SAME Ed25519 seed that signs the bundle: one
publisher identity, one pinned key.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from assay import composite_score
from assay.models import CompositeRequest, SubScoreInput
from assay.receipt import ScoreReceipt
from avow import content_hash, load_signing_key
from nacl.signing import SigningKey

from edgereco.reco.ranking_config import RankingConfig, ScoringWeights

#: The receipt's filename inside the signed bundle (beside ``ranking_config.json``).
RANKING_RECEIPT_NAME: Final[str] = "ranking_receipt.json"

#: Fixed golden signal levels, each on the formula's native 0..1 scale. The values
#: are deliberately DISTINCT so every weight influences the attested composite
#: differently — retuning any single weight changes the receipt's score, not only
#: its governed hash. ``repetition_penalty`` is absent by design: ``score_product``
#: subtracts it, and a weighted composite attests the positive contributions.
_GOLDEN_SIGNALS: Final[dict[str, float]] = {
    "popularity": 0.8,
    "category": 0.6,
    "tag": 0.4,
    "brand": 0.5,
    "freshness": 0.7,
    "similarity": 0.9,
    "cooccurrence": 0.3,
}


def governed_version(weights: ScoringWeights) -> str:
    """Content hash of the governing weights — the receipt's ``metric_version``."""
    return content_hash(weights.model_dump(mode="json"))


def _subscore(name: str, value: float, weight: float) -> SubScoreInput:
    """One golden subscore: a degenerate interval (deterministic replay — no
    fabricated uncertainty) on the signal's native 0..1 scale."""
    return SubScoreInput(
        name=name,
        value=value,
        low=value,
        high=value,
        scale_min=0.0,
        scale_max=1.0,
        weight=weight,
    )


def ranking_request(config: RankingConfig) -> CompositeRequest:
    """The attestation request: one subscore per positively-weighted additive signal.

    Signals weighted 0 (``similarity`` / ``cooccurrence`` outside vector and
    co-occurrence strategies) contribute nothing to the formula and are omitted,
    so the receipt's parts are exactly the signals that can move a score.
    """
    weights = config.scoring_weights
    subscores = tuple(
        _subscore(name, value, getattr(weights, name))
        for name, value in _GOLDEN_SIGNALS.items()
        if getattr(weights, name) > 0
    )
    return CompositeRequest(metric_version=governed_version(weights), subscores=subscores)


def sign_ranking_receipt(config: RankingConfig, signing_key: SigningKey) -> ScoreReceipt:
    """Seal ``config``'s weights into a signed, offline-verifiable score receipt."""
    return composite_score(ranking_request(config), signing_key=signing_key)


def signing_key_from_seed(path: Path) -> SigningKey:
    """The bundle publisher's raw Ed25519 seed file as an avow signing key.

    ``publish_bundle`` signs the bundle with a raw 32-byte Ed25519 seed
    (edge-proc ``Ed25519Signer.from_private_bytes``); pynacl accepts the same
    seed bytes, so the ranking receipt shares the bundle's publisher identity —
    verifiers pin ONE public key for both.
    """
    return load_signing_key(path)
