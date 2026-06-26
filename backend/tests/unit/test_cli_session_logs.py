"""Unit tests for the CLI ``--sessions`` JSONL loader's per-line error context."""

from __future__ import annotations

from pathlib import Path

import pytest

from edgereco.cli import _load_session_logs


def test_loads_well_formed_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "sessions.jsonl"
    path.write_text(
        '{"session_id":"s1","events":[{"product_id":"P1","event_type":"click"}]}\n'
        '{"session_id":"s2","events":[{"product_id":"P2","event_type":"cart"}]}\n',
        encoding="utf-8",
    )
    logs = _load_session_logs(path)
    assert [log.session_id for log in logs] == ["s1", "s2"]


def test_none_path_yields_empty(tmp_path: Path) -> None:
    assert _load_session_logs(None) == []


def test_blank_lines_are_skipped(tmp_path: Path) -> None:
    path = tmp_path / "sessions.jsonl"
    path.write_text(
        '{"session_id":"s1","events":[]}\n\n   \n{"session_id":"s2","events":[]}\n',
        encoding="utf-8",
    )
    assert [log.session_id for log in _load_session_logs(path)] == ["s1", "s2"]


def test_malformed_line_raises_with_line_number_and_file(tmp_path: Path) -> None:
    """A bad JSONL line surfaces the 1-based line number and the file path, not a
    bare JSON/validation error a maintainer can't locate."""
    path = tmp_path / "sessions.jsonl"
    path.write_text(
        '{"session_id":"s1","events":[]}\n'
        "{not valid json\n"  # line 2 is malformed
        '{"session_id":"s3","events":[]}\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="line 2") as exc:
        _load_session_logs(path)
    message = str(exc.value)
    assert "line 2" in message
    assert "sessions.jsonl" in message


def test_schema_violation_line_raises_with_line_number(tmp_path: Path) -> None:
    """A line that is valid JSON but violates the SessionLog schema is also located."""
    path = tmp_path / "sessions.jsonl"
    path.write_text(
        '{"session_id":"s1","events":[]}\n'
        '{"session_id":"s2"}\n',  # line 2: missing required 'events'
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="line 2") as exc:
        _load_session_logs(path)
    assert "line 2" in str(exc.value)
