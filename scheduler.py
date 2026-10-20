"""Background tasks: key rotation and tidying up old sign-in records."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from .db import iso, now_iso

log = logging.getLogger("learnly.scheduler")


class Scheduler:
    def __init__(self, state):
        self.state = state
        self.tasks = {
            "maintenance": (3600, self.maintenance),
        }
        self.status: dict[str, dict] = {name: {"last_run": None, "last_result": None, "last_error": ""} for name in self.tasks}
        self._task: asyncio.Task | None = None
        self._last: dict[str, float] = {}

    def add(self, name: str, interval_s: int, fn) -> None:
        """Register another periodic task (features call this at start-up)."""
        self.tasks[name] = (interval_s, fn)
        self.status.setdefault(name, {"last_run": None, "last_result": None, "last_error": ""})

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        await asyncio.sleep(3)
        while True:
            for name, (interval, _) in list(self.tasks.items()):
                if time.monotonic() - self._last.get(name, -1e9) >= interval:
                    await self.run(name)
            await asyncio.sleep(5)

    async def run(self, name: str) -> dict:
        if name not in self.tasks:
            raise KeyError(name)
        self._last[name] = time.monotonic()
        try:
            result = await self.tasks[name][1]()
            self.status[name].update(last_run=now_iso(), last_result=result, last_error="")
            return {"ok": True, **(result or {})}
        except Exception as exc:  # keep the loop alive; show the error on the admin page
            log.exception("scheduled task %s failed", name)
            self.status[name].update(last_run=now_iso(), last_error=str(exc)[:300])
            return {"ok": False, "error": str(exc)}

    async def maintenance(self) -> dict:
        rotated = self.state.keys.rotate_if_due()
        old_tokens = iso(datetime.now(timezone.utc) - timedelta(days=30))
        with self.state.db.write() as con:
            tokens = con.execute("DELETE FROM refresh_tokens WHERE expires_at < ?", (old_tokens,)).rowcount
        return {"rotated_key": rotated, "refresh_tokens_removed": tokens}
