"""Unit tests for the get_container dependency's fail-closed guard."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import Request

from edgereco.api.deps import get_container


def _request_with_state_container(value: object) -> Request:
    app = SimpleNamespace(state=SimpleNamespace(container=value))
    return cast(Request, SimpleNamespace(app=app))


def test_get_container_rejects_non_container() -> None:
    request = _request_with_state_container("not-a-container")
    with pytest.raises(RuntimeError, match="not a ServiceContainer"):
        get_container(request)
