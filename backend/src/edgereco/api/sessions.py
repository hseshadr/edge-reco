"""In-memory session store: session_id -> SessionProfile."""

from __future__ import annotations

import threading
from collections.abc import Callable

from edgereco.catalog.models import SessionProfile


class SessionStore:
    def __init__(self) -> None:
        self._store: dict[str, SessionProfile] = {}
        self._lock = threading.RLock()

    def get(self, session_id: str) -> SessionProfile:
        with self._lock:
            if session_id not in self._store:
                self._store[session_id] = SessionProfile()
            return self._store[session_id]

    def update(
        self, session_id: str, fn: Callable[[SessionProfile], SessionProfile]
    ) -> SessionProfile:
        with self._lock:
            profile = self.get(session_id)
            updated = fn(profile)
            self._store[session_id] = updated
            return updated
