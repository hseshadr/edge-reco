"""The DEPLOY.md publisher recipe must never sign sequence 1 over a served release.

The recipe reads the sequence the CDN serves now and passes one more to
``edgereco bundle``. If that read silently yields nothing (a failed fetch, a pointer
without a numeric ``sequence``), ``$(( + 1))`` evaluates to 1 and CI would sign a
release every returning shopper refuses as a rollback. This test runs the recipe's
real shell text from the doc, with ``curl``/``edgereco``/``aws`` replaced by shims and
the real ``jq``, and requires it to stop before bundling on every bad input.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

DEPLOY = Path(__file__).parents[3] / "docs" / "DEPLOY.md"


def _recipe() -> str:
    blocks = re.findall(r"```bash\n(.*?)```", DEPLOY.read_text(encoding="utf-8"), re.S)
    recipes = [block for block in blocks if "NEXT_SEQUENCE" in block]
    assert len(recipes) == 1, "DEPLOY.md must hold exactly one sequence-reading recipe"
    return recipes[0]


def _shim(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text(f"#!/usr/bin/env bash\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


def _run(tmp_path: Path, served: str | None) -> tuple[int, str]:
    if shutil.which("jq") is None:
        pytest.fail("jq is required to exercise the DEPLOY.md recipe")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "calls.log"
    curl = "exit 22" if served is None else f"printf '%s' '{served}'"
    _shim(bin_dir, "curl", curl)
    _shim(bin_dir, "edgereco", f'echo "edgereco $*" >> {calls}')
    _shim(bin_dir, "aws", f'echo "aws $*" >> {calls}')
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "VERSION": "v9"}
    result = subprocess.run(  # noqa: S603 - fixed interpreter, doc text under test
        ["/usr/bin/env", "bash", "-c", _recipe()],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, calls.read_text(encoding="utf-8") if calls.exists() else ""


def test_recipe_bundles_one_more_than_the_served_sequence(tmp_path: Path) -> None:
    code, calls = _run(tmp_path, '{"sequence": 41, "version": "v8"}')
    assert code == 0
    assert "edgereco bundle" in calls
    assert "--sequence 42" in calls


@pytest.mark.parametrize(
    "served",
    [None, "", "not json", "{}", '{"sequence": null}', '{"sequence": "41"}'],
    ids=["fetch-fails", "empty", "not-json", "no-sequence", "null", "string"],
)
def test_recipe_stops_before_bundling_when_the_served_sequence_is_unknown(
    tmp_path: Path, served: str | None
) -> None:
    code, calls = _run(tmp_path, served)
    assert code != 0
    assert "edgereco bundle" not in calls
    assert "aws" not in calls
