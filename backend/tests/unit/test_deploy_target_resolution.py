"""The deploy job must resolve its target from the remote, not from the trigger.

On 2026-08-08 ``edge-reco.com`` served ``295fcaf`` while ``main`` was ``3eec558``.
Nothing was red. Three commits landed within ~30s and their CI runs finished OUT OF
COMMIT ORDER::

    CI  13:18:36 -> 13:21:37   d09847e
    CI  13:19:00 -> 13:22:00   3eec558   <- NEWEST commit
    CI  13:18:40 -> 13:22:05   295fcaf   <- older, finished LAST

Deploy fires on CI completion under ``concurrency: {cancel-in-progress: false}``.
GitHub keeps only ONE pending run per group, so a newly queued run cancels the one
already pending::

    13:21:39 -> 13:22:35   deploy d09847e   running
    13:22:02 -> 13:22:08   deploy 3eec558   CANCELLED   <- newest, discarded
    13:22:07 -> 13:23:33   deploy 295fcaf   success     <- older, ran last and won

Every run was right on its own terms. The deploy for ``295fcaf`` checked out
``295fcaf``, and its "Verify public build identity" step confirmed the site served
``295fcaf`` — which was TRUE. The COMPOSITION was wrong: ``workflow_run.head_sha``
had already been falsified by the time the job got scheduled.

The fix reads the remote at the point of use. ``TARGET_SHA`` is ``main`` HEAD as
``git ls-remote`` reports it when the step runs; if that commit has no successful CI
run the job deploys nothing and exits GREEN, because that commit's own deploy fires
when its CI passes. Cancellation only ever happens when a newer run is queued, so
there is always a successor — and a successor that re-resolves ``main`` HEAD deploys
the right thing. That is what makes the cancellation harmless instead of load-bearing.

These tests execute the ACTUAL ``run:`` script committed in the resolve step of
``.github/workflows/deploy.yml``, under ``bash``, with stub ``git`` and ``gh`` on
``PATH`` and real ``$GITHUB_OUTPUT`` / ``$GITHUB_ENV`` files — in both polarities. A
trigger that still matches ``main`` HEAD must deploy that sha (a guard that always
skipped would satisfy "does not deploy the stale commit" while deploying nothing
ever), and a falsified trigger must deploy ``main`` HEAD instead. The stubs model
what the remote REPORTS, not ``gh``'s own semantics; the query string ``gh`` was
called with is captured so the tests can prove the CI lookup asked about the
resolved sha rather than the trigger's.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from itertools import pairwise, takewhile
from pathlib import Path
from textwrap import dedent

import pytest

_ROOT = Path(__file__).resolve().parents[3]
_DEPLOY = _ROOT / ".github" / "workflows" / "deploy.yml"
_JOB = "deploy"
_RESOLVE_STEP = "Resolve the deploy target from the remote"
_RESOLVE_ID = "resolve"

# Every step that can mutate the live site hangs off this one condition.
_GATE = "steps.resolve.outputs.deploy == 'true'"
# The checkout must take the RESOLVED sha, so EXPECTED_SHA and the working tree
# can never name two different commits.
_CHECKOUT_REF = "${{ steps.resolve.outputs.target_sha }}"

# The three commits from the incident above, at full length.
_MAIN_HEAD = "3eec5582e58f0ce1bee774d22ae66448501a24f2"
_STALE_TRIGGER = "295fcaf9b64689960d5998d7084f254b96d68eab"

# The composition this one replaced, verbatim: the checkout ref and EXPECTED_SHA were
# both this expression, so whatever sha the trigger carried is what got deployed.
_PRE_FIX_TARGET = "${{ github.event.workflow_run.head_sha || github.sha }}"

_BASH = shutil.which("bash")
_STEP_MARKER = "      - "
_RUN_BODY_INDENT = "          "

# What the runner injects into the step. Pinned here so the harness's model of the
# step's inputs cannot silently drift from the committed step.
_STEP_ENV_KEYS = frozenset({"GH_TOKEN", "REPO", "GATE_WORKFLOW", "TRIGGER_SHA"})
_SHARED_STATE_ACTIONS = (
    "actions/cache@",
    "actions/download-artifact@",
    "actions/upload-artifact@",
)
_CACHING_SETUP_ACTIONS = ("actions/setup-node@", "actions/setup-python@")

_GIT_STUB = """#!/usr/bin/env bash
if [ "$1" != "ls-remote" ]; then
  echo "unmodelled git invocation: $*" >&2
  exit 127
fi
if [ "$STUB_LS_REMOTE_EXIT" -ne 0 ]; then
  echo "stub git ls-remote: forced failure" >&2
  exit "$STUB_LS_REMOTE_EXIT"
fi
printf '%s' "$STUB_LS_REMOTE_STDOUT"
"""

_GH_STUB = """#!/usr/bin/env bash
if [ "$1" != "api" ]; then
  echo "unmodelled gh invocation: $*" >&2
  exit 127
fi
printf '%s' "$2" >"$STUB_GH_QUERY"
if [ "$STUB_GH_EXIT" -ne 0 ]; then
  echo "stub gh api: forced failure" >&2
  exit "$STUB_GH_EXIT"
fi
printf '%s\\n' "$STUB_GH_COUNT"
"""


@dataclass(frozen=True)
class Step:
    """One entry of the deploy job's ``steps:`` list, exactly as committed."""

    name: str
    condition: str | None
    run: str | None
    env_keys: frozenset[str] = field(default_factory=frozenset)
    text: str = ""


@dataclass(frozen=True)
class Remote:
    """What the remote reports at the moment the step runs."""

    main_head: str
    ci_success_count: str = "1"
    ls_remote_exit: int = 0
    gh_exit: int = 0


@dataclass(frozen=True)
class Resolution:
    """What the committed step actually did."""

    exit_code: int
    outputs: dict[str, str]
    exported: dict[str, str]
    log: str
    ci_query: str


def _is_job_header(line: str) -> bool:
    """True for a two-space job key (``  deploy:``) — the end of the previous job."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return False
    return line.startswith("  ") and not line.startswith("   ")


def job_lines(workflow: str, job: str) -> list[str]:
    """Return the body of ``job``, stopping at the next job key."""
    lines = workflow.splitlines()
    header = f"  {job}:"
    if header not in lines:
        raise ValueError(f"no job named {job!r}")
    start = lines.index(header) + 1
    ends = [i for i in range(start, len(lines)) if _is_job_header(lines[i])]
    return lines[start : ends[0] if ends else len(lines)]


def _scalar(lines: list[str], key: str) -> str | None:
    """First ``key: value`` mapping entry in a step, at any nesting depth."""
    needle = f"{key}:"
    for line in lines:
        stripped = line.strip().removeprefix("- ")
        if stripped.startswith(needle):
            return stripped[len(needle) :].strip()
    return None


def _block_body(lines: list[str], index: int) -> str:
    """Dedent the literal block scalar that starts on the line after ``index``."""
    body = takewhile(
        lambda line: not line.strip() or line.startswith(_RUN_BODY_INDENT),
        lines[index + 1 :],
    )
    return dedent("\n".join(body)).strip("\n")


def _run_script(lines: list[str]) -> str | None:
    """The ``run: |`` script of a step. Folded (``>-``) commands are not scripts."""
    for index, line in enumerate(lines):
        if line.strip().removeprefix("- ") == "run: |":
            return _block_body(lines, index)
    return None


def _env_keys(lines: list[str]) -> frozenset[str]:
    """The keys of a step's own ``env:`` mapping."""
    for index, line in enumerate(lines):
        if line.strip().removeprefix("- ") != "env:":
            continue
        body = takewhile(lambda ln: ln.startswith(_RUN_BODY_INDENT), lines[index + 1 :])
        return frozenset(entry.strip().split(":", 1)[0] for entry in body)
    return frozenset()


def job_steps(workflow: str, job: str) -> list[Step]:
    """Split a job body into its steps, in committed order."""
    body = job_lines(workflow, job)
    starts = [i for i, line in enumerate(body) if line.startswith(_STEP_MARKER)]
    if not starts:
        raise ValueError(f"job {job!r} declares no steps")
    bounds = [*starts, len(body)]
    return [_step(body[a:b]) for a, b in pairwise(bounds)]


def _step(lines: list[str]) -> Step:
    return Step(
        name=_scalar(lines, "name") or _scalar(lines, "uses") or "",
        condition=_scalar(lines, "if"),
        run=_run_script(lines),
        env_keys=_env_keys(lines),
        text="\n".join(lines),
    )


WORKFLOW = _DEPLOY.read_text(encoding="utf-8")
STEPS = job_steps(WORKFLOW, _JOB)


def directives(text: str) -> list[str]:
    """Lines that the runner acts on. Prose in a ``#`` comment configures nothing."""
    return [line for line in text.splitlines() if not line.strip().startswith("#")]


def _named(name: str) -> Step:
    matches = [step for step in STEPS if step.name == name]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one step named {name!r}, found {len(matches)}")
    return matches[0]


def _shared_state_access(step: Step) -> str | None:
    action = _scalar(step.text.splitlines(), "uses") or ""
    if action.startswith(_SHARED_STATE_ACTIONS):
        return action
    cache = _scalar(step.text.splitlines(), "cache")
    return (
        f"{action} cache={cache}" if action.startswith(_CACHING_SETUP_ACTIONS) and cache else None
    )


def _privileged_shared_state(workflow: str, steps: list[Step]) -> list[str]:
    runtime = "\n".join(directives(workflow))
    low_trust = any(("workflow_run:" in runtime, "workflow_dispatch:" in runtime))
    if not low_trust:
        return []
    if "${{ secrets." not in runtime:
        return []
    accesses = map(_shared_state_access, steps)
    return [access for access in accesses if access is not None]


def _write_stub(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)


def _stub_environment(tmp_path: Path, remote: Remote, trigger_sha: str) -> dict[str, str]:
    stubs = tmp_path / "bin"
    stubs.mkdir(exist_ok=True)
    _write_stub(stubs / "git", _GIT_STUB)
    _write_stub(stubs / "gh", _GH_STUB)
    ls_remote = f"{remote.main_head}\trefs/heads/main\n" if remote.main_head else ""
    return {
        "PATH": f"{stubs}{os.pathsep}{os.environ.get('PATH', '')}",
        "HOME": str(tmp_path),
        "GITHUB_OUTPUT": str(tmp_path / "outputs"),
        "GITHUB_ENV": str(tmp_path / "exported"),
        "GH_TOKEN": "stub-token",
        "REPO": "hseshadr/edge-reco",
        "GATE_WORKFLOW": "dagger.yml",
        "TRIGGER_SHA": trigger_sha,
        "STUB_LS_REMOTE_STDOUT": ls_remote,
        "STUB_LS_REMOTE_EXIT": str(remote.ls_remote_exit),
        "STUB_GH_COUNT": remote.ci_success_count,
        "STUB_GH_EXIT": str(remote.gh_exit),
        "STUB_GH_QUERY": str(tmp_path / "ci-query"),
    }


def _key_values(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    lines = path.read_text(encoding="utf-8").splitlines()
    return {key: value for key, _, value in (line.partition("=") for line in lines if "=" in line)}


def resolve(tmp_path: Path, remote: Remote, trigger_sha: str) -> Resolution:
    """Run the committed resolve step against a synthesized remote."""
    script = _named(_RESOLVE_STEP).run
    if not script:
        raise ValueError(f"step {_RESOLVE_STEP!r} declares no `run: |` script")
    script_path = tmp_path / "resolve.sh"
    script_path.write_text(script + "\n", encoding="utf-8")
    environment = _stub_environment(tmp_path, remote, trigger_sha)
    completed = subprocess.run(  # noqa: S603 - fixed argv running this repo's own step
        [str(_BASH), str(script_path)],
        capture_output=True,
        text=True,
        env=environment,
        cwd=tmp_path,
        check=False,
        timeout=60,
    )
    query = tmp_path / "ci-query"
    return Resolution(
        exit_code=completed.returncode,
        outputs=_key_values(tmp_path / "outputs"),
        exported=_key_values(tmp_path / "exported"),
        log=completed.stdout + completed.stderr,
        ci_query=query.read_text(encoding="utf-8") if query.exists() else "",
    )


def test_bash_is_available_to_run_the_committed_step() -> None:
    """No silent skip: without bash the tests below prove nothing and must say so."""
    assert _BASH is not None, "no bash on PATH — the committed step cannot be exercised"


def test_the_resolve_step_reads_the_remote_and_not_the_trigger() -> None:
    """Non-vacuity: a gutted step must fail here, not pass by having nothing to check."""
    script = _named(_RESOLVE_STEP).run or ""
    assert "git ls-remote" in script
    assert "refs/heads/main" in script
    assert _named(_RESOLVE_STEP).env_keys == _STEP_ENV_KEYS


def test_deploy_waits_for_the_stable_dagger_workflow() -> None:
    """Deployment authority stays external but consumes the consolidated gate."""
    assert 'workflows: ["Dagger"]' in WORKFLOW
    assert "GATE_WORKFLOW: dagger.yml" in WORKFLOW


def test_privileged_deploy_never_consumes_shared_cache_or_artifacts() -> None:
    """Untrusted default-branch state must not cross into the secret-bearing job."""
    assert _privileged_shared_state(WORKFLOW, STEPS) == []


def test_a_trigger_that_still_matches_main_head_deploys_that_sha(tmp_path: Path) -> None:
    """The positive path. A guard that always skipped would pass every test but this."""
    result = resolve(tmp_path, Remote(main_head=_MAIN_HEAD), trigger_sha=_MAIN_HEAD)
    assert result.exit_code == 0
    assert result.outputs["deploy"] == "true"
    assert result.outputs["target_sha"] == _MAIN_HEAD


def test_a_falsified_trigger_deploys_main_head_not_the_stale_commit(tmp_path: Path) -> None:
    """The bug: the trigger says 295fcaf, main says 3eec558. Deploy main."""
    result = resolve(tmp_path, Remote(main_head=_MAIN_HEAD), trigger_sha=_STALE_TRIGGER)
    assert result.exit_code == 0
    assert result.outputs["deploy"] == "true"
    assert result.outputs["target_sha"] == _MAIN_HEAD
    assert _STALE_TRIGGER not in set(result.outputs.values())
    assert _STALE_TRIGGER not in set(result.exported.values())


def test_the_ci_lookup_asks_about_main_head_not_the_trigger(tmp_path: Path) -> None:
    """A lookup keyed on the stale sha would green-light deploying the stale sha."""
    result = resolve(tmp_path, Remote(main_head=_MAIN_HEAD), trigger_sha=_STALE_TRIGGER)
    assert _MAIN_HEAD in result.ci_query
    assert _STALE_TRIGGER not in result.ci_query


def test_main_head_without_a_successful_ci_run_deploys_nothing_and_exits_green(
    tmp_path: Path,
) -> None:
    """That commit's own deploy fires when its CI passes — so this one is not an error."""
    result = resolve(
        tmp_path,
        Remote(main_head=_MAIN_HEAD, ci_success_count="0"),
        trigger_sha=_STALE_TRIGGER,
    )
    assert result.exit_code == 0
    assert result.outputs["deploy"] == "false"
    assert "target_sha" not in result.outputs
    assert "EXPECTED_SHA" not in result.exported


def test_the_skip_states_its_reason_and_names_the_commit(tmp_path: Path) -> None:
    """Deploying nothing must be loud. A silent green skip is the defect, restated."""
    result = resolve(
        tmp_path,
        Remote(main_head=_MAIN_HEAD, ci_success_count="0"),
        trigger_sha=_STALE_TRIGGER,
    )
    assert _MAIN_HEAD in result.log
    assert "no successful Dagger run" in result.log


def test_expected_sha_equals_the_sha_that_gets_checked_out(tmp_path: Path) -> None:
    """The verify steps must judge the commit in the working tree, never the trigger."""
    result = resolve(tmp_path, Remote(main_head=_MAIN_HEAD), trigger_sha=_STALE_TRIGGER)
    assert result.exported["EXPECTED_SHA"] == result.outputs["target_sha"]
    assert _scalar(_named("Checkout code").text.splitlines(), "ref") == _CHECKOUT_REF


def test_every_step_after_the_resolution_is_gated_on_it() -> None:
    """One unguarded mutating step and "deploys nothing" stops being true."""
    names = [step.name for step in STEPS]
    after = STEPS[names.index(_RESOLVE_STEP) + 1 :]
    assert len(after) >= 5, "resolution is the last step — the gate below is vacuous"
    assert [step.name for step in after if step.condition != _GATE] == []


def test_the_trigger_sha_is_never_a_deploy_target() -> None:
    """It survives only as a log line. Any second use is a path back to the bug."""
    uses = [line for line in directives(WORKFLOW) if "workflow_run.head_sha" in line]
    assert len(uses) == 1
    assert uses[0].strip().startswith("TRIGGER_SHA:")
    assert _PRE_FIX_TARGET not in "\n".join(directives(_named("Checkout code").text))


def test_the_pre_fix_composition_deployed_the_stale_commit(tmp_path: Path) -> None:
    """Break the property, not the form: replay the incident through both compositions."""
    assert _pre_fix_target(_STALE_TRIGGER) == _STALE_TRIGGER
    assert _pre_fix_target(_STALE_TRIGGER) != _MAIN_HEAD
    result = resolve(tmp_path, Remote(main_head=_MAIN_HEAD), trigger_sha=_STALE_TRIGGER)
    assert result.outputs["target_sha"] == _MAIN_HEAD


def _pre_fix_target(trigger_sha: str) -> str:
    """The deleted composition: whatever sha the trigger carried, deployed as-is."""
    return trigger_sha


def test_an_unresolvable_main_ref_fails_loudly(tmp_path: Path) -> None:
    """Fail closed. An empty target must never fall through to a deploy."""
    result = resolve(tmp_path, Remote(main_head=""), trigger_sha=_STALE_TRIGGER)
    assert result.exit_code != 0
    assert result.outputs == {}


def test_a_failing_remote_read_fails_loudly(tmp_path: Path) -> None:
    result = resolve(
        tmp_path,
        Remote(main_head=_MAIN_HEAD, ls_remote_exit=128),
        trigger_sha=_STALE_TRIGGER,
    )
    assert result.exit_code != 0
    assert result.outputs == {}


def test_a_failing_ci_lookup_fails_loudly(tmp_path: Path) -> None:
    result = resolve(
        tmp_path,
        Remote(main_head=_MAIN_HEAD, gh_exit=1),
        trigger_sha=_STALE_TRIGGER,
    )
    assert result.exit_code != 0
    assert "deploy" not in result.outputs


@pytest.mark.parametrize("count", ["", "null", "many"])
def test_a_non_numeric_ci_run_count_fails_loudly(tmp_path: Path, count: str) -> None:
    """`[ null -ne 0 ]` is a bash ERROR, and an untested `if` swallows it into a deploy."""
    result = resolve(
        tmp_path,
        Remote(main_head=_MAIN_HEAD, ci_success_count=count),
        trigger_sha=_STALE_TRIGGER,
    )
    assert result.exit_code != 0
    assert "deploy" not in result.outputs


def test_a_truncated_sha_is_refused(tmp_path: Path) -> None:
    """A short or garbled ref would deploy, then verify against itself, and pass."""
    result = resolve(tmp_path, Remote(main_head="3eec558"), trigger_sha=_STALE_TRIGGER)
    assert result.exit_code != 0
    assert result.outputs == {}


def test_concurrency_still_refuses_to_cancel_a_running_deploy() -> None:
    """cancel-in-progress: true would fix the ordering by killing a mid-upload deploy."""
    settings = directives(WORKFLOW)
    assert [line for line in settings if "cancel-in-progress: false" in line] != []
    assert [line for line in settings if "cancel-in-progress: true" in line] == []


def test_the_job_can_read_its_own_workflow_runs() -> None:
    """`gh api .../actions/runs` needs `actions: read`; without it the step 403s."""
    assert [line for line in directives(WORKFLOW) if line.strip() == "actions: read"] != []


def test_step_splitter_stops_at_the_next_job() -> None:
    workflow = (
        "jobs:\n"
        "  deploy:\n"
        "    steps:\n"
        "      - name: one\n"
        "        if: a == 'b'\n"
        "        run: |\n"
        "          echo hi\n"
        "          echo bye\n"
        "      - uses: actions/checkout@abc\n"
        "        with:\n"
        "          ref: pinned\n"
        "  other:\n"
        "    steps:\n"
        "      - name: unreachable\n"
    )
    steps = job_steps(workflow, "deploy")
    assert [step.name for step in steps] == ["one", "actions/checkout@abc"]
    assert steps[0].condition == "a == 'b'"
    assert steps[0].run == "echo hi\necho bye"
    assert steps[1].run is None
    assert _scalar(steps[1].text.splitlines(), "ref") == "pinned"


def test_step_splitter_refuses_a_job_with_no_steps() -> None:
    with pytest.raises(ValueError, match="declares no steps"):
        job_steps("jobs:\n  deploy:\n    if: true\n", "deploy")


def test_step_splitter_refuses_a_missing_job() -> None:
    with pytest.raises(ValueError, match="no job named"):
        job_steps("jobs:\n  deploy:\n    steps:\n      - name: one\n", "preflight")
