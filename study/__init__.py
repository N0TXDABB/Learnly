"""Studying for exams: upload course documents, turn them into outlines, flashcards,
quizzes and mock exams, review with spaced repetition, and find weak topics."""

from __future__ import annotations

import logging

from ..db import now_iso

log = logging.getLogger("learnly.study")

INTERRUPTED = "Learnly was closed while this was running. Try again."


class Deleted(Exception):
    """Raised inside background work when the document or material it is for has been deleted.
    The work stops at its next step instead of keeping the AI, and the one-at-a-time job queue
    behind it, busy for something nobody will read."""


def on_startup(state) -> None:
    """Called once when Learnly starts (before requests). Background work can't survive a restart,
    so anything left half-done is marked failed (the student presses Try again), and quiz attempts
    caught mid-marking go back to "in progress" so they can be handed in again."""
    now = now_iso()
    with state.db.write() as con:
        documents = con.execute(
            "UPDATE documents SET status = 'failed', error = ?, progress = '', updated_at = ? WHERE status IN ('queued','processing')",
            (INTERRUPTED, now),
        ).rowcount
        materials = con.execute(
            "UPDATE materials SET status = 'failed', error = ?, progress = '', updated_at = ? WHERE status IN ('queued','generating')",
            (INTERRUPTED, now),
        ).rowcount
        attempts = con.execute("UPDATE quiz_attempts SET status = 'in_progress' WHERE status = 'grading'").rowcount
    if documents or materials or attempts:
        log.info("recovered %s document(s), %s material(s), %s attempt(s) interrupted by a restart", documents, materials, attempts)
