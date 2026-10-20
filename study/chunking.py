"""Cutting extracted sections into chunks for search and for the AI.

A chunk is about 1800 characters: big enough to hold a complete idea, small enough that a
search hit points to the right place and that several chunks fit in one request to a small
local model. Cuts fall on paragraph, then sentence, boundaries; each chunk keeps the
location of the section it came from, so flashcards and questions can cite "Slide 4".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .extract import Section

TARGET = 1800

_PARAGRAPHS = re.compile(r"\n\s*\n")
# A sentence ends with . ! ? (then a space) or with Chinese full-width punctuation (often no space).
_SENTENCES = re.compile(r"(?<=[.!?])\s+|(?<=[。！？；])")


@dataclass
class Chunk:
    location: str
    text: str


def _hard_split(text: str, target: int) -> list[str]:
    """Last resort for a 'sentence' longer than a chunk: cut at a space near the limit."""
    pieces = []
    while len(text) > target:
        cut = text.rfind(" ", target // 2, target)
        cut = cut if cut > 0 else target
        pieces.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        pieces.append(text)
    return pieces


def _pack(units: list[str], target: int, joiner: str) -> list[str]:
    """Greedily join units (paragraphs or sentences) into pieces of at most `target` characters."""
    pieces: list[str] = []
    current = ""
    for unit in units:
        unit = unit.strip()
        if not unit:
            continue
        if len(unit) > target:
            if current:
                pieces.append(current)
                current = ""
            if joiner == "\n\n":
                pieces.extend(_pack(_SENTENCES.split(unit), target, " "))
            else:
                pieces.extend(_hard_split(unit, target))
            continue
        candidate = f"{current}{joiner}{unit}" if current else unit
        if len(candidate) > target:
            pieces.append(current)
            current = unit
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


def split_text(text: str, target: int = TARGET) -> list[str]:
    """Split one section's text into pieces of at most `target` characters on natural boundaries."""
    return _pack(_PARAGRAPHS.split(text or ""), target, "\n\n")


def chunk_sections(sections: list[Section], target: int = TARGET, merge: bool = False) -> list[Chunk]:
    """Chunks in reading order. With merge=True (transcripts), consecutive short sections are joined
    up to `target` characters and the chunk takes the first section's location ("12:30")."""
    chunks: list[Chunk] = []
    for section in sections:
        for piece in split_text(section.text, target):
            if merge and chunks and len(chunks[-1].text) + len(piece) + 1 <= target:
                chunks[-1].text += " " + piece
            else:
                chunks.append(Chunk(section.location, piece))
    return chunks


def estimate_tokens(text: str) -> int:
    """Rough token count for the model's context window. English is about 4 characters a token;
    Chinese and other non-Latin scripts are about one character a token."""
    ascii_chars = sum(1 for ch in text if ord(ch) < 128)
    return ascii_chars // 4 + (len(text) - ascii_chars)
