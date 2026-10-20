"""Prompts for turning course material into revision material.

Written for small local Qwen models: short instructions, the exact output shape, and a
reminder that the material is data. Every request stays inside an 8192-token context: one
part of the material (at most about 3000 tokens), the instructions (under 700), a short
"don't repeat these" list (at most 20 × 60 characters) and the answer (at most about 2400).
"""

from __future__ import annotations

from ..llm.prompts import DATA_RULE, MATH_FORMAT, tagged

LEVEL = "The students are at secondary school or university in Hong Kong."

# -- photos of notes ------------------------------------------------------------------------------
NOTES_PHOTO_SYSTEM = (
    "You transcribe photos of study notes, textbook pages and whiteboards into text for revision. "
    "Copy the words exactly as written, in reading order, keeping headings, lists and tables "
    "(as Markdown). Do not summarise, explain or add anything. Write [unclear] for words you can't read. "
    + MATH_FORMAT
    + " If the photo has no readable writing, reply with exactly: NO TEXT"
)
NOTES_PHOTO_USER = "Transcribe the notes in this photo."

# -- outline ----------------------------------------------------------------------------------------
OUTLINE_SYSTEM = (
    "You write revision notes (a chapter outline) from course material for students. " + LEVEL + " "
    "Write Markdown only:\n"
    "- a ### heading for each topic in the material, in the order it appears\n"
    "- under each heading, 3 to 6 short bullet points with the key facts, definitions, formulas and examples\n"
    "- **bold** each key term the first time it appears\n"
    "- end each bullet with its source location in square brackets, copied from the material, e.g. [Slide 4] or [Page 12]\n"
    "Use only facts from the material. Keep it short enough to revise from. "
    + MATH_FORMAT + " " + DATA_RULE
)


def outline_messages(part_text: str, part_label: str, subject: str, focus: str) -> list[dict]:
    extra = f"Give extra detail on anything about: {focus}.\n" if focus else ""
    user = (
        f"Subject: {subject or 'not given'}\nThis is {part_label}.\n{extra}"
        f"Write the revision notes for this material.\n\n{tagged('material', part_text)}"
    )
    return [{"role": "system", "content": OUTLINE_SYSTEM}, {"role": "user", "content": user}]


PRIORITIES_SCHEMA = {
    "type": "object",
    "properties": {
        "priorities": {
            "type": "array",
            "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {"topic": {"type": "string", "maxLength": 100}, "why": {"type": "string", "maxLength": 200}},
            },
        }
    },
    "required": ["priorities"],
}

PRIORITIES_SYSTEM = (
    "You help a student plan revision. From the outline headings and key terms, pick the 3 to 5 topics "
    "to revise first: the ones with the most key ideas, formulas or definitions that other topics build on. "
    "For each give the topic name (copied from the headings) and one short reason. Answer in JSON. " + DATA_RULE
)


def priorities_messages(summary: str) -> list[dict]:
    return [
        {"role": "system", "content": PRIORITIES_SYSTEM},
        {"role": "user", "content": "Outline headings with their key terms:\n" + tagged("outline", summary, 3000)},
    ]


# -- flashcards ---------------------------------------------------------------------------------------
CARDS_SCHEMA = {
    "type": "object",
    "properties": {
        "cards": {
            "type": "array",
            "maxItems": 30,
            "items": {
                "type": "object",
                "properties": {
                    "front": {"type": "string", "maxLength": 300},
                    "back": {"type": "string", "maxLength": 800},
                    "topic": {"type": "string", "maxLength": 80},
                    "source": {"type": "string", "maxLength": 80},
                },
            },
        }
    },
    "required": ["cards"],
}

CARDS_SYSTEM = (
    "You write flashcards from course material so students can test their memory. " + LEVEL + " "
    "Each card has: front (one clear question or term to recall, not a yes/no question), back (the answer in "
    "one to three sentences), topic (two to four words naming the topic), and source (the location in square "
    "brackets in the material, e.g. Slide 4 or Page 12). Cover the most important facts, definitions and formulas. "
    "Use only facts from the material. Answer in JSON. " + MATH_FORMAT + " " + DATA_RULE
)


def cards_messages(part_text: str, count: int, subject: str, focus: str, avoid: list[str]) -> list[dict]:
    extra = f"Concentrate on: {focus}.\n" if focus else ""
    if avoid:
        extra += "Do not repeat these cards that already exist:\n" + "\n".join(f"- {f[:60]}" for f in avoid[:20]) + "\n"
    user = (
        f"Subject: {subject or 'not given'}\n{extra}Write exactly {count} flashcards from this material.\n\n"
        f"{tagged('material', part_text)}"
    )
    return [{"role": "system", "content": CARDS_SYSTEM}, {"role": "user", "content": user}]


# -- quizzes and mock exams ---------------------------------------------------------------------------------
QUIZ_SCHEMA = {
    "type": "object",
    "properties": {
        "quiz": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "maxLength": 20},  # mapped leniently in generate.py
                    "question": {"type": "string", "maxLength": 1000},
                    "choices": {"type": "array", "maxItems": 6, "items": {"type": "string", "maxLength": 300}},
                    "answer_index": {"type": ["integer", "null"]},  # checked in generate.py (models sometimes send "B")
                    "answer": {"type": "string", "maxLength": 800},
                    "marking_points": {"type": "array", "maxItems": 5, "items": {"type": "string", "maxLength": 300}},
                    "explanation": {"type": "string", "maxLength": 800},
                    "topic": {"type": "string", "maxLength": 80},
                    "source": {"type": "string", "maxLength": 80},
                },
            },
        }
    },
    "required": ["quiz"],
}

TYPE_RULES = {
    "choice": 'type "choice": a question with exactly 4 choices, only one of them correct; answer_index is the '
              "position of the correct choice counting from 0; answer is the correct choice's text",
    "truefalse": 'type "truefalse": a statement that is clearly true or clearly false; answer is "true" or "false"',
    "short": 'type "short": a question answered in a word, a number or one or two sentences; answer is a model '
             "answer; marking_points lists the 1 to 3 points a correct answer must contain",
}

DIFFICULTY = {
    "easy": "Make the questions straightforward recall of the main facts.",
    "mixed": "Mix the difficulty: some recall of facts, some applying ideas to a new example, and a few harder questions.",
    "hard": "Make the questions demanding: applying ideas, multi-step reasoning and common misconceptions.",
}


def quiz_system(types: list[str], exam: bool) -> str:
    rules = "\n".join(f"- {TYPE_RULES[t]}" for t in types)
    purpose = "a mock exam" if exam else "a practice quiz"
    return (
        f"You write questions for {purpose} from course material. " + LEVEL + "\n"
        f"Question types to use:\n{rules}\n"
        "Every question also has: explanation (why the answer is right, one or two sentences), topic (two to four "
        "words naming the topic) and source (the location in square brackets in the material, e.g. Slide 4). "
        "Questions must be answerable from the material alone and must not give away their answers. "
        "Answer in JSON. " + MATH_FORMAT + " " + DATA_RULE
    )


def quiz_messages(part_text: str, count: int, types: list[str], difficulty: str, subject: str, focus: str,
                  exam: bool, avoid: list[str]) -> list[dict]:
    extra = f"Concentrate on: {focus}.\n" if focus else ""
    if avoid:
        extra += "Do not repeat these questions that already exist:\n" + "\n".join(f"- {q[:60]}" for q in avoid[:20]) + "\n"
    mix = f"Use a mix of the types {', '.join(types)}." if len(types) > 1 else f"Every question is type {types[0]}."
    user = (
        f"Subject: {subject or 'not given'}\n{extra}{DIFFICULTY.get(difficulty, DIFFICULTY['mixed'])} {mix}\n"
        f"Write exactly {count} questions from this material.\n\n{tagged('material', part_text)}"
    )
    return [{"role": "system", "content": quiz_system(types, exam)}, {"role": "user", "content": user}]


def topics_quiz_messages(topics: list[str], count: int, types: list[str], subject: str) -> list[dict]:
    """A quiz on topic names alone, when none of the student's documents mention them."""
    user = (
        f"Subject: {subject or 'not given'}\n{DIFFICULTY['mixed']} Use a mix of the types {', '.join(types)}.\n"
        f"There is no course material for these topics, so use standard knowledge at the students' level. "
        f"Write exactly {count} questions on these topics:\n{tagged('topics', chr(10).join(topics))}"
    )
    system = quiz_system(types, exam=False).replace(
        "Questions must be answerable from the material alone", "Questions must be answerable from standard textbook knowledge"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# -- marking short answers --------------------------------------------------------------------------------
MARKS_SCHEMA = {
    "type": "object",
    "properties": {
        "marks": {
            "type": "array",
            "maxItems": 60,
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "score": {"type": "number"},  # clamped to 0..1 when used
                    "feedback": {"type": "string", "maxLength": 400},
                },
                "required": ["index", "score"],
            },
        }
    },
    "required": ["marks"],
}

MARKS_SYSTEM = (
    "You mark students' short answers in a revision quiz, fairly and kindly. For each item compare the student "
    "answer with the model answer and marking points. Give score 1 if it is correct (wording, spelling and "
    "language may differ, including answers in Chinese), 0.5 if it is partly correct, 0 if it is wrong or blank. "
    "Feedback: one short sentence telling the student what was right or what was missing. "
    "Answer in JSON with one entry per item, using the item's index. " + DATA_RULE
)


def marks_messages(items: list[dict]) -> list[dict]:
    blocks = []
    for item in items:
        points = "; ".join(item.get("marking_points") or [])
        body = "\n".join([
            tagged("question", item["question"], 600),
            tagged("model_answer", item["answer"], 600),
            tagged("marking_points", points, 400) if points else "",
            tagged("student_answer", item["student_answer"], 1200),
        ]).replace("</item", "< /item")
        blocks.append(f'<item index="{item["index"]}">\n{body}\n</item>')
    user = "Mark these answers.\n\n" + "\n\n".join(blocks)
    return [{"role": "system", "content": MARKS_SYSTEM}, {"role": "user", "content": user}]
