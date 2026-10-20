"""Course documents: storing uploads, turning them into searchable chunks, and finding text again.

Processing runs as a background job (state.jobs), one at a time, so a laptop stays usable
while a long recording is transcribed. The document row carries the status and a progress
line the Study page polls; failures are stored as a plain-English message for the student.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from ..db import now_iso, one, rows
from ..errors import ApiError, not_found
from ..images import MAX_IMAGE_BYTES, sniff_image
from ..llm import LLMError, LLMUnavailable
from ..llm.client import encode_image
from ..notify import notify
from . import Deleted, transcribe
from .chunking import chunk_sections
from .extract import (
    ExtractError, Section, check_length, clean_text, docx_sections, pdf_sections, pptx_sections, text_sections,
    timed_sections,
)
from .prompts import NOTES_PHOTO_SYSTEM, NOTES_PHOTO_USER
from .uploads import remove_quietly

log = logging.getLogger("learnly.study")

PREVIEW_CHARS = 600

PUBLIC_FIELDS = ("id", "title", "subject", "filename", "kind", "size_bytes", "status", "progress", "error",
                 "parts", "chars", "created_at", "updated_at")


def documents_dir(state) -> Path:
    return Path(state.uploads_dir) / "documents"


def stored_path(state, doc: dict) -> Path:
    return documents_dir(state) / doc["stored_name"]


def public(doc: dict) -> dict:
    return {k: doc[k] for k in PUBLIC_FIELDS}


def document_for(con, doc_id: str, user_id: str) -> dict:
    doc = one(con, "SELECT * FROM documents WHERE id = ?", (doc_id,))
    if doc is None or doc["user_id"] != user_id:
        raise not_found("The document")
    return doc


def list_documents(con, user_id: str) -> list[dict]:
    return [public(d) for d in rows(con, "SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 500", (user_id,))]


def detail(con, doc: dict) -> dict:
    chunks = rows(con, "SELECT idx, location, text FROM doc_chunks WHERE document_id = ? ORDER BY idx", (doc["id"],))
    out = public(doc)
    out["chunk_count"] = len(chunks)
    out["chunks"] = [
        {"idx": c["idx"], "location": c["location"],
         "text": c["text"] if len(c["text"]) <= PREVIEW_CHARS else c["text"][:PREVIEW_CHARS].rstrip() + "…"}
        for c in chunks
    ]
    return out


def ready_documents(con, user_id: str, doc_ids: list[str]) -> list[dict]:
    """The user's documents with these ids, all ready to study; otherwise a friendly error."""
    found = []
    for doc_id in dict.fromkeys(doc_ids):
        doc = document_for(con, doc_id, user_id)
        if doc["status"] != "ready":
            raise ApiError(409, "DOCUMENT_NOT_READY", f"“{doc['title']}” isn't ready yet. Wait for it to finish, or remove it from the selection.")
        found.append(doc)
    return found


def set_fields(state, doc_id: str, **fields) -> bool:
    """Update a document's row. False if it no longer exists (the student deleted it)."""
    fields["updated_at"] = now_iso()
    assignments = ", ".join(f"{k} = ?" for k in fields)
    with state.db.write() as con:
        return con.execute(f"UPDATE documents SET {assignments} WHERE id = ?", (*fields.values(), doc_id)).rowcount > 0


def delete_document(state, con, doc: dict) -> None:
    """Remove the row, its chunks and their search entries (inside the caller's transaction), then the file."""
    con.execute("DELETE FROM doc_chunks_fts WHERE document_id = ?", (doc["id"],))
    con.execute("DELETE FROM documents WHERE id = ?", (doc["id"],))
    remove_quietly(stored_path(state, doc))


# -- processing -------------------------------------------------------------------------------------
def start_processing(state, doc_id: str, user_id: str) -> None:
    job_id = state.jobs.create(user_id, "study.document", {"document_id": doc_id})
    state.jobs.start(job_id, lambda progress: process(state, doc_id, progress))


async def process(state, doc_id: str, progress) -> dict:
    """Read the file into chunks. Never raises: every outcome ends as a status on the document.
    Each step (speech-to-text as it goes, the photo reader) starts with a progress report, and a
    report on a document that has been deleted stops the work there."""
    with state.db.read() as con:
        doc = one(con, "SELECT * FROM documents WHERE id = ?", (doc_id,))
    if doc is None:  # deleted while waiting in line
        return {"status": "deleted"}

    def report(text: str) -> None:
        progress(text)
        if not set_fields(state, doc_id, progress=text[:200]):
            raise Deleted(doc_id)

    try:
        if not set_fields(state, doc_id, status="processing", error=None, progress="Reading the file"):
            raise Deleted(doc_id)
        sections, merge = await _sections(state, doc, report)
        chunks = chunk_sections(sections, merge=merge)
        if not chunks:
            raise ExtractError("No text was found in this file.")
        _store_chunks(state, doc_id, chunks)
    except Deleted:
        log.info("document %s was deleted while it was being read", doc_id)
        return {"status": "deleted"}
    except transcribe.NeedsTranscriber as exc:
        set_fields(state, doc_id, status="needs_transcriber", error=str(exc), progress="")
        return {"status": "needs_transcriber"}
    except ExtractError as exc:
        return _failed(state, doc, exc.message)
    except LLMUnavailable as exc:
        return _failed(state, doc, f"The local AI is needed to read photos of notes, but it isn't available: {exc}")
    except LLMError as exc:
        return _failed(state, doc, f"The AI couldn't read this photo: {exc}")
    except Exception:
        log.exception("processing document %s failed", doc_id)
        return _failed(state, doc, "Something went wrong reading this file. Try again, or save it in another format (PDF works best).")
    note = f"{len(chunks)} parts ready to study"
    set_fields(state, doc_id, status="ready", error=None, progress=note, parts=len(sections),
               chars=sum(len(s.text) for s in sections))
    if doc["kind"] in ("audio", "image"):  # the slow ones: worth a notification
        with state.db.write() as con:
            notify(con, doc["user_id"], "study", f"“{doc['title']}” is ready", "Its text can now be turned into revision material.",
                   f"#/study/doc/{doc_id}")
    return {"status": "ready", "chunks": len(chunks)}


def _failed(state, doc: dict, message: str) -> dict:
    set_fields(state, doc["id"], status="failed", error=message[:500], progress="")
    with state.db.write() as con:
        if one(con, "SELECT 1 AS x FROM documents WHERE id = ?", (doc["id"],)):
            notify(con, doc["user_id"], "study", f"“{doc['title']}” couldn't be read", message[:300], f"#/study/doc/{doc['id']}")
    return {"status": "failed"}


async def _sections(state, doc: dict, report) -> tuple[list[Section], bool]:
    """Sections of text for a document, and whether short sections should be merged (transcripts)."""
    path = stored_path(state, doc)
    kind = doc["kind"]
    if not path.exists():
        raise ExtractError("The uploaded file is missing. Delete this document and upload it again.")
    if kind == "audio":
        segments = await transcribe.transcribe(state, path, report)
        return check_length(timed_sections(segments)), True
    if kind == "image":
        report("Reading the photo with the AI")
        return await _photo_sections(state, path), False
    data = await asyncio.to_thread(path.read_bytes)
    ext = path.suffix.lower()
    report("Reading the text")
    if kind == "pdf":
        return await asyncio.to_thread(pdf_sections, data), False
    if kind == "slides":
        return await asyncio.to_thread(pptx_sections, data), False
    if kind == "doc":
        return await asyncio.to_thread(docx_sections, data), False
    return await asyncio.to_thread(text_sections, data, ext), ext in (".vtt", ".srt")


async def _photo_sections(state, path: Path) -> list[Section]:
    """Photos of notes are transcribed by the vision model."""
    status = await state.ai.status()
    if not status.get("ok"):
        raise LLMUnavailable((status.get("issues") or ["The local AI isn't running."])[0])
    if not status.get("vision"):
        raise ExtractError(
            f"{status.get('chat_model') or 'The installed model'} can't read photos. Install one that can "
            "(ollama pull qwen3.5:4b), or upload the notes as a PDF or Word file."
        )
    data = path.read_bytes()
    if len(data) > MAX_IMAGE_BYTES:
        raise ExtractError(f"This photo is too large for the AI to read. Use one under {MAX_IMAGE_BYTES // (1024 * 1024)} MB.")
    if sniff_image(data) is None:
        raise ExtractError("This photo couldn't be opened. Use a PNG, JPEG or WebP photo.")
    result = await state.ai.chat(
        [{"role": "system", "content": NOTES_PHOTO_SYSTEM},
         {"role": "user", "content": NOTES_PHOTO_USER, "images": [encode_image(data)]}],
        temperature=0.2, top_p=0.8, max_tokens=3000, num_ctx=8192,
    )
    text = clean_text(re.sub(r"^```(?:markdown|md)?\s*|\s*```$", "", result.content.strip()))
    if len(text) < 10 or text.upper().startswith("NO TEXT"):
        raise ExtractError("No writing could be read in this photo. Take it again in good light, straight on, with the page filling the photo.")
    return [Section("Photo", text)]


def _store_chunks(state, doc_id: str, chunks) -> None:
    """Replace the document's chunks and search entries in one transaction."""
    with state.db.write() as con:
        if one(con, "SELECT 1 AS x FROM documents WHERE id = ?", (doc_id,)) is None:
            raise Deleted(doc_id)  # deleted while it was being read
        con.execute("DELETE FROM doc_chunks_fts WHERE document_id = ?", (doc_id,))
        con.execute("DELETE FROM doc_chunks WHERE document_id = ?", (doc_id,))
        for idx, chunk in enumerate(chunks):
            cur = con.execute(
                "INSERT INTO doc_chunks(document_id, idx, location, text) VALUES (?,?,?,?)",
                (doc_id, idx, chunk.location[:120], chunk.text),
            )
            con.execute(
                "INSERT INTO doc_chunks_fts(text, chunk_id, document_id) VALUES (?,?,?)",
                (chunk.text, cur.lastrowid, doc_id),
            )


# -- search -----------------------------------------------------------------------------------------
HIT_START, HIT_END = "", ""  # marks matched words in snippets; the page turns them into <mark>
_WORD = re.compile(r"\w+", re.UNICODE)
_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]")  # Chinese, Japanese, Korean


def fts_query(text: str, any_word: bool = False) -> str:
    """A safe FTS5 query from what a student typed: each word quoted (so AND, NEAR, * and quotes
    are just words), all words required unless any_word."""
    words = _WORD.findall(text or "")[:12]
    return (" OR " if any_word else " ").join('"' + w.replace('"', '""') + '"' for w in words)


def search(con, user_id: str, q: str, document_id: str | None = None, limit: int = 30) -> list[dict]:
    """Find text in the student's ready documents. Falls back to a plain substring search, which also
    finds Chinese phrases that the word-based index can't split."""
    q = (q or "").strip()[:200]
    if not q:
        return []
    params: list = []
    scope = "d.user_id = ?"
    params.append(user_id)
    if document_id:
        scope += " AND d.id = ?"
        params.append(document_id)
    hits: list[dict] = []
    query = fts_query(q)
    if query:
        hits = rows(
            con,
            "SELECT d.id AS document_id, d.title, c.location, c.idx,"
            f" snippet(doc_chunks_fts, 0, '{HIT_START}', '{HIT_END}', '…', 16) AS snippet"
            " FROM doc_chunks_fts f JOIN doc_chunks c ON c.id = f.chunk_id JOIN documents d ON d.id = f.document_id"
            f" WHERE doc_chunks_fts MATCH ? AND {scope} ORDER BY rank LIMIT ?",
            (query, *params, limit),
        )
    if not hits:
        like = like_pattern(q)
        found = rows(
            con,
            "SELECT d.id AS document_id, d.title, c.location, c.idx, c.text FROM doc_chunks c"
            f" JOIN documents d ON d.id = c.document_id WHERE c.text LIKE ? ESCAPE '\\' AND {scope}"
            " ORDER BY d.created_at DESC, c.idx LIMIT ?",
            (like, *params, limit),
        )
        hits = [{**{k: r[k] for k in ("document_id", "title", "location", "idx")}, "snippet": _snippet(r["text"], q)} for r in found]
    return hits


def like_pattern(text: str) -> str:
    """A LIKE pattern matching `text` anywhere, with LIKE's own wildcards escaped (use ESCAPE '\\')."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _snippet(text: str, q: str, width: int = 90) -> str:
    at = text.lower().find(q.lower())
    if at < 0:
        return text[: width * 2]
    start, end = max(0, at - width), min(len(text), at + len(q) + width)
    return ("…" if start else "") + text[start:at] + HIT_START + text[at: at + len(q)] + HIT_END + text[at + len(q): end] + ("…" if end < len(text) else "")


def retrieve_for_topics(con, user_id: str, topics: list[str], per_topic: int = 6) -> list[dict]:
    """Chunks from the student's ready documents that best match each topic (for practising weak topics).
    The word index can't split Chinese (光合作用 inside 光合作用在葉綠體中進行 isn't a separate word),
    so a Chinese topic, or one the index finds nothing for, is also looked up as a plain phrase,
    as search() does."""
    seen: dict[int, dict] = {}
    for topic in topics:
        query = fts_query(topic, any_word=True)
        found = rows(
            con,
            "SELECT c.id, c.document_id, c.idx, c.location, c.text, d.title FROM doc_chunks_fts f"
            " JOIN doc_chunks c ON c.id = f.chunk_id JOIN documents d ON d.id = f.document_id"
            " WHERE doc_chunks_fts MATCH ? AND d.user_id = ? AND d.status = 'ready' ORDER BY rank LIMIT ?",
            (query, user_id, per_topic),
        ) if query else []
        if topic.strip() and len(found) < per_topic and (not found or _CJK.search(topic)):
            found += rows(
                con,
                "SELECT c.id, c.document_id, c.idx, c.location, c.text, d.title FROM doc_chunks c"
                " JOIN documents d ON d.id = c.document_id"
                " WHERE c.text LIKE ? ESCAPE '\\' AND d.user_id = ? AND d.status = 'ready' ORDER BY d.created_at DESC, c.idx LIMIT ?",
                (like_pattern(topic.strip()), user_id, per_topic),
            )
        for row in found:
            seen.setdefault(row["id"], row)
    return list(seen.values())
