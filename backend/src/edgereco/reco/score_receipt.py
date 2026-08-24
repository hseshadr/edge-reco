"""Static ranking proof: Assay formula probes sealed once with Avow."""

from __future__ import annotations

from pathlib import Path
from typing import Final, Literal

from assay import ScoreResult
from avow import content_hash, load_signing_key, sign_payload
from nacl.signing import SigningKey
from pydantic import BaseModel, ConfigDict, Field

from edgereco.reco.formula import FormulaSignals, explain_score
from edgereco.reco.ranking_config import RankingConfig, ScoringWeights

RANKING_RECEIPT_NAME: Final[str] = "ranking_receipt.json"
RANKING_PROOF_SCHEMA: Final[Literal["edgereco.ranking-proof/v1"]] = "edgereco.ranking-proof/v1"
_SHA256_PATTERN: Final[str] = r"^sha256:[0-9a-f]{64}$"
_PROBE_SIGNALS: Final[FormulaSignals] = FormulaSignals(
    retrieval=0.0,
    popularity=0.7,
    category_match=0.6,
    tag_match=0.8,
    brand_match=0.5,
    freshness=0.4,
    similarity=0.9,
    cooccurrence=0.3,
    repetition_penalty=1.0,
)


class FormulaProbe(BaseModel):
    """One deterministic Assay replay for a runtime scoring profile."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    result: ScoreResult


class RankingProof(BaseModel):
    """EdgeReco-owned signed statement about one full ranking configuration."""

    model_config = ConfigDict(frozen=True, extra="forbid", serialize_by_alias=True)

    schema_version: Literal["edgereco.ranking-proof/v1"] = Field(alias="schema")
    ranking_config_hash: str = Field(pattern=_SHA256_PATTERN)
    formula_probes: tuple[FormulaProbe, ...]


class RankingReceipt(BaseModel):
    """Avow's portable v1 wire envelope around the ranking proof."""

    model_config = ConfigDict(frozen=True, extra="forbid", serialize_by_alias=True)

    receipt_schema: Literal["avow.receipt/v1"] = Field(alias="schema")
    payload: RankingProof
    payload_hash: str = Field(pattern=_SHA256_PATTERN)
    public_key: str
    signature: str


def _probe(identifier: str, weights: ScoringWeights) -> FormulaProbe:
    return FormulaProbe(id=identifier, result=explain_score(_PROBE_SIGNALS, weights))


def _config_hash(config: RankingConfig) -> str:
    return content_hash(config.model_dump(mode="json"))


def _utf16_sort_key(identifier: str) -> bytes:
    """Match JavaScript string ordering for portable probe arrays."""
    return identifier.encode("utf-16-be")


def build_ranking_proof(config: RankingConfig) -> RankingProof:
    """Build search plus every strategy probe from the full signed config."""
    probes: tuple[FormulaProbe, ...] = (_probe("search", config.scoring_weights),)
    probes += tuple(
        _probe(strategy_id, config.strategies[strategy_id].weights)
        for strategy_id in sorted(config.strategies, key=_utf16_sort_key)
    )
    return RankingProof(
        schema=RANKING_PROOF_SCHEMA,
        ranking_config_hash=_config_hash(config),
        formula_probes=probes,
    )


def sign_ranking_receipt(config: RankingConfig, signing_key: SigningKey) -> RankingReceipt:
    """Seal only the static proof; personalized ranking results are never signed."""
    signed = sign_payload(build_ranking_proof(config), signing_key)
    return RankingReceipt(
        schema="avow.receipt/v1",
        payload=signed.payload,
        payload_hash=signed.payload_hash,
        public_key=signed.public_key,
        signature=signed.signature,
    )


def signing_key_from_seed(path: Path) -> SigningKey:
    """Load the publisher's raw Ed25519 seed for the shared bundle identity."""
    return load_signing_key(path)
