"""Receiving uploaded course files safely.

The file arrives as the raw request body and is streamed straight to disk under a generated
name, counting bytes as they come so an oversized file is refused without filling the disk.
The original filename is only used for its extension and as a default title; the first bytes
must match the type the extension claims.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from ..errors import ApiError
from ..images import sniff_image
from .extract import looks_like_text

MB = 1024 * 1024

# extension -> document kind
KINDS = {
    ".pdf": "pdf",
    ".pptx": "slides",
    ".docx": "doc",
    ".txt": "text", ".md": "text", ".markdown": "text", ".vtt": "text", ".srt": "text",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image",
    ".mp3": "audio", ".m4a": "audio", ".wav": "audio", ".ogg": "audio", ".oga": "audio", ".webm": "audio",
    ".mp4": "audio", ".mov": "audio", ".aac": "audio", ".flac": "audio",
}

OLD_OFFICE = {
    ".ppt": "Old PowerPoint files (.ppt) can't be read. In PowerPoint choose File → Save As → .pptx (or PDF), then upload that.",
    ".doc": "Old Word files (.doc) can't be read. In Word choose File → Save As → .docx (or PDF), then upload that.",
    ".pps": "Old PowerPoint files can't be read. Save it as .pptx or PDF first.",
    ".ppsx": "Slide shows (.ppsx) can't be read. Save it as .pptx or PDF first.",
    ".key": "Keynote files can't be read. In Keynote choose File → Export To → PDF, then upload that.",
    ".pages": "Pages files can't be read. In Pages choose File → Export To → PDF or Word, then upload that.",
    ".heic": "iPhone HEIC photos can't be read here. Share the photo as JPEG (or take it with the camera button), then upload that.",
}

ACCEPTED_TEXT = "PDF, PowerPoint (.pptx), Word (.docx), text or subtitles (.txt .md .vtt .srt), photos of notes, or recordings (.mp3 .m4a .wav …)"


def kind_for(filename: str) -> tuple[str, str]:
    """(kind, extension) for an uploaded filename, or a friendly 415 error."""
    ext = Path(filename or "").suffix.lower()
    if ext in OLD_OFFICE:
        raise ApiError(415, "UNSUPPORTED_TYPE", OLD_OFFICE[ext])
    if ext not in KINDS:
        raise ApiError(415, "UNSUPPORTED_TYPE", f"Learnly can't read {ext or 'files without an extension'} files. Upload {ACCEPTED_TEXT}.")
    return KINDS[ext], ext


def limit_for(kind: str, settings: dict) -> int:
    """Largest upload in bytes: the AI setup limit, ten times that for recordings."""
    mb = int(settings.get("max_upload_mb", 50))
    return mb * MB * (10 if kind == "audio" else 1)


def too_large(limit: int, kind: str) -> ApiError:
    what = "recordings" if kind == "audio" else "files"
    return ApiError(
        413, "FILE_TOO_LARGE",
        f"That file is too large. The limit for {what} is {limit // MB} MB. "
        + ("Split the recording, or save it as MP3." if kind == "audio" else "Split it into chapters, or ask the administrator to raise the limit in AI setup."),
    )


def default_title(filename: str) -> str:
    """A readable title from the uploaded file's name, without any folder path (Windows or not)."""
    stem = Path(re.split(r"[\\/]", filename or "")[-1]).stem
    stem = re.sub(r"[_]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return (stem or "Untitled")[:120]


def check_magic(kind: str, ext: str, head: bytes) -> None:
    """The first bytes must match what the extension claims (a renamed .exe is not a PDF)."""
    ok = True
    if kind == "pdf":
        ok = b"%PDF-" in head[:1024]
    elif kind in ("slides", "doc"):
        ok = head.startswith(b"PK\x03\x04")
    elif kind == "image":
        ok = sniff_image(head) is not None
    elif kind == "text":
        ok = looks_like_text(head)
    if not ok:
        raise ApiError(415, "UNSUPPORTED_TYPE", f"This file isn't really a {ext} file (its contents don't match the name). Open it and save it again.")


async def receive(request, dest: Path, limit: int, kind: str, ext: str) -> int:
    """Stream the request body to `dest`. Stops as soon as the limit is passed and removes the partial
    file; checks the file's first bytes before keeping it. Returns the number of bytes written."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise too_large(limit, kind)
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    head = b""
    try:
        with open(dest, "wb") as fh:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > limit:
                    raise too_large(limit, kind)
                if len(head) < 8192:
                    head += chunk[: 8192 - len(head)]
                fh.write(chunk)
        if size == 0:
            raise ApiError(400, "EMPTY_FILE", "That file is empty.")
        check_magic(kind, ext, head)
    except BaseException:
        remove_quietly(dest)
        raise
    return size


def remove_quietly(path: Path) -> None:
    """Delete a stored file. On Windows a file still open elsewhere can't be removed; that's not worth an error."""
    try:
        os.remove(path)
    except OSError:  # already gone, or locked by another program
        pass
