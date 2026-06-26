"""Unit tests for the _scalar_as_float polars-aggregate coercion helper."""

from __future__ import annotations

import pytest

from edgereco.cli import _scalar_as_float


@pytest.mark.parametrize(
    ("value", "default", "expected"),
    [
        (3, 0.0, 3.0),
        (2.5, 0.0, 2.5),
        (0.0, 1.0, 0.0),
        (None, 0.0, 0.0),
        ("not-numeric", 1.0, 1.0),
        (b"bytes", 9.0, 9.0),
        (True, 7.0, 7.0),
    ],
)
def test_scalar_as_float(value: object, default: float, expected: float) -> None:
    assert _scalar_as_float(value, default) == expected
