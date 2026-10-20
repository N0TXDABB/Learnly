"""Reviewing and self-testing: flashcard reviews, quiz and exam attempts, weak topics, overview.

Every reviewed card and every answered question adds a row to topic_results, so weak topics
can be found across flashcards, quizzes, exams and homework practice alike.
"""

from __future__ import annotations

import logging
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..db import dumps, iso, loads, new_id, now_iso, one, parse_iso, rows
from ..errors import ApiError, not_found
from ..llm import LLMError
from ..llm.structured import chat_json
from . import documents as docs
from . import generate, leitner
from . import materials as mat
from . import prompts
from .chunking import estimate_tokens

log = logging.getLogger("learnly.study")

UNMARKED = "Couldn't be marked automatically — compare your answer with the model answer."
WEAK_ACCURACY = 0.75
RECENT_RESULTS = 10  # a topic's accuracy is judged on its latest results, so improvement shows
MARKING_TOKENS = 3500  # short answers sent to the model per marking request …
MARKING_ITEMS = 12  # … and at most this many, so the marks fit in the reply
TIME_GRACE_S = 60  # exam answers arriving this soon after the deadline still count (slow Wi-Fi, a busy laptop)


# -- flashcards ---------------------------------------------------------------------------------------
def due_cards(con, user_id: str, material_id: str | None = None, limit: int = 50, include_all: bool = False) -> dict:
    """Cards to review now, most overdue first. With include_all, a whole deck (for extra practice)."""
    now = now_iso()
    where, params = "f.user_id = ?", [user_id]
    if material_id:
        mat.material_for(con, material_id, user_id)
        where += " AND f.material_id = ?"
        params.append(material_id)
    due_total = one(con, f"SELECT COUNT(*) AS n FROM flashcards f WHERE {where} AND f.due_at <= ?", (*params, now))["n"]
    if not include_all:
        where += " AND f.due_at <= ?"
        params.append(now)
    found = rows(
        con,
        f"SELECT f.*, m.title AS deck FROM flashcards f JOIN materials m ON m.id = f.material_id WHERE {where}"
        " ORDER BY f.due_at, f.idx LIMIT ?",
        (*params, limit),
    )
    return {"cards": [{**mat.card_out(c), "deck": c["deck"]} for c in found], "due_total": due_total}


def review_card(con, user_id: str, card_id: str, grade: str) -> dict:
    """Move the card between Leitner boxes and record how well it was remembered. A card practised
    before it is due only moves if it was forgotten (see leitner.schedule)."""
    card = one(con, "SELECT f.*, m.subject FROM flashcards f JOIN materials m ON m.id = f.material_id WHERE f.id = ?", (card_id,))
    if card is None or card["user_id"] != user_id:
        raise not_found("The flashcard")
    now = datetime.now(timezone.utc)
    box, due_at = leitner.schedule(card["box"], parse_iso(card["due_at"]) or now, grade, now)
    con.execute(
        "UPDATE flashcards SET box = ?, due_at = ?, reviews = reviews + 1, lapses = lapses + ?, last_reviewed_at = ? WHERE id = ?",
        (box, iso(due_at), 1 if grade == "again" else 0, iso(now), card_id),
    )
    _record(con, user_id, "flashcard", card_id, card["subject"], card["topic"], leitner.GRADE_SCORE[grade])
    return mat.card_out(one(con, "SELECT * FROM flashcards WHERE id = ?", (card_id,)))


def _record(con, user_id: str, source: str, ref_id: str, subject: str, topic: str, correct: float) -> None:
    con.execute(
        "INSERT INTO topic_results(user_id, source, ref_id, subject, topic, correct, created_at) VALUES (?,?,?,?,?,?,?)",
        (user_id, source, ref_id, subject or "", (topic or "General").strip()[:80], max(0.0, min(1.0, correct)), now_iso()),
    )


# -- checking short answers without the AI ------------------------------------------------------------------
# Only clear matches are marked here; anything doubtful goes to the AI, which reads the question.
_ARTICLES = re.compile(r"^(?:the|a|an)\s+")
# Digits and maths signs. Answers with these are compared symbol for symbol, never word by word, so
# "-3" isn't taken for "3", "1.2" for "1/2" or "10^-3" for "10^3". A hyphen between two letters
# ("light-dependent") is part of a word, not a minus sign.
_MATHS = re.compile(r"[\d+/^=<>%×÷√±π]|(?<![^\W\d_])-|-(?![^\W\d_])")
_NUMBER = re.compile(
    r"([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+)(?:\s*/\s*(\d+(?:\.\d+)?))?\s*(%|[a-zµ°²³/]+)?"
)
EXACT = math.inf  # the precision of a fraction such as 3/4


@dataclass(frozen=True)
class Number:
    """A number as the student or the model wrote it, with how precisely it was written."""

    value: float
    unit: str = ""  # "%", "cm", "°c", or "" for none
    decimals: float = 0  # digits after the decimal point; EXACT for a fraction
    figures: float = 0  # significant figures: "3.14" has 3, "0.0" has none; EXACT for a fraction

    def as_proportion(self) -> Number:
        """50% as 0.5 (two more decimals, same significant figures)."""
        return Number(self.value / 100, "", self.decimals + 2, self.figures)


def _plain(text: str) -> str:
    """Lower case, standard Unicode forms, one kind of minus sign, and no $ signs from LaTeX maths."""
    text = unicodedata.normalize("NFKC", str(text or "")).lower().strip()
    return text.replace("−", "-").replace("–", "-").replace("$", "")


def normalise_answer(text: str) -> str:
    return _ARTICLES.sub("", generate.normalise(text))


def has_maths(text: str) -> bool:
    return bool(_MATHS.search(_plain(text)))


def maths_key(text: str) -> str:
    """An answer with numbers or maths signs, for comparing symbol for symbol: only spaces and a final
    full stop are ignored."""
    return re.sub(r"\s+", "", _plain(text)).rstrip(".")


def parse_numbers(text: str) -> list[Number] | None:
    """Numbers in an answer like "x = 3", "1,250", "3/4", "50%", "2.5 cm", "x = 2 or x = -3", "±4",
    smallest first, or None if the answer isn't just numbers."""
    t = _plain(text).rstrip(".")
    t = re.sub(r"\b[a-z]\s*=\s*", "", t)
    t = re.sub(r"±\s*([\d.]+)", r"\1, -\1", t)
    pieces = [p for p in re.split(r"\s*(?:;|,(?=\s)|\bor\b|\band\b)\s*", t) if p.strip()]
    if not pieces:
        return None
    out = []
    for piece in pieces:
        match = _NUMBER.fullmatch(piece.strip())
        if not match:
            return None
        number, denominator, unit = match.groups()
        number = number.replace(",", "")
        value = float(number)
        if denominator:
            if float(denominator) == 0:
                return None
            out.append(Number(value / float(denominator), unit or "", EXACT, EXACT))
            continue
        decimals = len(number.split(".")[1]) if "." in number else 0
        figures = len(re.sub(r"\D", "", number).lstrip("0"))
        out.append(Number(value, unit or "", decimals, figures))
    return sorted(out, key=lambda n: n.value)


def _agree(given: Number, expected: Number) -> bool:
    """Equal, or equal once the rounding of the less precise one is allowed for:
    the student rounded the model answer ("3.14" for 3.14159) keeping at least 3 significant figures,
    so "0.7" isn't accepted for 0.67, nor "0.0" for 0.04; or the model answer is a rounded decimal
    and the student's answer rounds to it ("0.667" or "2/3" for 0.67)."""
    gap = abs(given.value - expected.value)
    if gap <= 1e-9 * max(1.0, abs(expected.value)):
        return True
    if 1 <= given.decimals < expected.decimals and given.figures >= 3:
        return gap <= 0.5 * 10 ** -given.decimals + 1e-12
    if 1 <= expected.decimals < given.decimals:
        return gap <= 0.5 * 10 ** -expected.decimals + 1e-12
    return False


def _close(given: Number, expected: Number) -> bool:
    units = {given.unit, expected.unit} - {""}
    if len(units) > 1:  # "5 cm" against "5 m", or "50%" against "50 cm"
        return False
    if given.unit == expected.unit or "%" not in units:  # the same unit, or one left off ("37" for "37°C")
        return _agree(given, expected)
    # A percentage against a plain number, which is either a proportion (0.5 for 50%) or a percentage
    # written without its sign (50 for 50%). It is read one way only, by its size, so neither
    # 5000% for 50 nor 0.5% for 0.5 counts as a match.
    plain = expected if given.unit == "%" else given
    if abs(plain.value) <= 1:
        given = given.as_proportion() if given.unit == "%" else given
        expected = expected.as_proportion() if expected.unit == "%" else expected
    return _agree(given, expected)


def numbers_equal(given: str, expected: str) -> bool:
    a, b = parse_numbers(given), parse_numbers(expected)
    if not a or not b or len(a) != len(b):
        return False
    return all(_close(x, y) for x, y in zip(a, b))


def check_without_ai(given: str, expected: str) -> str | None:
    """"exact" or "numeric" if the answer clearly matches the model answer, else None (the AI decides).
    Answers in words are compared word for word, ignoring case, punctuation and a leading "the";
    answers with numbers or maths signs symbol for symbol, then by value."""
    if has_maths(given) or has_maths(expected):
        if maths_key(given) and maths_key(given) == maths_key(expected):
            return "exact"
        return "numeric" if numbers_equal(given, expected) else None
    if normalise_answer(given) and normalise_answer(given) == normalise_answer(expected):
        return "exact"
    return None


# -- quiz and exam attempts -----------------------------------------------------------------------------------
def attempt_for(con, attempt_id: str, user_id: str) -> dict:
    attempt = one(con, "SELECT * FROM quiz_attempts WHERE id = ?", (attempt_id,))
    if attempt is None or attempt["user_id"] != user_id:
        raise not_found("That attempt")
    return attempt


def _deadline(attempt: dict) -> str | None:
    if not attempt["time_limit_min"]:
        return None
    return iso(parse_iso(attempt["started_at"]) + timedelta(minutes=attempt["time_limit_min"]))


def attempt_out(con, attempt: dict, material: dict | None = None) -> dict:
    material = material or one(con, "SELECT * FROM materials WHERE id = ?", (attempt["material_id"],))
    content = loads(material["content_json"], {}) if material else {}
    out = {
        "id": attempt["id"], "material_id": attempt["material_id"], "title": material["title"] if material else "",
        "kind": material["kind"] if material else "quiz", "status": attempt["status"],
        "started_at": attempt["started_at"], "finished_at": attempt["finished_at"],
        "time_limit_min": attempt["time_limit_min"], "deadline": _deadline(attempt),
        "answers": loads(attempt["answers_json"], {}) or {},
    }
    if attempt["status"] == "graded":
        results = loads(attempt["results_json"], [])
        out.update(score=attempt["score"], max_score=attempt["max_score"], percent=_percent(attempt["score"], attempt["max_score"]),
                   results=results, topics=topic_breakdown(results))
    else:
        out["questions"] = [mat.public_question(q) for q in content.get("questions", [])]
        if out["deadline"]:
            out["seconds_left"] = max(0, int((parse_iso(out["deadline"]) - parse_iso(now_iso())).total_seconds()))
            out["time_up"] = out["seconds_left"] == 0
    return out


def _percent(score: float, max_score: float) -> int:
    return round(100 * score / max_score) if max_score else 0


def topic_breakdown(results: list[dict]) -> list[dict]:
    """Per topic: how many questions, and how many were answered correctly (partial credit counts in part)."""
    groups: dict[str, dict] = {}
    for r in results:
        key = topic_key(r.get("topic", ""))
        group = groups.setdefault(key, {"topic": r.get("topic") or "General", "correct": 0.0, "total": 0})
        group["correct"] += r.get("correct", 0)
        group["total"] += 1
    out = [{**g, "correct": round(g["correct"], 1)} for g in groups.values()]
    return sorted(out, key=lambda g: (g["correct"] / g["total"], g["topic"].lower()))


def start_attempt(con, user_id: str, material: dict) -> tuple[dict, bool]:
    """A new attempt, or the unfinished one for this quiz (returns (attempt, resumed)).
    An unfinished exam whose time has run out comes back too, with time_up set, so the page can
    hand it in and show its results, rather than quietly starting a new paper."""
    if material["kind"] not in ("quiz", "exam"):
        raise ApiError(400, "NOT_A_QUIZ", "Only quizzes and mock exams can be taken.")
    if material["status"] != "ready":
        raise ApiError(409, "MATERIAL_NOT_READY", "This isn't ready yet. Wait until it has finished being written.")
    current = one(
        con, "SELECT * FROM quiz_attempts WHERE material_id = ? AND user_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1",
        (material["id"], user_id),
    )
    if current is not None:
        return current, True
    content = loads(material["content_json"], {})
    attempt_id = new_id("att")
    minutes = content.get("time_limit_min") if material["kind"] == "exam" else None
    con.execute(
        "INSERT INTO quiz_attempts(id, material_id, user_id, status, time_limit_min, started_at) VALUES (?,?,?,?,?,?)",
        (attempt_id, material["id"], user_id, "in_progress", minutes, now_iso()),
    )
    return one(con, "SELECT * FROM quiz_attempts WHERE id = ?", (attempt_id,)), False


def expired(attempt: dict, grace_s: int = 0) -> bool:
    deadline = _deadline(attempt)
    return bool(deadline) and (parse_iso(now_iso()) - parse_iso(deadline)).total_seconds() > grace_s


def clean_answers(answers: dict, questions: list[dict]) -> dict:
    """Keep only answers to real questions: a choice index for choice/true-false, text for short answers."""
    by_index = {str(q["index"]): q for q in questions}
    out = {}
    for key, value in (answers or {}).items():
        q = by_index.get(str(key))
        if q is None or value is None or value == "":
            continue
        if q["type"] in ("choice", "truefalse"):
            index = generate.as_index(value)
            if index is not None and 0 <= index < len(q["choices"]):
                out[str(key)] = index
        else:
            out[str(key)] = str(value)[:2000]
    return out


def save_answers(con, attempt: dict, answers: dict) -> dict:
    """Autosave. An exam's answers can't change once its time is up (the page's timer isn't trusted)."""
    if attempt["status"] != "in_progress":
        raise ApiError(409, "ATTEMPT_FINISHED", "This attempt has already been handed in.")
    if expired(attempt, grace_s=TIME_GRACE_S):
        raise ApiError(409, "TIME_UP", "Time's up for this exam, so answers can't be changed now. Hand it in to see your results.")
    material = one(con, "SELECT content_json FROM materials WHERE id = ?", (attempt["material_id"],))
    cleaned = clean_answers(answers, loads(material["content_json"], {}).get("questions", []))
    con.execute("UPDATE quiz_attempts SET answers_json = ? WHERE id = ?", (dumps(cleaned), attempt["id"]))
    return {"saved": True, "saved_at": now_iso(), "answered": len(cleaned)}


async def submit(state, user_id: str, attempt_id: str, answers: dict | None) -> dict:
    """Mark an attempt. Choice and true/false answers are checked directly; short answers by matching
    the model answer, then by one batched AI request for the rest. If the AI can't mark them, those
    answers get 0 with a note to compare with the model answer (and aren't counted as weak topics).
    Answers sent after an exam's time is up are ignored: the ones saved before the deadline count."""
    with state.db.write() as con:
        attempt = attempt_for(con, attempt_id, user_id)
        material = one(con, "SELECT * FROM materials WHERE id = ?", (attempt["material_id"],))
        if attempt["status"] == "graded":
            return attempt_out(con, attempt, material)
        if attempt["status"] == "grading":
            raise ApiError(409, "ALREADY_MARKING", "These answers are already being marked. Wait a moment.")
        questions = loads(material["content_json"], {}).get("questions", [])
        late = expired(attempt, grace_s=TIME_GRACE_S)
        merged = {**(loads(attempt["answers_json"], {}) or {}), **({} if late else (answers or {}))}
        given = clean_answers(merged, questions)
        con.execute("UPDATE quiz_attempts SET status = 'grading', answers_json = ? WHERE id = ?", (dumps(given), attempt_id))
    try:
        results = await grade(state, questions, given)
    except BaseException:
        with state.db.write() as con:
            con.execute("UPDATE quiz_attempts SET status = 'in_progress' WHERE id = ?", (attempt_id,))
        raise
    score = sum(r["score"] for r in results)
    max_score = sum(r["points"] for r in results)
    source = "exam" if material["kind"] == "exam" else "quiz"
    with state.db.write() as con:
        con.execute(
            "UPDATE quiz_attempts SET status = 'graded', results_json = ?, score = ?, max_score = ?, finished_at = ? WHERE id = ?",
            (dumps(results), score, max_score, now_iso(), attempt_id),
        )
        for r in results:
            if r["method"] != "unmarked":
                _record(con, user_id, source, attempt_id, material["subject"], r["topic"], r["correct"])
        return attempt_out(con, attempt_for(con, attempt_id, user_id), material)


async def grade(state, questions: list[dict], given: dict) -> list[dict]:
    results, for_ai = [], []
    for q in questions:
        answer = given.get(str(q["index"]))
        result = {
            "index": q["index"], "type": q["type"], "question": q["question"], "topic": q.get("topic") or "General",
            "source": q.get("source", ""), "points": q.get("points", 1), "explanation": q.get("explanation", ""),
            "expected": q["answer"], "your_answer": "", "correct": 0.0, "score": 0.0, "feedback": "", "method": "exact",
        }
        if q["type"] in ("choice", "truefalse"):
            result["choices"] = q["choices"]
            result["answer_index"] = q["answer_index"]
            result["your_index"] = answer
            if answer is not None:
                result["your_answer"] = q["choices"][answer]
                result["correct"] = 1.0 if answer == q["answer_index"] else 0.0
            else:
                result["feedback"] = "No answer given."
        else:
            result["marking_points"] = q.get("marking_points", [])
            result["your_answer"] = answer or ""
            method = check_without_ai(answer or "", q["answer"]) if answer else None
            if not answer:
                result["feedback"] = "No answer given."
            elif method:
                result.update(correct=1.0, method=method, feedback="Matches the model answer.")
            else:
                result["method"] = "ai"
                for_ai.append(result)
        results.append(result)
    if for_ai:
        await mark_with_ai(state, for_ai)
    for r in results:
        r["score"] = round(r["correct"] * r["points"], 2)
    return results


async def mark_with_ai(state, results: list[dict]) -> None:
    """Fill in correct/feedback for short answers, in as few AI requests as fit the context window."""
    batches, batch, size = [], [], 0
    for r in results:
        cost = estimate_tokens(r["question"] + r["expected"] + r["your_answer"]) + 60
        if batch and (size + cost > MARKING_TOKENS or len(batch) >= MARKING_ITEMS):
            batches.append(batch)
            batch, size = [], 0
        batch.append(r)
        size += cost
    if batch:
        batches.append(batch)
    for batch in batches:
        items = [{"index": r["index"], "question": r["question"], "answer": r["expected"],
                  "marking_points": r.get("marking_points"), "student_answer": r["your_answer"]} for r in batch]
        marks: dict[int, dict] = {}
        try:
            data, _model = await chat_json(state.ai, prompts.marks_messages(items), prompts.MARKS_SCHEMA,
                                           max_tokens=120 * len(items) + 200, num_ctx=generate.NUM_CTX)
            marks = {int(m["index"]): m for m in data.get("marks", []) if isinstance(m, dict) and "index" in m}
        except LLMError as exc:  # includes the AI being offline
            log.warning("AI marking failed: %s", exc)
        for r in batch:
            mark = marks.get(r["index"])
            if mark is None:
                r.update(correct=0.0, method="unmarked", feedback=UNMARKED)
                continue
            score = mark.get("score", 0)
            score = max(0.0, min(1.0, float(score))) if isinstance(score, (int, float)) else 0.0
            r.update(correct=round(score, 2), feedback=str(mark.get("feedback") or "").strip()[:400])


def list_attempts(con, user_id: str, material_id: str | None = None, limit: int = 100) -> list[dict]:
    where, params = "a.user_id = ?", [user_id]
    if material_id:
        mat.material_for(con, material_id, user_id)
        where += " AND a.material_id = ?"
        params.append(material_id)
    found = rows(
        con,
        "SELECT a.id, a.material_id, a.status, a.score, a.max_score, a.started_at, a.finished_at, m.title, m.kind"
        f" FROM quiz_attempts a JOIN materials m ON m.id = a.material_id WHERE {where} ORDER BY a.started_at DESC LIMIT ?",
        (*params, limit),
    )
    for a in found:
        a["percent"] = _percent(a["score"], a["max_score"]) if a["status"] == "graded" else None
    return found


# -- weak topics ------------------------------------------------------------------------------------------
def topic_key(topic: str) -> str:
    return " ".join(str(topic or "general").casefold().split())


def topic_stats(con, user_id: str) -> list[dict]:
    """Every topic the student has been tested on, grouped case-insensitively, judged on recent results."""
    groups: dict[str, dict] = {}
    for r in rows(con, "SELECT source, subject, topic, correct, created_at FROM topic_results WHERE user_id = ?"
                       " ORDER BY created_at DESC, id DESC LIMIT 20000", (user_id,)):
        g = groups.setdefault(topic_key(r["topic"]), {"topic": r["topic"], "subject": "", "answered": 0, "recent": [],
                                                      "last_seen": r["created_at"], "sources": set()})
        g["answered"] += 1
        if len(g["recent"]) < RECENT_RESULTS:
            g["recent"].append(r["correct"])
        if not g["subject"] and r["subject"]:
            g["subject"] = r["subject"]
        g["sources"].add(r["source"])
    out = []
    for g in groups.values():
        out.append({"topic": g["topic"], "subject": g["subject"], "answered": g["answered"],
                    "accuracy": round(sum(g["recent"]) / len(g["recent"]), 2), "last_seen": g["last_seen"],
                    "sources": sorted(g["sources"])})
    return out


def weak_topics(con, user_id: str) -> dict:
    stats = [s for s in topic_stats(con, user_id) if s["answered"] >= 2]
    weak = sorted((s for s in stats if s["accuracy"] < WEAK_ACCURACY), key=lambda s: (s["accuracy"], -s["answered"]))
    strong = sorted((s for s in stats if s["accuracy"] >= WEAK_ACCURACY), key=lambda s: (-s["accuracy"], -s["answered"]))
    return {"weak": weak[:20], "strong": strong[:20]}


def practice_weak(state, user_id: str, topics: list[str], count: int) -> dict:
    """A quiz on weak topics, written from the parts of the student's documents that mention them.
    If no document mentions them, a general quiz on the topic names (its title says so)."""
    with state.db.read() as con:
        weak = weak_topics(con, user_id)["weak"]
        topics = [t.strip()[:80] for t in topics if t and t.strip()][:5] or [w["topic"] for w in weak[:3]]
        if not topics:
            raise ApiError(400, "NO_WEAK_TOPICS", "No weak topics yet. Take a quiz or review some flashcards first, then come back.")
        found = docs.retrieve_for_topics(con, user_id, topics)
        doc_rows = {d["id"]: d for d in rows(con, "SELECT id, subject FROM documents WHERE user_id = ?", (user_id,))}
    picked, size = [], 0
    for chunk in found:
        if size + len(chunk["text"]) > 2 * generate.PART_CHARS:
            break
        picked.append(chunk)
        size += len(chunk["text"])
    subject = next((w["subject"] for w in weak if topic_key(w["topic"]) in {topic_key(t) for t in topics} and w["subject"]), "")
    options = {"count": count, "difficulty": "mixed", "focus": ", ".join(topics)[:200],
               "question_types": list(mat.QUESTION_TYPES), "practice_topics": topics}
    title = "Practice: " + ", ".join(topics)
    if picked:
        options["chunk_ids"] = [c["id"] for c in picked]
        document_ids = list(dict.fromkeys(c["document_id"] for c in picked))
        subject = subject or next((doc_rows[d]["subject"] for d in document_ids if doc_rows.get(d, {}).get("subject")), "")
    else:
        options["general_topics"] = topics
        document_ids = []
        title += " (general questions, not from your notes)"
    with state.db.write() as con:
        material = mat.create(con, user_id, "quiz", title[:120], subject, document_ids, options)
    generate.start(state, material["id"], user_id)
    with state.db.read() as con:
        return mat.public(con, material)


# -- overview ---------------------------------------------------------------------------------------------
def overview(con, user_id: str) -> dict:
    now = now_iso()
    counts = one(
        con,
        "SELECT COUNT(*) AS documents, SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,"
        " SUM(CASE WHEN status IN ('queued','processing') THEN 1 ELSE 0 END) AS processing FROM documents WHERE user_id = ?",
        (user_id,),
    )
    by_kind = {k: 0 for k in mat.KIND_NAMES}
    for r in rows(con, "SELECT kind, COUNT(*) AS n FROM materials WHERE user_id = ? AND status = 'ready' GROUP BY kind", (user_id,)):
        by_kind[r["kind"]] = r["n"]
    cards = one(
        con,
        "SELECT COUNT(*) AS total, SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END) AS due,"
        " SUM(CASE WHEN box >= ? THEN 1 ELSE 0 END) AS mastered FROM flashcards WHERE user_id = ?",
        (now, leitner.MASTERED_BOX, user_id),
    )
    recent_docs = rows(con, "SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", (user_id,))
    recent_materials = rows(con, "SELECT * FROM materials WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", (user_id,))
    last = one(
        con,
        "SELECT a.id, a.material_id, a.score, a.max_score, a.finished_at, m.title FROM quiz_attempts a"
        " JOIN materials m ON m.id = a.material_id WHERE a.user_id = ? AND a.status = 'graded' ORDER BY a.finished_at DESC LIMIT 1",
        (user_id,),
    )
    return {
        "documents": counts["documents"] or 0,
        "ready_documents": counts["ready"] or 0,
        "processing_documents": counts["processing"] or 0,
        "materials": by_kind,
        "cards_total": cards["total"] or 0,
        "cards_due": cards["due"] or 0,
        "cards_mastered": cards["mastered"] or 0,
        "recent_documents": [docs.public(d) for d in recent_docs],
        "recent_materials": [mat.public(con, m) for m in recent_materials],
        "weak_topics": weak_topics(con, user_id)["weak"][:3],
        "last_attempt": {"id": last["id"], "material_id": last["material_id"], "title": last["title"],
                         "percent": _percent(last["score"], last["max_score"]), "finished_at": last["finished_at"]} if last else None,
    }
