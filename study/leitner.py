"""Spaced repetition with Leitner boxes.

Every card sits in a box from 0 to 6. Remembering it moves it up a box, so it comes back
later; forgetting it sends it back to box 0, so it comes back soon. Simple enough for a
student to understand from the labels on the buttons ("Good · 3 days").

Only a review when the card is due can move it up. Extra practice before then (cramming a
deck the night before) still counts towards weak topics, but a card remembered early keeps
its box and its date, so three practice runs in one evening can't make it "mastered".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

INTERVALS = [
    timedelta(minutes=10),
    timedelta(days=1),
    timedelta(days=3),
    timedelta(days=7),
    timedelta(days=14),
    timedelta(days=30),
    timedelta(days=60),
]
TOP_BOX = len(INTERVALS) - 1
MASTERED_BOX = 4  # two weeks or more between reviews
# A card due within this long counts as due, so one forgotten earlier in a session (due again in
# ten minutes) is relearned properly when it comes round again before the session ends.
DUE_SOON = INTERVALS[0] + timedelta(minutes=1)
GRADES = ("again", "hard", "good", "easy")
# how well the card was remembered, for weak-topic tracking
GRADE_SCORE = {"again": 0.0, "hard": 0.5, "good": 1.0, "easy": 1.0}


def next_box(box: int, grade: str) -> int:
    if grade == "again":
        return 0
    if grade == "hard":
        return box
    return min(TOP_BOX, box + (1 if grade == "good" else 2))


def is_early(due_in: timedelta) -> bool:
    """True when a card isn't due yet (it is being practised ahead of time)."""
    return due_in > DUE_SOON


def schedule(box: int, due_at: datetime, grade: str, now: datetime | None = None) -> tuple[int, datetime]:
    """The card's new box and due time after a review. Early on, only forgetting counts."""
    now = now or datetime.now(timezone.utc)
    if is_early(due_at - now) and grade != "again":
        return box, due_at
    box = next_box(box, grade)
    return box, now + INTERVALS[box]


def label(delta: timedelta) -> str:
    """"10 min", "3 h", "1 day", "14 days", rounded to the nearest unit."""
    minutes = max(1, round(delta.total_seconds() / 60))
    if minutes < 60:
        return f"{minutes} min"
    hours = round(minutes / 60)
    if hours < 24:
        return f"{hours} h"
    days = round(minutes / 1440)
    return "1 day" if days == 1 else f"{days} days"


def interval_labels(box: int, due_in: timedelta | None = None) -> dict:
    """When the card comes back after each answer, e.g. {"again": "10 min", "good": "3 days", …}.
    For a card that isn't due yet (`due_in` ahead), only "again" changes anything."""
    if due_in is not None and is_early(due_in):
        unchanged = label(due_in)
        return {"again": label(INTERVALS[0]), "hard": unchanged, "good": unchanged, "easy": unchanged}
    return {grade: label(INTERVALS[next_box(box, grade)]) for grade in GRADES}
