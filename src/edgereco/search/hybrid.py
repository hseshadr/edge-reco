"""Reciprocal Rank Fusion — now provided by EdgeProc (the shared local-execution lego).

This module re-exports ``reciprocal_rank_fusion`` from ``edge-proc[localvec]`` so
edge-reco consumes the shared implementation instead of carrying its own copy.
"""

from __future__ import annotations

from edgeproc.localvec.fusion import reciprocal_rank_fusion

__all__ = ["reciprocal_rank_fusion"]
