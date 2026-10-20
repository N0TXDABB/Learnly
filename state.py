"""Everything the running app shares: database, keys, local AI, background jobs, scheduler."""

from __future__ import annotations

from pathlib import Path

import httpx

from .config import AppConfig
from .db import Database
from .jobs import JobRunner
from .llm import LocalAI
from .scheduler import Scheduler
from .security.audit import AuditLog
from .security.crypto import SecretBox
from .security.ratelimit import RateLimiter
from .security.tokens import KeyStore, TokenService
from .settings import SettingsStore


class AppState:
    def __init__(self, cfg: AppConfig, llm_transport: httpx.AsyncBaseTransport | None = None):
        self.cfg = cfg
        data = Path(cfg.data_dir)
        (data / "keys").mkdir(parents=True, exist_ok=True)
        self.uploads_dir = cfg.uploads_dir
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.db = Database(data / "learnly.db")
        self.box = SecretBox(data / "keys" / "master.key")
        self.settings = SettingsStore(self.db)
        if cfg.initial_settings:
            with self.db.write() as con:
                self.settings.update(con, cfg.initial_settings, None)
        self.keys = KeyStore(self.db, self.box, cfg.key_rotation_days, grace_s=cfg.access_ttl_s + 3600)
        self.tokens = TokenService(self.db, self.keys, cfg.access_ttl_s, cfg.refresh_ttl_s)
        self.audit = AuditLog()
        self.limiter = RateLimiter()
        self.ai = LocalAI(self.settings.all, transport=llm_transport)
        self.jobs = JobRunner(self.db)
        self.scheduler = Scheduler(self)
        self.settings.listeners.append(self._settings_changed)

    def _settings_changed(self, changes: dict) -> None:
        if any(k.startswith("ai_") or k.endswith("_model") for k in changes):
            self.ai.invalidate()
