"""GitHub Actions must resolve third-party code from immutable commits.

Every ``uses:`` ref in ``.github/workflows`` must pin a full 40-hex commit SHA.
A moving tag (``@v7``) or branch (``@main``) lets whoever controls that upstream
ref run arbitrary code in this repo's CI. First-party refs (``hseshadr/...``)
get NO carve-out: a moving first-party tag nested under an OIDC publish workflow
is exactly how a live supply-chain hole once hid behind a green gate elsewhere
in this portfolio. Only ``./`` local actions (shipped in this commit) and
``docker://`` image refs (not git refs at all) are exempt by nature.
"""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_USES = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)", re.MULTILINE)
_PINNED = re.compile(r"^[\w.-]+/[\w.-]+(?:/[\w./-]+)?@[0-9a-f]{40}$")


def _is_immutable(action: str) -> bool:
    """``./`` actions ship in this commit; ``docker://`` refs are not git refs."""
    return action.startswith(("./", "docker://")) or _PINNED.fullmatch(action) is not None


def _audit(workflows: Path) -> tuple[list[str], int]:
    """Return (unpinned action refs, TOTAL action refs) across every workflow file.

    Globs ``*.yaml`` as well as ``*.yml``: GitHub Actions accepts both, so scanning
    only one extension lets a ``deploy.yaml`` smuggle an unpinned action past a green
    test. The ref count is returned so callers can prove the scan was not vacuous.
    """
    failures: list[str] = []
    total = 0
    for workflow in sorted([*workflows.glob("*.yml"), *workflows.glob("*.yaml")]):
        for action in _USES.findall(workflow.read_text(encoding="utf-8")):
            total += 1
            if not _is_immutable(action):
                failures.append(f"{workflow.name}: {action}")
    return failures, total


def test_all_action_refs_are_pinned_to_full_commit_shas() -> None:
    failures, total = _audit(_ROOT / ".github" / "workflows")
    assert failures == []
    # Non-vacuity: zero refs means the scan found nothing to check, which must FAIL
    # rather than green-light the repo. A broken glob or a moved workflow dir lands here.
    assert total > 0, "workflow audit matched no action references — the scan is vacuous"


def test_audit_reports_zero_refs_when_there_is_nothing_to_scan(tmp_path: Path) -> None:
    """Proves the non-vacuity assertion above has teeth: an empty dir yields a zero count."""
    assert _audit(tmp_path) == ([], 0)


def test_audit_catches_an_unpinned_action_in_a_yaml_file(tmp_path: Path) -> None:
    """A ``.yaml`` workflow is scanned exactly like a ``.yml`` one — the glob hole."""
    (tmp_path / "deploy.yaml").write_text(
        "jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n", encoding="utf-8"
    )
    assert _audit(tmp_path) == (["deploy.yaml: actions/checkout@v4"], 1)


def test_audit_catches_a_first_party_moving_tag(tmp_path: Path) -> None:
    """First-party reusable workflows get NO carve-out — a moving ``ci-v2`` ref fails."""
    (tmp_path / "ci.yml").write_text(
        "jobs:\n  gate:\n    uses: hseshadr/ci/.github/workflows/py-gate.yml@ci-v2\n",
        encoding="utf-8",
    )
    assert _audit(tmp_path) == (["ci.yml: hseshadr/ci/.github/workflows/py-gate.yml@ci-v2"], 1)


def test_pin_rule_rejects_mutable_and_malformed_refs() -> None:
    mutable = [
        "actions/checkout@v7",  # moving major tag
        "actions/checkout@v7.0.0",  # exact version tag — still repointable
        "actions/checkout@main",  # branch
        "actions/checkout@9c091bb",  # short SHA
        "actions/checkout@" + "a" * 39,  # one hex short of a real SHA
        "actions/checkout@" + "A" * 40,  # uppercase is not a canonical SHA
        "actions/checkout",  # no ref at all
    ]
    assert [ref for ref in mutable if _is_immutable(ref)] == []


def test_pin_rule_accepts_immutable_refs() -> None:
    immutable = [
        "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
        "hseshadr/ci/.github/workflows/py-gate.yml@" + "b" * 40,  # pinned reusable workflow
        "./.github/actions/setup",  # ships in this commit
        "docker://alpine:3.20",  # image ref, not a git ref
    ]
    assert [ref for ref in immutable if not _is_immutable(ref)] == []
