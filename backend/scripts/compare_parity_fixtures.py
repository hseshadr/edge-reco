"""Compare regenerated parity fixtures to their committed baseline, with float tolerance.

Why this exists
---------------
The parity fixtures under
``frontend/packages/edgeproc-browser/src/engine/__fixtures__/`` are regenerated in
CI and compared to the committed copies. That comparison used to be
``git diff --exit-code`` — a BYTE-exact test applied to float data. It went red
intermittently on ~1e-7 *relative* wobble in ``score`` / embedding values: the
signature of a different reduction order (BLAS thread count, SIMD path, runner
hardware), not of a ranking change. Two unrelated Dependabot PRs reproduced the
identical drift while pinning different toolchains, and the drift has already
been papered over once by re-committing the fixtures.

This script replaces that with a comparison that is loose in exactly one
dimension and strict in every other:

* **floats** -> ``math.isclose(rel_tol, abs_tol)``
* **everything else** -> exact. ``bool`` is checked before ``int`` (in Python
  ``bool`` IS an ``int``), ints (counts, dims, ``k``, shapes) never get
  tolerance, strings/nulls must be equal, object key SETS must be equal, array
  LENGTHS must be equal, arrays are walked strictly index-wise (so any
  reordering of ranked hits fails), and a type flip (``float`` -> ``int``,
  ``bool`` -> ``int``, ...) is a mismatch rather than something to tolerate.

Usage::

    python scripts/compare_parity_fixtures.py \\
        --pair BASELINE.json CANDIDATE.json \\
        [--pair BASELINE.json CANDIDATE.json ...] \\
        [--rel-tol 1e-6] [--abs-tol 2e-7]

Exit code 0 means every pair agreed within tolerance; a non-zero exit prints one
greppable ``MISMATCH <json path>: <why> (baseline=..., candidate=...)`` line per
difference.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

# Relative tolerance for float comparison.
#
# Chosen at ~10x headroom over the observed platform drift (~1e-7 relative on
# `score` values), while staying 3-4 ORDERS OF MAGNITUDE tighter than any
# genuine ranking/scoring change: a real logic change moves cosine scores in the
# 1e-3..1e-1 range, or changes ids / their order — and ids and ordering are
# compared exactly here, not with tolerance. So 1e-6 absorbs the noise this gate
# was failing on without being able to hide a real regression.
REL_TOL = 1e-6

# Absolute tolerance covers the observed ARM/x86 ONNX reduction drift. The
# largest measured component delta is 1.21e-7, so 2e-7 gives less than 2x
# headroom. Ranking ids/order and every non-float field remain exact, while a
# genuine score change (1e-3..1e-1) stays four or more orders of magnitude away.
ABS_TOL = 2e-7


@dataclass(frozen=True)
class Tolerance:
    """The two knobs handed to :func:`math.isclose` for every float comparison."""

    rel_tol: float
    abs_tol: float


# Ordered longest-match-first: `bool` MUST precede `int`, because `bool` is an
# `int` subclass and `isinstance(True, int)` is True. Without this ordering,
# `true` -> `1` in a fixture would silently pass as "same kind, equal value".
_KINDS: tuple[tuple[str, type], ...] = (
    ("bool", bool),
    ("int", int),
    ("float", float),
    ("str", str),
    ("null", type(None)),
    ("list", list),
    ("dict", dict),
)


def _kind(value: object) -> str:
    """Name the JSON kind of a parsed value (``bool`` before ``int``)."""
    for name, kind in _KINDS:
        if isinstance(value, kind):
            return name
    return type(value).__name__


def _mismatch(path: str, baseline: object, candidate: object, why: str) -> str:
    return f"{path}: {why} (baseline={baseline!r}, candidate={candidate!r})"


def _diff_float(baseline: object, candidate: object, path: str, tol: Tolerance) -> list[str]:
    """The ONE place tolerance is applied."""
    base, cand = cast(float, baseline), cast(float, candidate)
    if math.isclose(base, cand, rel_tol=tol.rel_tol, abs_tol=tol.abs_tol):
        return []
    why = f"float outside tolerance (|delta|={abs(cand - base):.6e})"
    return [_mismatch(path, base, cand, why)]


def _diff_exact(baseline: object, candidate: object, path: str, tol: Tolerance) -> list[str]:
    """bool / int / str / null: same kind already proven, so any change is real.

    ``tol`` is unused by design — it keeps the dispatch signature uniform.
    """
    del tol
    if baseline == candidate:
        return []
    return [_mismatch(path, baseline, candidate, "value changed")]


def _diff_dict(baseline: object, candidate: object, path: str, tol: Tolerance) -> list[str]:
    """Key SETS must match exactly; an added or removed key is a schema change."""
    base, cand = cast(dict[str, object], baseline), cast(dict[str, object], candidate)
    if base.keys() != cand.keys():
        return [_mismatch(path, sorted(base), sorted(cand), "object key set changed")]
    return [msg for key in base for msg in _diff(base[key], cand[key], f"{path}.{key}", tol)]


def _diff_list(baseline: object, candidate: object, path: str, tol: Tolerance) -> list[str]:
    """Strictly index-wise, so reordering ranked hits fails instead of matching."""
    base, cand = cast(list[object], baseline), cast(list[object], candidate)
    if len(base) != len(cand):
        why = "array length changed"
        return [_mismatch(path, f"len={len(base)}", f"len={len(cand)}", why)]
    pairs = enumerate(zip(base, cand, strict=True))
    return [msg for i, (b, c) in pairs for msg in _diff(b, c, f"{path}[{i}]", tol)]


_Differ = Callable[[object, object, str, Tolerance], list[str]]
_HANDLERS: dict[str, _Differ] = {
    "float": _diff_float,
    "dict": _diff_dict,
    "list": _diff_list,
}


def _diff(baseline: object, candidate: object, path: str, tol: Tolerance) -> list[str]:
    """Walk both documents in lockstep, returning one message per difference."""
    kind, other = _kind(baseline), _kind(candidate)
    if kind != other:
        return [_mismatch(path, baseline, candidate, f"type changed ({kind} -> {other})")]
    return _HANDLERS.get(kind, _diff_exact)(baseline, candidate, path, tol)


def compare_files(baseline: Path, candidate: Path, tol: Tolerance) -> list[str]:
    """Compare two fixture JSON documents. An empty list means they agree."""
    base = json.loads(baseline.read_text(encoding="utf-8"))
    cand = json.loads(candidate.read_text(encoding="utf-8"))
    return _diff(base, cand, "$", tol)


def _compare_pair(baseline: Path, candidate: Path, tol: Tolerance) -> list[str]:
    problems = compare_files(baseline, candidate, tol)
    print(f"{'DRIFT' if problems else 'MATCH'} {candidate}  (baseline: {baseline})")
    for problem in problems:
        print(f"  MISMATCH {problem}")
    return problems


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--pair",
        action="append",
        nargs=2,
        required=True,
        metavar=("BASELINE", "CANDIDATE"),
        help="a committed-baseline JSON path and the regenerated candidate to compare",
    )
    parser.add_argument("--rel-tol", type=float, default=REL_TOL)
    parser.add_argument("--abs-tol", type=float, default=ABS_TOL)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    tol = Tolerance(rel_tol=args.rel_tol, abs_tol=args.abs_tol)
    print(f"float tolerance: rel_tol={tol.rel_tol:g} abs_tol={tol.abs_tol:g} (all else exact)")
    pairs = [(Path(baseline), Path(candidate)) for baseline, candidate in args.pair]
    problems = [msg for baseline, cand in pairs for msg in _compare_pair(baseline, cand, tol)]
    if problems:
        print(f"\nFAIL: {len(problems)} mismatch(es) outside tolerance", file=sys.stderr)
        return 1
    print(f"\nOK: {len(pairs)} fixture(s) match within tolerance")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
