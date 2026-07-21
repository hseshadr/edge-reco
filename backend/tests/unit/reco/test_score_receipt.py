"""The ranking attestation: EdgeReco's pinned weights sealed as an Avow Assay
weighted-composite ``ScoreReceipt`` at publish time.

These tests pin the three properties the browser demo (and any offline auditor)
relies on: the receipt reproduces byte-for-byte for identical weights + fixtures,
it verifies offline under the pinned publisher key, and it is *governed by* exactly
the ``ranking_config.json`` weights (a tampered weight changes ``metric_version``
and the signature). Cross-language verification (TS ``@edgeproc/avow``) is proven
by the frontend suite replaying the fixture this module emits.
"""

from __future__ import annotations

import json

import pytest
from avow import content_hash, generate_signing_key, public_key_hex, verify_signature
from avow.errors import ReplayMismatch, SignatureInvalid
from nacl.signing import SigningKey

from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, ScoringWeights
from edgereco.reco.score_receipt import (
    RANKING_RECEIPT_NAME,
    ranking_request,
    sign_ranking_receipt,
    signing_key_from_seed,
)

_SEED = b"\x07" * 32


def _key() -> SigningKey:
    return SigningKey(_SEED)


def test_receipt_reproduces_byte_identically() -> None:
    """Same weights + same key → byte-identical receipt (deterministic Ed25519)."""
    first = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    second = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    assert first.model_dump_json() == second.model_dump_json()


def test_receipt_verifies_offline_under_pinned_key() -> None:
    key = _key()
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, key)
    verify_signature(receipt, expected_public_key=public_key_hex(key))


def test_receipt_metric_version_is_governed_by_weights() -> None:
    """``metric_version`` is the content hash of the governing weights."""
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    governed = content_hash(DEFAULT_RANKING_CONFIG.scoring_weights.model_dump(mode="json"))
    assert receipt.payload.metric_version == governed
    assert receipt.payload.metric == "weighted_composite"


def test_tampered_weight_changes_receipt() -> None:
    """A single retuned weight yields a different governed version and receipt."""
    retuned = DEFAULT_RANKING_CONFIG.model_copy(
        update={
            "scoring_weights": ScoringWeights(
                popularity=0.41,
                category=0.20,
                tag=0.15,
                brand=0.10,
                freshness=0.10,
                repetition_penalty=0.25,
            )
        }
    )
    base = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    other = sign_ranking_receipt(retuned, _key())
    assert base.payload.metric_version != other.payload.metric_version
    assert base.signature != other.signature


def test_wrong_pinned_key_fails_closed() -> None:
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    stranger = public_key_hex(generate_signing_key())
    with pytest.raises(SignatureInvalid):
        verify_signature(receipt, expected_public_key=stranger)


def test_tampered_payload_fails_closed() -> None:
    key = _key()
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, key)
    forged = receipt.model_copy(
        update={
            "payload": receipt.payload.model_copy(update={"score": receipt.payload.score + 0.1})
        }
    )
    with pytest.raises(ReplayMismatch):
        verify_signature(forged, expected_public_key=public_key_hex(key))


def test_composite_uses_only_positive_weight_signals() -> None:
    """The composite parts are exactly the governed signals with a positive weight."""
    request = ranking_request(DEFAULT_RANKING_CONFIG)
    names = {s.name for s in request.subscores}
    assert names == {"popularity", "category", "tag", "brand", "freshness"}
    assert len(request.subscores) >= 3
    for sub in request.subscores:
        assert sub.weight > 0
        assert sub.low <= sub.value <= sub.high
        assert sub.scale_min < sub.scale_max


def test_receipt_carries_composite_interval_and_parts() -> None:
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    payload = receipt.payload
    assert payload.composite is not None
    assert {p.name for p in payload.composite.parts} == {
        "popularity",
        "category",
        "tag",
        "brand",
        "freshness",
    }
    assert payload.interval_low <= payload.score <= payload.interval_high


def test_signing_key_from_seed_roundtrips(tmp_path: object) -> None:
    """A 32-byte raw ed25519 seed file yields the bundle's signing identity."""
    from pathlib import Path

    assert isinstance(tmp_path, Path)
    key = generate_signing_key()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(bytes(key))
    loaded = signing_key_from_seed(key_path)
    assert public_key_hex(loaded) == public_key_hex(key)


def test_emitted_receipt_is_valid_json_fixture() -> None:
    """The on-disk shape a browser fetches: a JSON object with the signed fields."""
    receipt = sign_ranking_receipt(DEFAULT_RANKING_CONFIG, _key())
    doc = json.loads(receipt.model_dump_json())
    assert set(doc) >= {"payload", "payload_hash", "public_key", "signature"}
    assert RANKING_RECEIPT_NAME == "ranking_receipt.json"
