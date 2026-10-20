"""Writing revision material with the local model, one part of the documents at a time.

A small model with an 8192-token context can't read a whole chapter at once, so the chunks
are grouped into parts (at most about 9000 characters, fewer for Chinese text) and the
model works through them one by one while the page shows "Writing flashcards from part 2 of 5".
Small models make mistakes, so everything they return is checked: broken questions are
dropped and topped up, duplicate cards are removed, and one failed part doesn't sink the rest.
"""

from __future__ import annotations

import logging
import math
import re
import unicodedata
from dataclasses import dataclass

from ..db import dumps, loads, new_id, now_iso, one, rows
from ..llm import LLMError, LLMUnavailable
from ..llm.structured import chat_json
from ..notify import notify
from . import Deleted
from . import materials as mat
from . import prompts
from .chunking import estimate_tokens

log = logging.getLogger("learnly.study")

PART_CHARS = 9000
PART_TOKENS = 3000  # leaves room in an 8192-token context for the instructions and the answer
NUM_CTX = 8192
MAX_OUTLINE_PARTS = 30
CARDS_PER_PART, CARDS_PER_CALL = 5, 12
QUESTIONS_PER_PART, QUESTIONS_PER_CALL = 4, 8
TOP_UP_ROUNDS = 2


class GenerationError(Exception):
    """The material couldn't be made. The message is shown to the student as it is."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass
class Part:
    label: str
    text: str
    chars: int


# -- parts -----------------------------------------------------------------------------------------
def range_label(first: str, last: str) -> str:
    """"Slides 3–7", "Pages 2–4", "12:30–20:10", or just the first location."""
    if first == last:
        return first
    a = re.fullmatch(r"(Page|Slide|Part) (\d+)", first)
    b = re.fullmatch(r"(Page|Slide|Part) (\d+)", last)
    if a and b and a.group(1) == b.group(1):
        return f"{a.group(1)}s {a.group(2)}–{b.group(2)}"
    if re.fullmatch(r"[\d:]+", first) and re.fullmatch(r"[\d:]+", last):
        return f"{first}–{last}"
    return f"{first} to {last}"


def build_parts(chunks: list[dict], max_chars: int = PART_CHARS, max_tokens: int = PART_TOKENS) -> list[Part]:
    """Group chunks (in reading order, each with title and location) into parts the model can read in one go.
    Each chunk is prefixed with its location in brackets so the model can cite it."""
    parts: list[Part] = []
    pieces: list[str] = []
    meta: dict = {}

    def flush():
        if pieces:
            label = f"{meta['title']} · {range_label(meta['first'], meta['last'])}"
            text = "\n\n".join(pieces)
            parts.append(Part(label, text, len(text)))

    for chunk in chunks:
        piece = f"[{chunk['location']}] {chunk['text']}"
        same_doc = meta.get("doc") == chunk["document_id"]
        current = "\n\n".join(pieces)
        if pieces and (not same_doc or len(current) + len(piece) > max_chars or estimate_tokens(current + piece) > max_tokens):
            flush()
            pieces, meta = [], {}
        if not pieces:
            meta = {"doc": chunk["document_id"], "title": chunk["title"], "first": chunk["location"]}
        pieces.append(piece)
        meta["last"] = chunk["location"]
    flush()
    return parts


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2}


def pick_parts(parts: list[Part], limit: int, focus: str = "") -> list[Part]:
    """At most `limit` parts, kept in reading order: the ones that mention the focus topic most,
    or else spread evenly through the material."""
    if len(parts) <= limit:
        return parts
    if focus and _words(focus):
        words = _words(focus)
        scored = sorted(range(len(parts)), key=lambda i: -sum(parts[i].text.lower().count(w) for w in words))
        if sum(parts[scored[0]].text.lower().count(w) for w in words):
            return [parts[i] for i in sorted(scored[:limit])]
    step = len(parts) / limit
    return [parts[int(i * step)] for i in range(limit)]


def split_count(total: int, buckets: int) -> list[int]:
    """Share `total` items between buckets as evenly as possible: 10 over 4 -> [3, 3, 2, 2]."""
    base, extra = divmod(total, buckets)
    return [base + (1 if i < extra else 0) for i in range(buckets)]


def plan_requests(parts: list[Part], count: int, per_part: int, per_call: int, focus: str = "") -> list[tuple[Part, int]]:
    """Which parts to ask, and for how many items each, to make `count` items in total."""
    chosen = pick_parts(parts, max(1, math.ceil(count / per_part)), focus)
    plan = []
    for part, share in zip(chosen, split_count(count, len(chosen))):
        while share > 0:
            n = min(per_call, share)
            plan.append((part, n))
            share -= n
    return plan


# -- checking what the model returned -----------------------------------------------------------------
def normalise(text: str) -> str:
    """Lower case, no punctuation or extra spaces: for spotting duplicates and matching answers."""
    text = unicodedata.normalize("NFKC", str(text or "")).lower()
    return " ".join(re.findall(r"\w+", text))


def clean_cards(raw: list, fallback_source: str) -> list[dict]:
    cards = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        front, back = str(item.get("front") or "").strip(), str(item.get("back") or "").strip()
        if len(front) < 2 or not back or normalise(front) == normalise(back):
            continue
        source = str(item.get("source") or "").strip().strip("[]") or fallback_source
        cards.append({"front": front[:300], "back": back[:800], "topic": str(item.get("topic") or "").strip()[:80],
                      "source": source[:80]})
    return cards


_LETTER_PREFIX = re.compile(r"^\s*(?:\(([A-Fa-f])\)|([A-Fa-f])[.):])\s+")
TYPE_ALIASES = {
    "choice": "choice", "mcq": "choice", "mc": "choice", "multiple choice": "choice", "multiple_choice": "choice",
    "multiplechoice": "choice", "multiple-choice": "choice",
    "truefalse": "truefalse", "true/false": "truefalse", "true_false": "truefalse", "true or false": "truefalse",
    "true-false": "truefalse", "tf": "truefalse", "boolean": "truefalse",
    "short": "short", "short answer": "short", "short_answer": "short", "short-answer": "short", "open": "short",
}
_TRUE = {"true", "t", "yes", "correct", "right", "正確", "對", "真", "是"}
_FALSE = {"false", "f", "no", "incorrect", "wrong", "錯誤", "錯", "假", "否"}


def _truth(value) -> bool | None:
    if isinstance(value, bool):
        return value
    text = normalise(value)
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    return None


def as_index(value) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else None
    text = str(value).strip().strip("().").upper()
    if text.isdigit():
        return int(text)
    if len(text) == 1 and "A" <= text <= "F":
        return ord(text) - ord("A")
    return None


def choice_index(raw_index, answer: str, choices: list[str]) -> int | None:
    """The correct choice, cross-checking answer_index against the answer text. Small models sometimes
    count from 1; if the index and the text disagree in any other way the question is unusable."""
    index = as_index(raw_index)
    target = normalise(answer)
    matches = [i for i, c in enumerate(choices) if target and normalise(c) == target]
    if not matches and len(answer.strip()) == 1:
        letter = as_index(answer)
        matches = [letter] if letter is not None and letter < len(choices) else []
    by_text = matches[0] if len(matches) == 1 else None
    if index is not None and 0 <= index < len(choices):
        if by_text is None or by_text == index:
            return index
        if by_text == index - 1:
            return by_text
        return None
    if index == len(choices) and by_text in (None, len(choices) - 1):
        return len(choices) - 1
    return by_text


def clean_question(raw, allowed: list[str], fallback_source: str = "") -> dict | None:
    """A checked question, or None if it's broken: exactly 4 different choices with one correct answer,
    a clear true/false, or a short question with a model answer."""
    if not isinstance(raw, dict):
        return None
    question = str(raw.get("question") or "").strip()
    if len(question) < 5:
        return None
    choices = []
    for c in raw.get("choices") or []:
        text = _LETTER_PREFIX.sub("", str(c or "")).strip()
        if text:
            choices.append(text[:300])
    answer = str(raw.get("answer") or "").strip()
    kind = TYPE_ALIASES.get(re.sub(r"\s+", " ", str(raw.get("type") or "").strip().lower()))
    if kind is None:
        kind = "choice" if len(choices) >= 3 else "truefalse" if _truth(answer) is not None else "short"
    if kind not in allowed:
        return None
    out = {
        "type": kind, "question": question[:1000],
        "explanation": str(raw.get("explanation") or "").strip()[:800],
        "topic": str(raw.get("topic") or "").strip()[:80] or "General",
        "source": (str(raw.get("source") or "").strip().strip("[]") or fallback_source)[:80],
    }
    if kind == "choice":
        if len(choices) != 4 or len({normalise(c) for c in choices}) != 4:
            return None
        index = choice_index(raw.get("answer_index"), answer, choices)
        if index is None:
            return None
        out.update(choices=choices, answer_index=index, answer=choices[index])
    elif kind == "truefalse":
        value = _truth(answer)
        if value is None and as_index(raw.get("answer_index")) in (0, 1) and [normalise(c) for c in choices] == ["true", "false"]:
            value = as_index(raw.get("answer_index")) == 0
        if value is None:
            return None
        out.update(choices=["True", "False"], answer_index=0 if value else 1, answer="True" if value else "False")
    else:
        if not answer:
            return None
        points = [str(p).strip()[:300] for p in (raw.get("marking_points") or []) if str(p or "").strip()][:3]
        out.update(answer=answer[:800], marking_points=points)
    return out


# -- the job ----------------------------------------------------------------------------------------
def start(state, material_id: str, user_id: str) -> None:
    job_id = state.jobs.create(user_id, "study.material", {"material_id": material_id})
    state.jobs.start(job_id, lambda progress: run(state, material_id, progress))


async def run(state, material_id: str, progress) -> dict:
    """Make the material. Never raises: the outcome is stored on the material and the student is notified.
    Every request to the AI comes after a progress report, and a report on a material that has been
    deleted stops the work there."""
    with state.db.read() as con:
        material = one(con, "SELECT * FROM materials WHERE id = ?", (material_id,))
    if material is None:
        return {"status": "deleted"}

    def report(text: str) -> None:
        progress(text)
        if not mat.set_fields(state, material_id, progress=text[:200]):
            raise Deleted(material_id)

    options = loads(material["options_json"], {}) or {}
    try:
        if not mat.set_fields(state, material_id, status="generating", error=None, progress="Reading your documents"):
            raise Deleted(material_id)
        parts = _parts_for(state, material, options)
        kind = material["kind"]
        if kind == "outline":
            content, model = await make_outline(state, material, options, parts, report)
            cards = None
        elif kind == "flashcards":
            cards, model = await make_cards(state, material, options, parts, report)
            content = {}
        else:
            content, model = await make_questions(state, material, options, parts, report)
            cards = None
    except Deleted:
        log.info("material %s was deleted while it was being made", material_id)
        return {"status": "deleted"}
    except GenerationError as exc:
        return _failed(state, material, exc.message)
    except LLMUnavailable as exc:
        return _failed(state, material, f"The local AI isn't available: {exc}")
    except LLMError as exc:
        return _failed(state, material, str(exc))
    except Exception:
        log.exception("making material %s failed", material_id)
        return _failed(state, material, "Something went wrong while making this. Try again.")
    with state.db.write() as con:
        if one(con, "SELECT 1 AS x FROM materials WHERE id = ?", (material_id,)) is None:
            return {"status": "deleted"}
        if cards is not None:
            _save_cards(con, material, cards)
        con.execute(
            "UPDATE materials SET status = 'ready', progress = '', error = NULL, content_json = ?, model = ?, updated_at = ? WHERE id = ?",
            (dumps(content), model, now_iso(), material_id),
        )
        notify(con, material["user_id"], "study", f"{material['title']} is ready",
               {"outline": "Your chapter outline is written.", "flashcards": f"{len(cards or [])} flashcards to study.",
                "quiz": "Your quiz is ready to take.", "exam": "Your mock exam is ready."}[material["kind"]],
               f"#/study/material/{material_id}")
    return {"status": "ready"}


def _failed(state, material: dict, message: str) -> dict:
    mat.set_fields(state, material["id"], status="failed", error=message[:500], progress="")
    with state.db.write() as con:
        if one(con, "SELECT 1 AS x FROM materials WHERE id = ?", (material["id"],)):
            notify(con, material["user_id"], "study", f"{material['title']} couldn't be made", message[:300],
                   f"#/study/material/{material['id']}")
    return {"status": "failed"}


def _parts_for(state, material: dict, options: dict) -> list[Part]:
    """The material to work from: chosen chunks (practising weak topics) or whole documents."""
    if options.get("general_topics"):
        return []
    with state.db.read() as con:
        if options.get("chunk_ids"):
            ids = [int(i) for i in options["chunk_ids"]][:200]
            marks = ",".join("?" * len(ids))
            chunks = rows(
                con,
                "SELECT c.document_id, c.location, c.text, d.title FROM doc_chunks c JOIN documents d ON d.id = c.document_id"
                f" WHERE c.id IN ({marks}) AND d.user_id = ? ORDER BY d.created_at, c.idx",
                (*ids, material["user_id"]),
            )
        else:
            chunks = []
            for doc_id in loads(material["document_ids_json"], []):
                chunks += rows(
                    con,
                    "SELECT c.document_id, c.location, c.text, d.title FROM doc_chunks c JOIN documents d ON d.id = c.document_id"
                    " WHERE c.document_id = ? AND d.user_id = ? ORDER BY c.idx",
                    (doc_id, material["user_id"]),
                )
    if not chunks:
        raise GenerationError("The documents for this have been deleted or have no text left. Choose other documents.")
    return build_parts(chunks)


# -- outline ------------------------------------------------------------------------------------------
def tidy_section(markdown: str) -> str:
    """Make one part's notes fit under its own ## heading: strip code fences and chatty openers,
    and turn the model's top-level headings into ### headings."""
    text = re.sub(r"^```(?:markdown|md)?\s*\n?|\n?```\s*$", "", (markdown or "").strip())
    lines = text.split("\n")
    if lines and lines[0].rstrip().endswith(":") and not lines[0].lstrip().startswith(("#", "-", "*")) and len(lines[0]) < 100:
        lines = lines[1:]
    out = []
    for line in lines:
        match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if match:
            level = max(3, len(match.group(1)))
            line = "#" * min(level, 4) + " " + match.group(2).strip()
        out.append(line)
    return "\n".join(out).strip()


def outline_summary(sections: list[str]) -> list[tuple[str, list[str]]]:
    """(heading, key terms) for every ### heading in the written outline."""
    found: list[tuple[str, list[str]]] = []
    for section in sections:
        for line in section.split("\n"):
            heading = re.match(r"^###\s+(.*)$", line)
            if heading:
                found.append((heading.group(1).strip(), []))
            elif found:
                found[-1][1].extend(t.strip() for t in re.findall(r"\*\*([^*]{2,60})\*\*", line))
    return found


def fallback_priorities(summary: list[tuple[str, list[str]]]) -> list[dict]:
    """Without the AI: the topics with the most key terms to learn."""
    ranked = sorted(summary, key=lambda s: -len(s[1]))[:4]
    return [{"topic": heading, "why": f"{len(terms)} key terms to learn" if terms else "A main topic of this material"}
            for heading, terms in ranked]


async def make_outline(state, material: dict, options: dict, parts: list[Part], report) -> tuple[dict, str]:
    total = len(parts)
    chosen = pick_parts(parts, MAX_OUTLINE_PARTS, options.get("focus", ""))
    sections, failures, model = [], 0, ""
    for i, part in enumerate(chosen, 1):
        report(f"Writing the outline: part {i} of {len(chosen)}")
        try:
            result = await state.ai.chat(
                prompts.outline_messages(part.text, part.label, material["subject"], options.get("focus", "")),
                temperature=0.7, top_p=0.8, max_tokens=1500, num_ctx=NUM_CTX,
            )
            body, model = tidy_section(result.content), result.model or model
        except LLMUnavailable:
            raise
        except LLMError as exc:
            log.warning("outline part %s failed: %s", i, exc)
            body = ""
        if not body:
            failures += 1
            body = "_This part couldn't be summarised. Open the document to read it._"
        sections.append(f"## {part.label}\n\n{body}")
    if failures == len(chosen):
        raise GenerationError("The AI couldn't write this outline. Try again, or try a larger model in AI setup.")
    report("Choosing what to revise first")
    summary = outline_summary(sections)
    priorities = await _priorities(state, summary) if summary else []
    lines = [f"# {material['title']}", ""]
    if priorities:
        lines += ["## What to revise first", ""]
        lines += [f"{n}. **{p['topic']}**" + (f" — {p['why']}" if p.get("why") else "") for n, p in enumerate(priorities, 1)]
        lines.append("")
    lines.append("\n\n".join(sections))
    if len(chosen) < total:
        lines += ["", f"_This outline covers {len(chosen)} of the {total} parts of your material. "
                      "For full detail, make an outline for each chapter separately._"]
    return {"markdown": "\n".join(lines).strip() + "\n", "parts": len(chosen)}, model


async def _priorities(state, summary: list[tuple[str, list[str]]]) -> list[dict]:
    text = "\n".join(f"- {heading}: {', '.join(terms[:8])}" for heading, terms in summary)
    try:
        data, _model = await chat_json(state.ai, prompts.priorities_messages(text), prompts.PRIORITIES_SCHEMA,
                                       max_tokens=500, num_ctx=NUM_CTX)
    except LLMUnavailable:
        raise
    except LLMError:
        return fallback_priorities(summary)
    items = [{"topic": str(p.get("topic") or "").strip(), "why": str(p.get("why") or "").strip()}
             for p in data.get("priorities", []) if isinstance(p, dict)]
    items = [p for p in items if p["topic"]][:5]
    return items or fallback_priorities(summary)


# -- flashcards and questions ------------------------------------------------------------------------
class Collector:
    """Gathers items from several requests, dropping duplicates (by normalised text) as they arrive."""

    def __init__(self, key: str):
        self.key = key
        self.items: list[dict] = []
        self.seen: set[str] = set()
        self.model = ""

    def add(self, items: list[dict], limit: int) -> None:
        for item in items[:limit]:
            norm = normalise(item[self.key])
            if norm and norm not in self.seen:
                self.seen.add(norm)
                self.items.append(item)

    def avoid(self) -> list[str]:
        return [item[self.key] for item in self.items[-25:]]


async def _collect(plan, parts, count, collector: Collector, ask, report, noun: str) -> None:
    """Run the plan, then top up from the largest parts if broken or duplicate items left us short."""
    for i, (part, n) in enumerate(plan, 1):
        report(f"Writing {noun} from part {i} of {len(plan)}")
        await ask(part, n)
    by_size = sorted(parts, key=lambda p: -p.chars) or [None]
    for round_ in range(TOP_UP_ROUNDS):
        missing = count - len(collector.items)
        if missing <= 0:
            return
        report(f"Writing {missing} more {noun}")
        before = len(collector.items)
        await ask(by_size[round_ % len(by_size)], missing + 1)
        if len(collector.items) == before:
            return


def _location(part: Part | None) -> str:
    return part.label.split(" · ")[-1] if part else ""


async def make_cards(state, material: dict, options: dict, parts: list[Part], report) -> tuple[list[dict], str]:
    count, focus = options.get("count", 20), options.get("focus", "")
    collector = Collector("front")

    async def ask(part: Part, n: int) -> None:
        n = min(CARDS_PER_CALL, n)
        messages = prompts.cards_messages(part.text, n, material["subject"], focus, collector.avoid())
        try:
            data, collector.model = await chat_json(state.ai, messages, prompts.CARDS_SCHEMA,
                                                    max_tokens=160 * n + 300, num_ctx=NUM_CTX)
        except LLMUnavailable:
            raise
        except LLMError as exc:
            log.warning("flashcards from %s failed: %s", part.label, exc)
            return
        collector.add(clean_cards(data.get("cards"), _location(part)), n + 2)

    plan = plan_requests(parts, count, CARDS_PER_PART, CARDS_PER_CALL, focus)
    await _collect(plan, parts, count, collector, ask, report, "flashcards")
    if not collector.items:
        raise GenerationError("The AI didn't write any usable flashcards. Try again, or try a larger model in AI setup.")
    return collector.items[:count], collector.model


def _save_cards(con, material: dict, cards: list[dict]) -> None:
    """New cards start in box 0 and are due straight away."""
    con.execute("DELETE FROM flashcards WHERE material_id = ?", (material["id"],))
    now = now_iso()
    for idx, card in enumerate(cards):
        con.execute(
            "INSERT INTO flashcards(id, material_id, user_id, idx, front, back, topic, source, box, due_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (new_id("card"), material["id"], material["user_id"], idx, card["front"], card["back"],
             card["topic"] or material["subject"] or "General", card["source"], 0, now),
        )


async def make_questions(state, material: dict, options: dict, parts: list[Part], report) -> tuple[dict, str]:
    """A quiz or mock exam. Short answers are worth 2 points in an exam; everything else 1."""
    exam = material["kind"] == "exam"
    count = options.get("count", 20 if exam else 10)
    types = options.get("question_types") or list(mat.QUESTION_TYPES)
    difficulty, focus = options.get("difficulty", "mixed"), options.get("focus", "")
    topics = options.get("general_topics") or []
    collector = Collector("question")

    async def ask(part: Part | None, n: int) -> None:
        n = min(QUESTIONS_PER_CALL, n)
        if part is None:
            messages = prompts.topics_quiz_messages(topics, n, types, material["subject"])
        else:
            messages = prompts.quiz_messages(part.text, n, types, difficulty, material["subject"], focus, exam, collector.avoid())
        try:
            data, collector.model = await chat_json(state.ai, messages, prompts.QUIZ_SCHEMA,
                                                    max_tokens=260 * n + 300, num_ctx=NUM_CTX)
        except LLMUnavailable:
            raise
        except LLMError as exc:
            log.warning("questions from %s failed: %s", part.label if part else "topics", exc)
            return
        checked = [clean_question(q, types, _location(part)) for q in data.get("quiz") or []]
        collector.add([q for q in checked if q], n + 1)

    if topics:
        plan = [(None, n) for n in split_count(count, math.ceil(count / QUESTIONS_PER_CALL))]
    else:
        plan = plan_requests(parts, count, QUESTIONS_PER_PART, QUESTIONS_PER_CALL, focus)
    await _collect(plan, parts, count, collector, ask, report, "questions")
    if not collector.items:
        raise GenerationError("The AI didn't write any usable questions. Try again, or try a larger model in AI setup.")
    questions = []
    for index, q in enumerate(collector.items[:count]):
        q["index"] = index
        q["points"] = 2 if exam and q["type"] == "short" else 1
        questions.append(q)
    content = {"questions": questions, "time_limit_min": options.get("time_limit_min")}
    return content, collector.model
