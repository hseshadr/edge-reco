"""Deploy smoke test: the container entrypoint must match the real CLI.

The deploy entrypoint once invoked ``edgereco sync`` — a command that does not
exist — so the container crashed on boot. These tests execute the entrypoint's
command form against the installed Typer app and cross-check every knob the
deploy files reference, so the scripts can never rot against the CLI again:

- every ``edgereco <subcommand>`` in ``deploy/entrypoint.sh`` must be a real,
  invokable CLI command;
- every ``EDGERECO_*`` env var baked into ``deploy/Dockerfile`` must be consumed
  by ``Settings`` or by the entrypoint script itself (no dead config knobs);
- every ``COPY`` source in the Dockerfile must exist in the build context;
- the entrypoint must be valid POSIX shell.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from typer.testing import CliRunner

from edgereco.cli import app
from edgereco.config import Settings

BACKEND = Path(__file__).resolve().parents[2]
DEPLOY = BACKEND / "deploy"
ENTRYPOINT = DEPLOY / "entrypoint.sh"
DOCKERFILE = DEPLOY / "Dockerfile"

runner = CliRunner()


def _entrypoint_subcommands() -> list[str]:
    """Every ``edgereco <subcommand>`` invocation in the entrypoint script."""
    return re.findall(r"\bedgereco\s+([a-z][a-z-]*)", ENTRYPOINT.read_text())


def test_entrypoint_invokes_only_real_cli_subcommands() -> None:
    subcommands = _entrypoint_subcommands()
    assert subcommands, "entrypoint.sh must invoke the edgereco CLI at least once"
    for subcommand in subcommands:
        result = runner.invoke(app, [subcommand, "--help"])
        assert result.exit_code == 0, (
            f"entrypoint.sh invokes `edgereco {subcommand}` but the CLI rejects it:\n"
            f"{result.output}"
        )


def test_dockerfile_env_knobs_are_consumed() -> None:
    """No dead config: every EDGERECO_* env baked into the image must be read."""
    baked = set(re.findall(r"(EDGERECO_[A-Z_]+)=", DOCKERFILE.read_text()))
    assert baked, "Dockerfile should bake EDGERECO_* configuration"
    settings_envs = {f"EDGERECO_{name.upper()}" for name in Settings.model_fields}
    entrypoint_text = ENTRYPOINT.read_text()
    dead = {var for var in baked if var not in settings_envs and f"${var}" not in entrypoint_text}
    assert not dead, f"Dockerfile bakes env vars nothing consumes: {sorted(dead)}"


def test_dockerfile_copy_sources_exist() -> None:
    """Every COPY source must exist relative to the build context (backend/)."""
    copy_lines = [
        line.split()[1:-1]
        for line in DOCKERFILE.read_text().splitlines()
        if line.startswith("COPY ")
    ]
    sources = [src for line in copy_lines for src in line]
    assert sources, "Dockerfile should COPY application files"
    missing = [src for src in sources if not (BACKEND / src).exists()]
    assert not missing, f"Dockerfile COPY sources missing from build context: {missing}"


def test_entrypoint_is_valid_posix_shell() -> None:
    check = subprocess.run(  # noqa: S603 - static repo file, syntax check only
        ["/bin/sh", "-n", str(ENTRYPOINT)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert check.returncode == 0, f"entrypoint.sh has shell syntax errors: {check.stderr}"
