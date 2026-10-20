"""Per-user (or per-address for guests) token buckets."""

from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last refill time)
        self._lock = threading.Lock()

    def check(self, key: str, per_minute: int, now: float | None = None) -> tuple[bool, float]:
        """Take one token. Returns (allowed, seconds to wait if refused)."""
        now = time.monotonic() if now is None else now
        rate = per_minute / 60.0
        with self._lock:
            tokens, last = self._buckets.get(key, (float(per_minute), now))
            tokens = min(float(per_minute), tokens + (now - last) * rate)
            if tokens >= 1.0:
                self._buckets[key] = (tokens - 1.0, now)
                return True, 0.0
            self._buckets[key] = (tokens, now)
            return False, (1.0 - tokens) / rate

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()
