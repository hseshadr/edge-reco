"""Bounded, idle-expiring in-memory API sessions."""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic

from edgereco.catalog.models import SessionProfile

_DEFAULT_MAX_SESSIONS = 10_000
_DEFAULT_TTL_SECONDS = 3_600.0


@dataclass(frozen=True, slots=True)
class _Entry:
    profile: SessionProfile
    last_seen: float


class SessionStore:
    """Thread-safe LRU store with hard capacity and idle-retention bounds."""

    def __init__(
        self,
        max_sessions: int = _DEFAULT_MAX_SESSIONS,
        ttl_seconds: float = _DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if max_sessions < 1:
            raise ValueError("max_sessions must be positive")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self._max_sessions = max_sessions
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._store: OrderedDict[str, _Entry] = OrderedDict()
        self._lock = threading.RLock()

    def get(self, session_id: str) -> SessionProfile:
        with self._lock:
            now = self._clock()
            self._prune_expired(now)
            return self._touch(session_id, now).profile

    def update(
        self, session_id: str, fn: Callable[[SessionProfile], SessionProfile]
    ) -> SessionProfile:
        with self._lock:
            now = self._clock()
            self._prune_expired(now)
            updated = fn(self._touch(session_id, now).profile)
            self._store[session_id] = _Entry(updated, now)
            return updated

    @property
    def size(self) -> int:
        """Return the number of live sessions after lazy TTL collection."""
        with self._lock:
            self._prune_expired(self._clock())
            return len(self._store)

    def _touch(self, session_id: str, now: float) -> _Entry:
        entry = self._store.pop(session_id, None)
        entry = _Entry(SessionProfile(), now) if entry is None else _Entry(entry.profile, now)
        self._store[session_id] = entry
        if len(self._store) > self._max_sessions:
            self._store.popitem(last=False)
        return entry

    def _prune_expired(self, now: float) -> None:
        while self._store:
            session_id, entry = next(iter(self._store.items()))
            if now - entry.last_seen < self._ttl_seconds:
                return
            del self._store[session_id]
