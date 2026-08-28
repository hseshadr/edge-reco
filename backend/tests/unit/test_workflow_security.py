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
from collections.abc import Mapping
from pathlib import Path

import yaml

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


def _workflow_paths(workflows: Path) -> list[Path]:
    return sorted([*workflows.glob("*.yml"), *workflows.glob("*.yaml")])


def _job_steps(job: object) -> tuple[list[Mapping[object, object]], str | None]:
    if not isinstance(job, Mapping):
        return [], "unexpected job structure"
    if "steps" not in job:
        return [], None
    steps = job["steps"]
    if not isinstance(steps, list) or not all(isinstance(step, Mapping) for step in steps):
        return [], "unexpected steps structure"
    return steps, None


def _workflow_steps(workflow: Path) -> tuple[list[Mapping[object, object]], list[str]]:
    try:
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        return [], [f"{workflow.name}: malformed workflow YAML"]
    if not isinstance(document, Mapping) or not isinstance(jobs := document.get("jobs"), Mapping):
        return [], [f"{workflow.name}: unexpected workflow structure"]
    groups = [_job_steps(job) for job in jobs.values()]
    failures = [f"{workflow.name}: {failure}" for _, failure in groups if failure is not None]
    return [step for steps, _ in groups for step in steps], failures


def _checkout_persists_credentials(step: Mapping[object, object]) -> bool:
    action = step.get("uses")
    if not isinstance(action, str) or not action.casefold().startswith("actions/checkout@"):
        return False
    options = step.get("with")
    return not isinstance(options, Mapping) or options.get("persist-credentials") is not False


def _step_privilege_violations(workflow: Path, steps: list[Mapping[object, object]]) -> list[str]:
    runs = [f"{workflow.name}: repo-authored run step" for step in steps if "run" in step]
    credentials = [
        f"{workflow.name}: checkout credentials persisted"
        for step in steps
        if _checkout_persists_credentials(step)
    ]
    return [*runs, *credentials]


def _privilege_violations(workflows: Path) -> list[str]:
    failures: list[str] = []
    for workflow in _workflow_paths(workflows):
        steps, structural_failures = _workflow_steps(workflow)
        failures.extend(structural_failures)
        failures.extend(_step_privilege_violations(workflow, steps))
    return failures


def load_workflow(name: str) -> dict[str, object]:
    """Load one repository-owned GitHub Actions workflow."""
    document = yaml.safe_load((_ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def test_all_action_refs_are_pinned_to_full_commit_shas() -> None:
    failures, total = _audit(_ROOT / ".github" / "workflows")
    assert failures == []
    # Non-vacuity: zero refs means the scan found nothing to check, which must FAIL
    # rather than green-light the repo. A broken glob or a moved workflow dir lands here.
    assert total > 0, "workflow audit matched no action references — the scan is vacuous"


def test_should_run_all_security_checks_inside_stable_dagger_context() -> None:
    """Branch protection relies on one Dagger job while Dagger owns secret scanning."""
    # Given
    workflow = (_ROOT / ".github" / "workflows" / "dagger.yml").read_text(encoding="utf-8")
    # When
    job = re.search(r"(?ms)^  dagger:\n(?P<body>.*?)(?=^  \w[^\n]*:\n|\Z)", workflow)
    # Then
    assert job is not None, "Dagger workflow has no stable Dagger job"
    assert re.search(r"(?m)^    name: Dagger$", job["body"])
    module = (_ROOT / ".dagger" / "src" / "edge_reco" / "main.py").read_text()
    assert "def secret_scan(" in module


def test_should_delegate_every_repo_authored_step_to_pinned_dagger() -> None:
    """Workflow YAML may only check out source and call the pinned Dagger action."""
    # Given
    workflows = _ROOT / ".github" / "workflows"
    # When
    violations = _privilege_violations(workflows)
    # Then
    assert violations == []


def test_should_keep_privileged_release_calls_out_of_unprivileged_checks() -> None:
    """Cloudflare and SARIF credentials never enter the unprivileged check job."""
    # Given
    workflow = (_ROOT / ".github" / "workflows" / "dagger.yml").read_text()
    # When
    job = re.search(r"(?ms)^  dagger:\n(?P<body>.*?)(?=^  \w[^\n]*:\n|\Z)", workflow)
    forbidden = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "security-events: write")
    # Then
    assert job is not None
    assert all(value not in job["body"] for value in forbidden)


def test_should_project_dagger_sarif_from_a_fork_guarded_privileged_job() -> None:
    workflow = (_ROOT / ".github" / "workflows" / "dagger.yml").read_text()
    assert "security-events: write" in workflow
    assert "head.repo.full_name == github.repository" in workflow
    assert "codeql-upload" in workflow
    assert "--github-token=env:GITHUB_TOKEN" in workflow


def test_should_have_dagger_owned_scheduled_security() -> None:
    # Given
    workflow = load_workflow("security-audit.yml")
    triggers = workflow[True]
    permissions = workflow["permissions"]
    job = workflow["jobs"]["security"]
    steps = job["steps"]
    # Then
    assert triggers == {"workflow_dispatch": None, "schedule": [{"cron": "0 9 * * 1"}]}
    assert permissions == {"contents": "read"}
    assert len(steps) == 2
    checkout, dagger_step = steps
    assert _is_immutable(checkout["uses"])
    assert checkout["with"] == {"fetch-depth": 0, "persist-credentials": False}
    assert _is_immutable(dagger_step["uses"])
    assert dagger_step["with"]["call"] == "security"
    assert all("run" not in step for step in steps)


def test_should_call_deploy_without_repository_override() -> None:
    """The deploy workflow cannot override EdgeReco's validated target."""
    # Given
    workflow = load_workflow("deploy.yml")
    # When
    call = workflow["jobs"]["deploy"]["steps"][1]["with"]["call"]
    # Then
    assert "--repository=" not in call


def test_audit_reports_zero_refs_when_there_is_nothing_to_scan(tmp_path: Path) -> None:
    """Proves the non-vacuity assertion above has teeth: an empty dir yields a zero count."""
    assert _audit(tmp_path) == ([], 0)


def test_audit_catches_an_unpinned_action_in_a_yaml_file(tmp_path: Path) -> None:
    """A ``.yaml`` workflow is scanned exactly like a ``.yml`` one — the glob hole."""
    (tmp_path / "deploy.yaml").write_text(
        "jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n", encoding="utf-8"
    )
    assert _audit(tmp_path) == (["deploy.yaml: actions/checkout@v4"], 1)


def test_should_reject_pinned_yaml_with_repo_authored_steps_or_credentials(tmp_path: Path) -> None:
    """A pinned ``.yaml`` workflow cannot bypass the no-new-privilege policy."""
    # Given
    pinned = "a" * 40
    (tmp_path / "adversarial.yaml").write_text(
        "jobs:\n  audit:\n    steps:\n"
        f"      - uses: actions/checkout@{pinned}\n"
        "        with:\n          persist-credentials: true\n"
        f"      - uses: dagger/dagger-for-github@{pinned}\n"
        "      - run: echo escaped\n",
        encoding="utf-8",
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert _audit(tmp_path) == ([], 2)
    assert violations == [
        "adversarial.yaml: repo-authored run step",
        "adversarial.yaml: checkout credentials persisted",
    ]


def test_should_reject_pinned_yaml_run_key_with_whitespace_before_colon(tmp_path: Path) -> None:
    """A valid YAML spelling of ``run`` cannot bypass the semantic privilege policy."""
    # Given
    pinned = "a" * 40
    workflow = tmp_path / "whitespace-bypass.yaml"
    workflow.write_text(
        "jobs:\n  audit:\n    steps:\n"
        f"      - uses: actions/checkout@{pinned}\n"
        "        with:\n          persist-credentials: false\n"
        f"      - uses: dagger/dagger-for-github@{pinned}\n"
        "      - run : echo escaped\n",
        encoding="utf-8",
    )
    # When
    document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
    violations = _privilege_violations(tmp_path)
    # Then
    assert document["jobs"]["audit"]["steps"][-1] == {"run": "echo escaped"}
    assert _audit(tmp_path) == ([], 2)
    assert violations == ["whitespace-bypass.yaml: repo-authored run step"]


def test_should_allow_credentialless_pinned_yaml_action_steps(tmp_path: Path) -> None:
    """The semantic policy permits a normal credentialless pinned Dagger workflow."""
    # Given
    pinned = "a" * 40
    (tmp_path / "safe.yaml").write_text(
        "jobs:\n  audit:\n    steps:\n"
        f"      - uses: actions/checkout@{pinned}\n"
        "        with:\n          persist-credentials: false\n"
        f"      - uses: dagger/dagger-for-github@{pinned}\n",
        encoding="utf-8",
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert _audit(tmp_path) == ([], 2)
    assert violations == []


def test_should_reject_mixed_case_checkout_without_credential_hardening(tmp_path: Path) -> None:
    """Case-insensitive checkout identity still requires disabled credential persistence."""
    # Given
    pinned = "a" * 40
    (tmp_path / "mixed-case.yaml").write_text(
        f"jobs:\n  audit:\n    steps:\n      - uses: Actions/Checkout@{pinned}\n",
        encoding="utf-8",
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert _audit(tmp_path) == ([], 1)
    assert violations == ["mixed-case.yaml: checkout credentials persisted"]


def test_should_allow_mixed_case_checkout_with_credential_hardening(tmp_path: Path) -> None:
    """Case normalization does not reject a hardened checkout action."""
    # Given
    pinned = "a" * 40
    (tmp_path / "mixed-case-safe.yaml").write_text(
        "jobs:\n  audit:\n    steps:\n"
        f"      - uses: Actions/Checkout@{pinned}\n"
        "        with:\n          persist-credentials: false\n",
        encoding="utf-8",
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert _audit(tmp_path) == ([], 1)
    assert violations == []


def test_should_reject_unexpected_steps_structure(tmp_path: Path) -> None:
    """A non-list workflow ``steps`` value fails closed instead of escaping inspection."""
    # Given
    (tmp_path / "unexpected.yaml").write_text(
        "jobs:\n  audit:\n    steps: unexpected\n", encoding="utf-8"
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert violations == ["unexpected.yaml: unexpected steps structure"]


def test_should_reject_explicit_null_steps(tmp_path: Path) -> None:
    """An explicit null ``steps`` value is not equivalent to a missing reusable-job key."""
    # Given
    (tmp_path / "null-steps.yaml").write_text(
        "jobs:\n  audit:\n    steps: null\n", encoding="utf-8"
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert violations == ["null-steps.yaml: unexpected steps structure"]


def test_should_allow_missing_steps_for_a_reusable_job(tmp_path: Path) -> None:
    """A valid reusable-workflow job has no local ``steps`` mapping to inspect."""
    # Given
    pinned = "a" * 40
    (tmp_path / "reusable.yaml").write_text(
        f"jobs:\n  audit:\n    uses: owner/repo/.github/workflows/security.yml@{pinned}\n",
        encoding="utf-8",
    )
    # When
    violations = _privilege_violations(tmp_path)
    # Then
    assert _audit(tmp_path) == ([], 1)
    assert violations == []


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
