"""In-app notifications (the bell in the header)."""

from __future__ import annotations

from .db import new_id, now_iso, rows


def notify(con, user_id: str, kind: str, title: str, body: str = "", link: str = "") -> None:
    con.execute(
        "INSERT INTO notifications(id, user_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)",
        (new_id("ntf"), user_id, kind, title[:200], body[:1000], link[:300], now_iso()),
    )


def notify_admins(con, kind: str, title: str, body: str = "", link: str = "") -> None:
    for admin in rows(con, "SELECT id FROM users WHERE role = 'admin'"):
        notify(con, admin["id"], kind, title, body, link)
