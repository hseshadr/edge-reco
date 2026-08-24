"""The parity-fixture comparison must tolerate float noise and NOTHING else.

Byte-exact ``git diff`` was the wrong test for float data: it went red on ~1e-7
*relative* drift in ``score`` / embedding values — the signature of a different
BLAS thread count or SIMD path on the runner, not a ranking change. The
replacement (``scripts/compare_parity_fixtures.py``) must therefore be loose in
exactly one dimension and strict everywhere else, so these tests pin BOTH sides:

* the drift it must now absorb (sub-tolerance float wobble), and
* every real change it must still reject — ids, counts, ordering, array
  lengths, key sets, and type flips.

A tolerance check that cannot fail is worse than the byte-exact one it replaced.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.compare_parity_fixtures import (
    ABS_TOL,
    REL_TOL,
    Tolerance,
    compare_files,
    main,
)

_FIXTURE_DIR = (
    Path(__file__).resolve().parents[3]
    / "frontend/packages/edgeproc-browser/src/engine/__fixtures__"
)
_TOL = Tolerance(rel_tol=REL_TOL, abs_tol=ABS_TOL)

# A miniature stand-in shaped like the real fixtures: an int dimension, an int k,
# a string id, a float score, a nested float vector, a bool and a null.
_DOC: dict[str, object] = {
    "embedding_dim": 384,
    "k": 3,
    "normalized": True,
    "note": None,
    # Magnitudes mirror the real fixtures: ordinary components, the smallest
    # genuinely meaningful one (~1e-08), and a float32-underflow value (~1e-34).
    "query_vector": [0.5, -0.25, 1.1692e-08, 1.57e-34],
    "expected": [
        {"id": "sku-1", "score": 0.4947266},
        {"id": "sku-2", "score": 0.3812012},
    ],
}


def _write(tmp_path: Path, name: str, doc: object) -> Path:
    target = tmp_path / name
    target.write_text(json.dumps(doc, indent="\t") + "\n", encoding="utf-8")
    return target


def _pair(tmp_path: Path, candidate: object) -> list[str]:
    """Compare the canonical doc (baseline) against a mutated candidate."""
    baseline = _write(tmp_path, "baseline.json", _DOC)
    return compare_files(baseline, _write(tmp_path, "candidate.json", candidate), _TOL)


def _mutate(**overrides: object) -> dict[str, object]:
    return {**_DOC, **overrides}


def test_identical_documents_match(tmp_path: Path) -> None:
    assert _pair(tmp_path, json.loads(json.dumps(_DOC))) == []


def test_float_perturbed_within_tolerance_matches(tmp_path: Path) -> None:
    """The exact failure mode that made this script necessary: ~1e-7 relative."""
    nudged = [
        {"id": "sku-1", "score": 0.4947266 * (1 + 1e-7)},
        {"id": "sku-2", "score": 0.3812012 * (1 - 1e-7)},
    ]
    assert _pair(tmp_path, _mutate(expected=nudged)) == []


def test_float32_embedding_platform_noise_matches(tmp_path: Path) -> None:
    """ARM and x86 ONNX reductions can differ by one or two float32 ULPs."""
    baseline = _write(tmp_path, "baseline.json", {"value": -0.06862691044807434})
    candidate = _write(tmp_path, "candidate.json", {"value": -0.06862699240446091})
    assert compare_files(baseline, candidate, _TOL) == []


def test_float_perturbed_beyond_tolerance_fails(tmp_path: Path) -> None:
    """1e-4 relative is 100x the tolerance — a real scoring change, not noise."""
    nudged = [
        {"id": "sku-1", "score": 0.4947266 * (1 + 1e-4)},
        {"id": "sku-2", "score": 0.3812012},
    ]
    problems = _pair(tmp_path, _mutate(expected=nudged))
    assert len(problems) == 1
    assert "$.expected[0].score" in problems[0]
    assert "outside tolerance" in problems[0]


def test_near_zero_float_noise_is_absorbed_by_abs_tol(tmp_path: Path) -> None:
    """Embedding vectors underflow to ~1e-34; a relative test there fails on pure noise.

    1.57e-34 -> 5.66e-33 is a 36x RELATIVE change that rel_tol alone would reject;
    abs_tol absorbs it because both values are numerically zero.
    """
    drifted = [0.5, -0.25, 1.1692e-08, 5.66e-33]
    assert _pair(tmp_path, _mutate(query_vector=drifted)) == []


def test_near_zero_float_beyond_abs_tol_still_fails(tmp_path: Path) -> None:
    """abs_tol must not become a blanket amnesty: the 1e-8 component is still guarded."""
    problems = _pair(tmp_path, _mutate(query_vector=[0.5, -0.25, 1.1692e-06, 1.57e-34]))
    assert len(problems) == 1
    assert "$.query_vector[2]" in problems[0]


def test_changed_id_string_fails(tmp_path: Path) -> None:
    changed = [{"id": "sku-9", "score": 0.4947266}, {"id": "sku-2", "score": 0.3812012}]
    problems = _pair(tmp_path, _mutate(expected=changed))
    assert len(problems) == 1
    assert "$.expected[0].id" in problems[0]
    assert "value changed" in problems[0]


def test_changed_int_count_fails(tmp_path: Path) -> None:
    """Ints (k, dims, counts) get no tolerance at all — 3 -> 4 is a hard failure."""
    problems = _pair(tmp_path, _mutate(k=4))
    assert problems == ["$.k: value changed (baseline=3, candidate=4)"]


def test_int_is_never_compared_with_tolerance(tmp_path: Path) -> None:
    """384 -> 385 is 0.26% relative — well outside rel_tol, but the point is it is an int."""
    problems = _pair(tmp_path, _mutate(embedding_dim=385))
    assert len(problems) == 1
    assert "$.embedding_dim" in problems[0]


def test_reordered_list_fails(tmp_path: Path) -> None:
    """Comparison is index-wise: swapping two ranked hits is ranking drift."""
    reordered = [{"id": "sku-2", "score": 0.3812012}, {"id": "sku-1", "score": 0.4947266}]
    problems = _pair(tmp_path, _mutate(expected=reordered))
    assert len(problems) == 4
    assert all("$.expected[" in problem for problem in problems)


def test_different_list_length_fails(tmp_path: Path) -> None:
    truncated = [{"id": "sku-1", "score": 0.4947266}]
    problems = _pair(tmp_path, _mutate(expected=truncated))
    assert problems == ["$.expected: array length changed (baseline='len=2', candidate='len=1')"]


def test_added_dict_key_fails(tmp_path: Path) -> None:
    extra = [{"id": "sku-1", "score": 0.4947266, "rank": 0}, {"id": "sku-2", "score": 0.3812012}]
    problems = _pair(tmp_path, _mutate(expected=extra))
    assert len(problems) == 1
    assert "object key set changed" in problems[0]


def test_removed_dict_key_fails(tmp_path: Path) -> None:
    missing = dict(_DOC)
    del missing["k"]
    problems = _pair(tmp_path, missing)
    assert len(problems) == 1
    assert "object key set changed" in problems[0]


def test_float_to_int_type_change_fails(tmp_path: Path) -> None:
    """0.4947266 -> 0 must be reported as a TYPE change, never tolerated as near-zero."""
    flipped = [{"id": "sku-1", "score": 0}, {"id": "sku-2", "score": 0.3812012}]
    problems = _pair(tmp_path, _mutate(expected=flipped))
    assert len(problems) == 1
    assert "type changed (float -> int)" in problems[0]


def test_int_to_float_type_change_fails(tmp_path: Path) -> None:
    problems = _pair(tmp_path, _mutate(k=3.0))
    assert problems == ["$.k: type changed (int -> float) (baseline=3, candidate=3.0)"]


def test_bool_is_not_treated_as_int(tmp_path: Path) -> None:
    """``bool`` is an ``int`` subclass in Python — True must not equal 1."""
    problems = _pair(tmp_path, _mutate(normalized=1))
    assert problems == ["$.normalized: type changed (bool -> int) (baseline=True, candidate=1)"]


def test_null_to_string_type_change_fails(tmp_path: Path) -> None:
    problems = _pair(tmp_path, _mutate(note="hello"))
    assert len(problems) == 1
    assert "type changed (null -> str)" in problems[0]


def test_scalar_to_container_type_change_fails(tmp_path: Path) -> None:
    problems = _pair(tmp_path, _mutate(k=[3]))
    assert len(problems) == 1
    assert "type changed (int -> list)" in problems[0]


@pytest.mark.parametrize(
    "name",
    [
        "search_parity.json",
        "cooccurrence_parity.json",
        "strategy_parity.json",
        "embedding_parity.json",
        "hybrid_parity.json",
    ],
)
def test_committed_fixture_matches_itself(name: str) -> None:
    """Non-vacuity anchor: the real fixtures parse and compare clean against themselves."""
    fixture = _FIXTURE_DIR / name
    assert compare_files(fixture, fixture, _TOL) == []


def _perturb(value: object, factor: float) -> object:
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return value * factor
    if isinstance(value, dict):
        return {key: _perturb(item, factor) for key, item in value.items()}
    if isinstance(value, list):
        return [_perturb(item, factor) for item in value]
    return value


def test_real_fixture_survives_sub_tolerance_drift(tmp_path: Path) -> None:
    """Every float in the real search fixture nudged by 1e-7 relative still matches."""
    fixture = _FIXTURE_DIR / "search_parity.json"
    drifted = _perturb(json.loads(fixture.read_text(encoding="utf-8")), 1 + 1e-7)
    assert compare_files(fixture, _write(tmp_path, "drifted.json", drifted), _TOL) == []


def test_real_fixture_rejects_super_tolerance_drift(tmp_path: Path) -> None:
    """The same fixture nudged by 1e-3 relative is rejected — the gate still has teeth."""
    fixture = _FIXTURE_DIR / "search_parity.json"
    drifted = _perturb(json.loads(fixture.read_text(encoding="utf-8")), 1 + 1e-3)
    assert compare_files(fixture, _write(tmp_path, "drifted.json", drifted), _TOL) != []


def test_main_exits_zero_on_matching_pair(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    baseline = _write(tmp_path, "baseline.json", _DOC)
    candidate = _write(tmp_path, "candidate.json", _DOC)
    assert main(["--pair", str(baseline), str(candidate)]) == 0
    assert "MATCH" in capsys.readouterr().out


def test_main_exits_nonzero_and_reports_every_mismatch(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    baseline = _write(tmp_path, "baseline.json", _DOC)
    candidate = _write(tmp_path, "candidate.json", _mutate(k=4))
    assert main(["--pair", str(baseline), str(candidate)]) == 1
    captured = capsys.readouterr()
    assert "DRIFT" in captured.out
    assert "$.k: value changed" in captured.out
    assert "1 mismatch" in captured.err


def test_main_compares_several_pairs_in_one_invocation(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    good = _write(tmp_path, "good.json", _DOC)
    bad = _write(tmp_path, "bad.json", _mutate(k=4))
    argv = ["--pair", str(good), str(good), "--pair", str(good), str(bad)]
    assert main(argv) == 1
    lines = capsys.readouterr().out.splitlines()
    assert len([line for line in lines if line.startswith("MATCH ")]) == 1
    assert len([line for line in lines if line.startswith("DRIFT ")]) == 1


def test_main_honors_a_looser_rel_tol(tmp_path: Path) -> None:
    """The tolerance is a knob, not a constant baked into the walk."""
    baseline = _write(tmp_path, "baseline.json", {"score": 0.5})
    candidate = _write(tmp_path, "candidate.json", {"score": 0.5 * (1 + 1e-4)})
    argv = ["--pair", str(baseline), str(candidate)]
    assert main(argv) == 1
    assert main([*argv, "--rel-tol", "1e-3"]) == 0
