"""No-follow, regular-file-only reads and atomic writes for producer-side files.

The publisher reads the served ``latest`` to pick its next signed ``sequence`` and
copies ``vector/`` files that may come from a synced cache. The reads here therefore
never follow a final-component symlink, refuse anything but a regular file (a FIFO
or device would otherwise block or stream forever), and cap the size before reading.
The check and the read share one descriptor, so the file cannot be swapped in between.
The writes create a same-directory temp with ``O_EXCL|O_NOFOLLOW``, fsync it, and
``os.replace`` it into place, so a reader sees the old file or the new one, never a
torn or redirected write.

``O_NONBLOCK`` is set on open so that opening a FIFO returns at once and is then
refused by ``fstat``, rather than blocking until a writer appears.
"""

from __future__ import annotations

import errno
import os
import secrets
import shutil
import stat
from pathlib import Path
from typing import BinaryIO, Final

_READ_FLAGS: Final[int] = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
_TEMP_FLAGS: Final[int] = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)


class UnsafeFileError(ValueError):
    """A path is a symlink, not a regular file, or larger than its cap."""


def open_regular_file(path: Path, *, label: str, max_bytes: int) -> BinaryIO:
    """Open ``path`` read-only: no symlink, regular file only, at most ``max_bytes``."""
    try:
        fd = os.open(path, _READ_FLAGS)
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise UnsafeFileError(f"{label} must not be a symlink: {path}") from exc
        raise
    try:
        _require_regular(os.fstat(fd), path, label=label, max_bytes=max_bytes)
    except BaseException:
        os.close(fd)
        raise
    return os.fdopen(fd, "rb")


def _require_regular(info: os.stat_result, path: Path, *, label: str, max_bytes: int) -> None:
    if not stat.S_ISREG(info.st_mode):
        raise UnsafeFileError(f"{label} must be a regular file: {path}")
    if info.st_size > max_bytes:
        raise UnsafeFileError(f"{label} is larger than {max_bytes} bytes: {path}")


def read_regular_bytes(path: Path, *, label: str, max_bytes: int) -> bytes:
    """Read a whole regular file through :func:`open_regular_file`, bounded."""
    with open_regular_file(path, label=label, max_bytes=max_bytes) as handle:
        data = handle.read(max_bytes + 1)
    if len(data) > max_bytes:  # grew after fstat
        raise UnsafeFileError(f"{label} is larger than {max_bytes} bytes: {path}")
    return data


def copy_regular_file(source: Path, destination: Path, *, label: str, max_bytes: int) -> None:
    """Copy a bounded regular ``source`` into a new ``destination`` (never followed)."""
    with (
        open_regular_file(source, label=label, max_bytes=max_bytes) as reader,
        os.fdopen(os.open(destination, _TEMP_FLAGS, 0o600), "wb") as writer,
    ):
        shutil.copyfileobj(reader, writer)


def write_atomic(path: Path, data: bytes) -> None:
    """Replace ``path`` with ``data`` via an fsynced, exclusive, same-directory temp."""
    temp = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        with os.fdopen(os.open(temp, _TEMP_FLAGS, 0o644), "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    _fsync_directory(path.parent)


def _fsync_directory(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
