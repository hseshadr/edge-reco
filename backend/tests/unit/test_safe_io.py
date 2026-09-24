"""No-follow bounded reads and atomic writes (``edgereco.safe_io``)."""

from __future__ import annotations

from pathlib import Path

import pytest

from edgereco.safe_io import UnsafeFileError, read_regular_bytes, write_atomic


def test_read_refuses_a_symlink(tmp_path: Path) -> None:
    (tmp_path / "real").write_bytes(b"x")
    (tmp_path / "link").symlink_to(tmp_path / "real")
    with pytest.raises(UnsafeFileError, match="symlink"):
        read_regular_bytes(tmp_path / "link", label="f", max_bytes=10)


def test_read_refuses_a_directory(tmp_path: Path) -> None:
    with pytest.raises(UnsafeFileError, match="regular file"):
        read_regular_bytes(tmp_path, label="f", max_bytes=10)


def test_read_refuses_an_oversized_file(tmp_path: Path) -> None:
    (tmp_path / "big").write_bytes(b"x" * 11)
    with pytest.raises(UnsafeFileError, match="larger than 10 bytes"):
        read_regular_bytes(tmp_path / "big", label="f", max_bytes=10)


def test_read_missing_file_is_an_os_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        read_regular_bytes(tmp_path / "missing", label="f", max_bytes=10)


def test_atomic_write_replaces_and_leaves_no_temp(tmp_path: Path) -> None:
    target = tmp_path / "out"
    target.write_bytes(b"old")
    write_atomic(target, b"new")
    assert target.read_bytes() == b"new"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["out"]


def test_failed_atomic_write_keeps_the_old_target_and_removes_its_temp(tmp_path: Path) -> None:
    target = tmp_path / "out"
    target.mkdir()  # os.replace of a file over a directory fails
    with pytest.raises(IsADirectoryError):
        write_atomic(target, b"new")
    assert target.is_dir()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["out"]
