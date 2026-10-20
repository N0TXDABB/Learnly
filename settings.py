"""Settings changed in the app (AI server, model, tutor prompt, speech-to-text …), stored in the database."""

from __future__ import annotations

import threading
from urllib.parse import urlparse

from .config import AI_PROVIDER_DEFAULT_URLS, DEFAULT_SETTINGS, WHISPER_MODELS
from .db import Database, dumps, loads, now_iso, rows
from .errors import ApiError

PUBLIC_KEYS = ("ai_provider", "ai_base_url", "chat_model", "require_admin_mfa", "whisper_model", "max_upload_mb")


def _url(value) -> str:
    text = str(value or "").strip().rstrip("/")
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ApiError(400, "INVALID_SETTING", "Enter a full address such as http://127.0.0.1:11434")
    return text


def _choice(options):
    def check(value):
        if value not in options:
            raise ApiError(400, "INVALID_SETTING", f"Choose one of: {', '.join(options)}")
        return value
    return check


def _number(lo, hi, kind=float):
    def check(value):
        try:
            number = kind(value)
        except (TypeError, ValueError):
            raise ApiError(400, "INVALID_SETTING", "Enter a number.")
        if not lo <= number <= hi:
            raise ApiError(400, "INVALID_SETTING", f"Enter a number from {lo} to {hi}.")
        return number
    return check


def _text(limit):
    def check(value):
        text = str(value or "").strip()
        if len(text) > limit:
            raise ApiError(400, "INVALID_SETTING", f"Keep it under {limit} characters.")
        return text
    return check


def _bool(value):
    if isinstance(value, bool):
        return value
    raise ApiError(400, "INVALID_SETTING", "Use true or false.")


VALIDATORS = {
    "ai_provider": _choice(("ollama", "openai")),
    "ai_base_url": _url,
    "chat_model": _text(120),
    "ai_timeout_s": _number(10, 1800, int),
    "tutor_prompt": _text(20000),
    "require_admin_mfa": _bool,
    "whisper_model": _choice(WHISPER_MODELS),
    "max_upload_mb": _number(1, 500, int),
}


class SettingsStore:
    def __init__(self, db: Database):
        self.db = db
        self._lock = threading.Lock()
        self._cache: dict | None = None
        self.listeners: list = []

    def all(self) -> dict:
        with self._lock:
            if self._cache is None:
                merged = dict(DEFAULT_SETTINGS)
                with self.db.read() as con:
                    for row in rows(con, "SELECT key, value_json FROM settings"):
                        if row["key"] in DEFAULT_SETTINGS:
                            merged[row["key"]] = loads(row["value_json"], merged[row["key"]])
                self._cache = merged
            return dict(self._cache)

    def public(self) -> dict:
        values = self.all()
        return {k: values[k] for k in PUBLIC_KEYS}

    def update(self, con, changes: dict, user: dict | None) -> dict:
        unknown = set(changes) - set(VALIDATORS)
        if unknown:
            raise ApiError(400, "INVALID_SETTING", f"Unknown setting: {', '.join(sorted(unknown))}")
        cleaned = {key: VALIDATORS[key](value) for key, value in changes.items()}
        current = self.all()
        if "ai_provider" in cleaned and cleaned["ai_provider"] != current["ai_provider"] and "ai_base_url" not in cleaned:
            cleaned["ai_base_url"] = AI_PROVIDER_DEFAULT_URLS[cleaned["ai_provider"]]
        if "ai_provider" in cleaned and cleaned["ai_provider"] != current["ai_provider"]:
            cleaned.setdefault("chat_model", "")
        now = now_iso()
        for key, value in cleaned.items():
            con.execute(
                "INSERT INTO settings(key, value_json, updated_at, updated_by) VALUES (?,?,?,?)"
                " ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at,"
                " updated_by = excluded.updated_by",
                (key, dumps(value), now, user["id"] if user else None),
            )
        with self._lock:
            self._cache = None
        for listener in self.listeners:
            listener(cleaned)
        return cleaned
