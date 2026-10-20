"""Revision material made from documents: chapter outlines, flashcard decks, quizzes and mock exams.

A material row holds its options, status and progress; its content (outline Markdown or quiz
questions, with answers) is stored as JSON, and flashcards live in their own table so each
card can be scheduled for review. Answers never leave the server until an attempt is graded.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..db import dumps, loads, new_id, now_iso, one, parse_iso, rows
from ..errors import ApiError, not_found
from .leitner import MASTERED_BOX, interval_labels

KIND_NAMES = {"outline": "Chapter outline", "flashcards": "Flashcards", "quiz": "Quiz", "exam": "Mock exam"}
QUESTION_TYPES = ("choice", "truefalse", "short")
# kind -> (default count, smallest, largest)
COUNTS = {"flashcards": (20, 5, 60), "quiz": (10, 5, 30), "exam": (20, 10, 50)}
DEFAULT_EXAM_MINUTES = 45


def clean_options(kind: str, options: dict) -> dict:
    """Fill in defaults and check ranges, with messages a student understands."""
    out: dict = {}
    if kind in COUNTS:
        default, low, high = COUNTS[kind]
        count = options.get("count") or default
        if not low <= count <= high:
            noun = "flashcards" if kind == "flashcards" else "questions"
            raise ApiError(400, "INVALID_OPTIONS", f"Choose between {low} and {high} {noun}.")
        out["count"] = int(count)
    out["difficulty"] = options.get("difficulty") or "mixed"
    focus = (options.get("focus") or "").strip()
    if focus:
        out["focus"] = focus[:200]
    if kind in ("quiz", "exam"):
        wanted = options.get("question_types")
        types = [t for t in QUESTION_TYPES if t in (QUESTION_TYPES if wanted is None else wanted)]
        if not types:
            raise ApiError(400, "INVALID_OPTIONS", "Choose at least one type of question.")
        out["question_types"] = types
        minutes = options.get("time_limit_min")
        if kind == "exam":
            minutes = minutes or DEFAULT_EXAM_MINUTES
        if minutes:
            if not 5 <= int(minutes) <= 240:
                raise ApiError(400, "INVALID_OPTIONS", "Choose a time limit between 5 and 240 minutes.")
            out["time_limit_min"] = int(minutes)
    return out


def default_title(kind: str, docs: list[dict], focus: str = "") -> str:
    base = docs[0]["title"] if docs else "your notes"
    if len(docs) > 1:
        base += f" + {len(docs) - 1} more"
    if focus:
        base = f"{focus} ({base})"
    return f"{KIND_NAMES[kind]}: {base}"[:120]


def create(con, user_id: str, kind: str, title: str, subject: str, document_ids: list[str], options: dict) -> dict:
    material_id = new_id("mat")
    now = now_iso()
    con.execute(
        "INSERT INTO materials(id, user_id, kind, title, subject, document_ids_json, options_json, status, progress, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (material_id, user_id, kind, title[:120], subject[:80], dumps(document_ids), dumps(options), "queued",
         "Waiting to start", now, now),
    )
    return one(con, "SELECT * FROM materials WHERE id = ?", (material_id,))


def material_for(con, material_id: str, user_id: str) -> dict:
    material = one(con, "SELECT * FROM materials WHERE id = ?", (material_id,))
    if material is None or material["user_id"] != user_id:
        raise not_found("That revision material")
    return material


def _counts(con, material: dict, content: dict) -> dict:
    if material["kind"] == "flashcards":
        row = one(
            con,
            "SELECT COUNT(*) AS cards, SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END) AS due,"
            " SUM(CASE WHEN box >= ? THEN 1 ELSE 0 END) AS mastered FROM flashcards WHERE material_id = ?",
            (now_iso(), MASTERED_BOX, material["id"]),
        )
        return {"cards": row["cards"] or 0, "due": row["due"] or 0, "mastered": row["mastered"] or 0}
    if material["kind"] in ("quiz", "exam"):
        questions = content.get("questions") or []
        return {"questions": len(questions), "points": sum(q.get("points", 1) for q in questions)}
    return {"parts": content.get("parts", 0)}


def public_question(q: dict) -> dict:
    """A question as the student sees it before answering: no answer, no explanation."""
    out = {k: q[k] for k in ("index", "type", "question", "topic", "source", "points")}
    if q["type"] in ("choice", "truefalse"):
        out["choices"] = q["choices"]
    return out


def card_out(card: dict) -> dict:
    """A card for the page. Its button labels say when it comes back after each answer, which for a
    card practised early (not yet due) is simply its current date, unless it is forgotten."""
    due_at = parse_iso(card["due_at"])
    due_in = due_at - datetime.now(timezone.utc) if due_at else None
    return {
        "id": card["id"], "material_id": card["material_id"], "front": card["front"], "back": card["back"],
        "topic": card["topic"], "source": card["source"], "box": card["box"], "due_at": card["due_at"],
        "reviews": card["reviews"], "intervals": interval_labels(card["box"], due_in),
    }


def public(con, material: dict, with_content: bool = False) -> dict:
    content = loads(material["content_json"], {}) or {}
    out = {
        "id": material["id"], "kind": material["kind"], "title": material["title"], "subject": material["subject"],
        "document_ids": loads(material["document_ids_json"], []), "options": loads(material["options_json"], {}),
        "status": material["status"], "progress": material["progress"], "error": material["error"],
        "model": material["model"], "created_at": material["created_at"], "updated_at": material["updated_at"],
        "counts": _counts(con, material, content),
    }
    if with_content and material["status"] == "ready":
        if material["kind"] == "outline":
            out["content"] = {"markdown": content.get("markdown", "")}
        elif material["kind"] == "flashcards":
            cards = rows(con, "SELECT * FROM flashcards WHERE material_id = ? ORDER BY idx", (material["id"],))
            out["content"] = {"cards": [card_out(c) for c in cards]}
        else:
            out["content"] = {
                "questions": [public_question(q) for q in content.get("questions", [])],
                "time_limit_min": content.get("time_limit_min"),
            }
    return out


def list_materials(con, user_id: str, kind: str | None = None) -> list[dict]:
    sql = "SELECT * FROM materials WHERE user_id = ?"
    params: list = [user_id]
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    return [public(con, m) for m in rows(con, sql + " ORDER BY created_at DESC LIMIT 300", tuple(params))]


def set_fields(state, material_id: str, **fields) -> bool:
    """Update a material's row. False if it no longer exists (the student deleted it)."""
    fields["updated_at"] = now_iso()
    assignments = ", ".join(f"{k} = ?" for k in fields)
    with state.db.write() as con:
        return con.execute(f"UPDATE materials SET {assignments} WHERE id = ?", (*fields.values(), material_id)).rowcount > 0
