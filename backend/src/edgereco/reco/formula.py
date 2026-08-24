"""Assay's exact ordered representation of EdgeReco's runtime score."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from assay import AdditiveRequest, AdditiveTerm, Operation, ScoreResult, compose

from edgereco.reco.ranking_config import ScoringWeights

FORMULA_METHOD_VERSION: Final[str] = "edgereco.recommendation-v3"
_TERM_IDENTITIES: Final[tuple[tuple[str, str, Operation], ...]] = (
    ("retrieval", "Retrieval", Operation.ADD),
    ("popularity", "Popularity", Operation.ADD),
    ("category_match", "Category match", Operation.ADD),
    ("tag_match", "Tag match", Operation.ADD),
    ("brand_match", "Brand match", Operation.ADD),
    ("freshness", "Freshness", Operation.ADD),
    ("similarity", "Similarity", Operation.ADD),
    ("cooccurrence", "Cooccurrence", Operation.ADD),
    ("repetition_penalty", "Repetition penalty", Operation.SUBTRACT),
)


@dataclass(frozen=True)
class FormulaSignals:
    """Native signal values consumed by the ordered ranking formula."""

    retrieval: float
    popularity: float
    category_match: float
    tag_match: float
    brand_match: float
    freshness: float
    similarity: float
    cooccurrence: float
    repetition_penalty: float

    def values(self) -> tuple[float, ...]:
        """Return native values in the runtime's declared evaluation order."""
        return (
            self.retrieval,
            self.popularity,
            self.category_match,
            self.tag_match,
            self.brand_match,
            self.freshness,
            self.similarity,
            self.cooccurrence,
            self.repetition_penalty,
        )


def _coefficients(weights: ScoringWeights) -> tuple[float, ...]:
    return (
        1.0,
        weights.popularity,
        weights.category,
        weights.tag,
        weights.brand,
        weights.freshness,
        weights.similarity,
        weights.cooccurrence,
        weights.repetition_penalty,
    )


def _term(identity: tuple[str, str, Operation], value: float, coefficient: float) -> AdditiveTerm:
    identifier, label, operation = identity
    return AdditiveTerm(
        id=identifier,
        label=label,
        value=value,
        coefficient=coefficient,
        operation=operation,
        interval=None,
    )


def formula_request(signals: FormulaSignals, weights: ScoringWeights) -> AdditiveRequest:
    """Build the exact left-to-right formula executed in both runtimes."""
    terms = tuple(
        _term(identity, value, coefficient)
        for identity, value, coefficient in zip(
            _TERM_IDENTITIES, signals.values(), _coefficients(weights), strict=True
        )
    )
    return AdditiveRequest(
        method="additive",
        method_version=FORMULA_METHOD_VERSION,
        terms=terms,
        clamp=None,
        intercept=0.0,
    )


def explain_score(signals: FormulaSignals, weights: ScoringWeights) -> ScoreResult:
    """Compose the live score and its typed contribution explanation with Assay."""
    return compose(formula_request(signals, weights))
