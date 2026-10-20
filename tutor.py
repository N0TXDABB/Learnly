"""The tutor: chat sessions with the local model, using the OmniSolve-style system prompt."""

from __future__ import annotations

from contextlib import aclosing
from typing import AsyncIterator

from .db import new_id, now_iso, one, rows
from .errors import ApiError, not_found
from .llm.tutor_prompt import SOURCE_LABELS, tutor_system_prompt

HISTORY_MESSAGES = 16


def session_for(con, session_id: str, user_id: str) -> dict:
    session = one(con, "SELECT * FROM tutor_sessions WHERE id = ?", (session_id,))
    if session is None or session["user_id"] != user_id:
        raise not_found("The tutor session")
    return session


def create_session(con, user_id: str, title: str = "") -> dict:
    session_id = new_id("ts")
    now = now_iso()
    con.execute(
        "INSERT INTO tutor_sessions(id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)",
        (session_id, user_id, (title or "New session")[:80], now, now),
    )
    return one(con, "SELECT * FROM tutor_sessions WHERE id = ?", (session_id,))


def list_sessions(con, user_id: str) -> list[dict]:
    return rows(
        con,
        "SELECT s.*, (SELECT COUNT(*) FROM tutor_messages m WHERE m.session_id = s.id) AS messages"
        " FROM tutor_sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC LIMIT 100",
        (user_id,),
    )


def messages_of(con, session_id: str) -> list[dict]:
    return rows(
        con,
        "SELECT id, role, content, has_image, created_at FROM tutor_messages WHERE session_id = ? ORDER BY created_at, rowid",
        (session_id,),
    )


def info(settings: dict, ai_status: dict) -> dict:
    _, source = tutor_system_prompt(settings)
    return {
        "prompt_source": source,
        "prompt_label": SOURCE_LABELS[source],
        "model": ai_status.get("chat_model", ""),
        "vision": bool(ai_status.get("vision")),
        "thinking": bool(ai_status.get("thinking")),
        "ready": bool(ai_status.get("ok")),
        "issues": ai_status.get("issues", []),
    }


async def answer(state, user: dict, session_id: str, text: str, image_b64: str | None, think: bool) -> AsyncIterator[tuple[str, dict]]:
    """Save the question, stream the tutor's answer, then save the answer."""
    text = (text or "").strip()
    if not text and not image_b64:
        raise ApiError(400, "EMPTY_MESSAGE", "Type a question or attach a photo.")
    with state.db.write() as con:
        session = session_for(con, session_id, user["id"])
        history = messages_of(con, session_id)[-HISTORY_MESSAGES:]
        now = now_iso()
        con.execute(
            "INSERT INTO tutor_messages(id, session_id, role, content, has_image, created_at) VALUES (?,?,?,?,?,?)",
            (new_id("tm"), session_id, "user", text or "(photo)", 1 if image_b64 else 0, now),
        )
        if session["title"] == "New session" and text:
            con.execute("UPDATE tutor_sessions SET title = ? WHERE id = ?", (text.splitlines()[0][:70], session_id))
        con.execute("UPDATE tutor_sessions SET updated_at = ? WHERE id = ?", (now, session_id))

    prompt, _source = tutor_system_prompt(state.settings.all())
    messages = [{"role": "system", "content": prompt}]
    messages += [{"role": m["role"], "content": m["content"]} for m in history]
    question = {"role": "user", "content": text or "Please help me with the problem in this photo."}
    if image_b64:
        question["images"] = [image_b64]
    messages.append(question)

    # Qwen's recommended sampling: thinking mode 0.6 / 0.95; direct answers 0.7 / 0.8.
    sampling = {"temperature": 0.6, "top_p": 0.95} if think else {"temperature": 0.7, "top_p": 0.8}
    parts: list[str] = []
    model = ""
    pieces = state.ai.chat_stream(messages, think=think, max_tokens=4096 if think else 2048, num_ctx=16384, **sampling)
    async with aclosing(pieces):  # leaving early closes the request, so the AI stops writing
        async for piece in pieces:
            if piece["type"] == "token":
                parts.append(piece["text"])
                yield "token", {"text": piece["text"]}
            elif piece["type"] == "thinking":
                yield "thinking", {"text": piece["text"]}
            elif piece["type"] == "done":
                model = piece.get("model", "")
    reply = "".join(parts).strip() or "_The model returned an empty answer. Try again, or switch off 'Think it through'._"
    message_id = new_id("tm")
    with state.db.write() as con:
        con.execute(
            "INSERT INTO tutor_messages(id, session_id, role, content, created_at) VALUES (?,?,?,?,?)",
            (message_id, session_id, "assistant", reply, now_iso()),
        )
    yield "done", {"message_id": message_id, "model": model}
