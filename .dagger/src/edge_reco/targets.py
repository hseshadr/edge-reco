"""Validated delivery target for EdgeReco's public Pages release."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Self

_PRODUCTION_VALUES: Final = ("hseshadr/edge-reco", "edge-reco", "main", "edge-reco.com")


@dataclass(frozen=True)
class EdgeRecoTarget:
    """The sole permitted repository, Pages project, branch, and domain."""

    repository: str
    project: str
    branch: str
    domain: str

    def __post_init__(self) -> None:
        if (self.repository, self.project, self.branch, self.domain) != _PRODUCTION_VALUES:
            raise ValueError("EdgeReco delivery target must use the validated production values")

    @classmethod
    def production(cls) -> Self:
        """Return the immutable production delivery target."""
        return cls(*_PRODUCTION_VALUES)
