"""Append-only audit log. Each entry carries the hash of the one before it, so edits are detectable."""

from __future__ import annotations

import hashlib
import json

from ..db import dumps, now_iso, one, rows

GENESIS = "0" * 64


def _entry_hash(entry: dict) -> str:
    material = {
        "seq": entry["seq"],
        "at": entry["at"],
        "actor_id": entry["actor_id"],
        "actor_email": entry["actor_email"],
        "action": entry["action"],
        "target_type": entry["target_type"],
        "target_id": entry["target_id"],
        "details_json": entry["details_json"],
        "ip": entry["ip"],
        "prev_hash": entry["prev_hash"],
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class AuditLog:
    def record(
        self,
        con,
        *,
        action: str,
        actor: dict | None = None,
        target_type: str = "",
        target_id: str = "",
        details: dict | None = None,
        ip: str = "",
    ) -> dict:
        """Add an entry inside the caller's write transaction."""
        last = one(con, "SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1")
        entry = {
            "seq": (last["seq"] + 1) if last else 1,
            "at": now_iso(),
            "actor_id": actor["id"] if actor else None,
            "actor_email": actor["email"] if actor else "",
            "action": action,
            "target_type": target_type,
            "target_id": str(target_id or ""),
            "details_json": dumps(details or {}),
            "ip": ip or "",
            "prev_hash": last["hash"] if last else GENESIS,
        }
        entry["hash"] = _entry_hash(entry)
        con.execute(
            "INSERT INTO audit_log(seq, at, actor_id, actor_email, action, target_type, target_id, details_json, ip, prev_hash, hash)"
            " VALUES (:seq, :at, :actor_id, :actor_email, :action, :target_type, :target_id, :details_json, :ip, :prev_hash, :hash)",
            entry,
        )
        return entry

    def verify(self, con) -> dict:
        prev = GENESIS
        count = 0
        for entry in con.execute("SELECT * FROM audit_log ORDER BY seq"):
            entry = dict(entry)
            count += 1
            if entry["seq"] != count:
                return {"ok": False, "entries": count, "broken_at": entry["seq"], "reason": "An entry is missing."}
            if entry["prev_hash"] != prev:
                return {"ok": False, "entries": count, "broken_at": entry["seq"], "reason": "The chain link to the previous entry doesn't match."}
            if _entry_hash(entry) != entry["hash"]:
                return {"ok": False, "entries": count, "broken_at": entry["seq"], "reason": "The entry was changed after it was written."}
            prev = entry["hash"]
        return {"ok": True, "entries": count, "broken_at": None, "head": prev}

    def page(self, con, *, limit: int = 50, before: int | None = None, action: str = "") -> list[dict]:
        sql = "SELECT * FROM audit_log WHERE 1=1"
        params: list = []
        if before:
            sql += " AND seq < ?"
            params.append(before)
        if action:
            sql += " AND action LIKE ?"
            params.append(action.replace("%", "") + "%")
        sql += " ORDER BY seq DESC LIMIT ?"
        params.append(limit)
        return rows(con, sql, tuple(params))
