"""Speech-to-text for lecture recordings, on this computer.

faster-whisper is optional (it pulls in a few hundred MB), so it is only imported when a
recording is actually transcribed. Tests set state.cfg.transcriber to a stand-in instead.
Without either, a recording waits with status "needs_transcriber" until an administrator
installs speech-to-text from AI setup, then the student presses Try again.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import AsyncIterator, Callable

from . import Deleted
from .extract import ExtractError, mmss

log = logging.getLogger("learnly.study")

NOT_INSTALLED = (
    "Speech-to-text isn't installed on this computer yet, so the recording can't be turned into text. "
    "The administrator can add it in AI setup → Lecture recordings; then press Try again here."
)

PROGRESS_EVERY_S = 1.5  # how often transcription progress is written to the database

_models: dict[str, object] = {}
_model_lock = threading.Lock()
_install = {"running": False}


def faster_whisper_installed() -> bool:
    """True when the faster-whisper package can be imported (checked without importing it)."""
    try:
        return importlib.util.find_spec("faster_whisper") is not None
    except (ImportError, ValueError):
        return False


def available(state) -> bool:
    return state.cfg.transcriber is not None or faster_whisper_installed()


def installing() -> bool:
    return _install["running"]


def status(state) -> dict:
    model = state.settings.all().get("whisper_model", "base")
    ready = available(state)
    if _install["running"]:
        message = "Installing speech-to-text…"
    elif ready:
        message = f"Speech-to-text is installed. Recordings are transcribed on this computer with the {model} model."
    else:
        message = "Speech-to-text isn't installed. Recordings can be uploaded, but they wait until it is."
    return {"available": ready, "model": model, "installing": _install["running"], "message": message}


class NeedsTranscriber(Exception):
    """No speech-to-text on this computer yet."""


def _whisper_model(size: str):
    """Load (and on first use, download) a Whisper model. One model is kept in memory at a time."""
    from faster_whisper import WhisperModel  # optional dependency, imported only when needed

    with _model_lock:
        if size not in _models:
            _models.clear()
            _models[size] = WhisperModel(size, device="cpu", compute_type="int8")
        return _models[size]


def _faster_whisper(path: str, model_size: str, progress: Callable) -> list[tuple[float, str]]:
    progress(0.0, note="Loading the speech-to-text model (the first time downloads it)…")
    model = _whisper_model(model_size)
    segments, info = model.transcribe(path, vad_filter=True)
    total = float(getattr(info, "duration", 0) or 0)
    out = []
    for segment in segments:  # a generator: the audio is decoded while we iterate
        out.append((float(segment.start), segment.text.strip()))
        progress(min(1.0, segment.end / total) if total else 0.0, done_s=segment.end, total_s=total)
    progress(1.0, done_s=total, total_s=total)
    return out


def _reporter(report: Callable[[str], None]) -> Callable:
    """A progress callback for the transcriber thread, writing at most every PROGRESS_EVERY_S:
    "Transcribing 12:30 of 48:00". If the document has been deleted, the report raises Deleted,
    which stops the transcription."""
    last = {"at": 0.0, "text": ""}

    def progress(fraction: float = 0.0, done_s: float | None = None, total_s: float | None = None, note: str = "") -> None:
        if note:
            text = note
        elif total_s:
            text = f"Transcribing {mmss(done_s or 0)} of {mmss(total_s)}"
        else:
            text = f"Transcribing… {int(max(0.0, min(1.0, fraction or 0)) * 100)}%"
        now = time.monotonic()
        if text != last["text"] and (now - last["at"] >= PROGRESS_EVERY_S or note or fraction >= 1.0):
            last.update(at=now, text=text)
            try:
                report(text)
            except Deleted:
                raise
            except Exception:  # progress is a nicety; never stop a transcription for it
                log.debug("progress update failed", exc_info=True)

    return progress


async def in_daemon_thread(fn, *args):
    """Run fn in its own daemon thread and wait for it. A long transcription then can't stop
    Learnly from closing (asyncio.to_thread's worker threads are waited for at exit)."""
    loop = asyncio.get_running_loop()
    future = loop.create_future()

    def settle(setter, value) -> None:
        if not future.done():
            setter(value)

    def work() -> None:
        try:
            result = fn(*args)
        except BaseException as exc:  # handed back to the waiting coroutine
            outcome = (future.set_exception, exc)
        else:
            outcome = (future.set_result, result)
        try:
            loop.call_soon_threadsafe(settle, *outcome)
        except RuntimeError:  # Learnly is shutting down and the loop has closed
            pass

    threading.Thread(target=work, name="learnly-transcribe", daemon=True).start()
    return await future


async def transcribe(state, path: Path, report: Callable[[str], None]) -> list[tuple[float, str]]:
    """(start seconds, text) segments for a recording. Raises NeedsTranscriber or ExtractError."""
    model_size = state.settings.all().get("whisper_model", "base")
    run = state.cfg.transcriber
    if run is None:
        if not faster_whisper_installed():
            raise NeedsTranscriber(NOT_INSTALLED)
        run = _faster_whisper
    report("Starting speech-to-text…")
    try:
        segments = await in_daemon_thread(run, str(path), model_size, _reporter(report))
    except (NeedsTranscriber, Deleted):
        raise
    except ImportError:
        raise NeedsTranscriber(NOT_INSTALLED)
    except Exception as exc:
        log.warning("transcription failed: %s", exc)
        raise ExtractError(
            "The recording couldn't be turned into text. It may be damaged or in an unusual format: "
            "try saving it as MP3, M4A or WAV."
        )
    segments = [(float(start), (text or "").strip()) for start, text in segments if (text or "").strip()]
    if not segments:
        raise ExtractError("No speech was found in this recording.")
    return segments


# -- installing faster-whisper (administrators, from AI setup) -------------------------------------
def install_command() -> list[str]:
    """The one fixed command the Install button runs. Nothing from the request goes into it."""
    return [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
            "--progress-bar", "off", "faster-whisper"]


def claim_install() -> bool:
    """Only one install at a time. Returns False if one is already running."""
    if _install["running"]:
        return False
    _install["running"] = True
    return True


def release_install() -> None:
    _install["running"] = False


def start_install() -> asyncio.Queue:
    """Run pip in a background thread now; its output arrives on the returned queue as
    ("log", line) items, then ("end", exit code). Call claim_install() first; the claim is
    released when pip finishes. pip keeps running if the browser goes away: stopping it
    half-way could leave a broken install."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def put(item) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, item)
        except RuntimeError:  # the loop closed (Learnly is shutting down)
            pass

    def run() -> None:
        code = -1
        try:
            proc = subprocess.Popen(install_command(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            for raw in proc.stdout:
                line = raw.decode("utf-8", "replace").rstrip()
                if line:
                    put(("log", line[:500]))
            code = proc.wait()
        except Exception as exc:  # pip missing, no permission to start a process, …
            put(("log", f"Couldn't run pip: {exc}"))
        finally:
            importlib.invalidate_caches()
            release_install()
            put(("end", code))

    threading.Thread(target=run, name="learnly-install-whisper", daemon=True).start()
    return queue


async def install_events(state, queue: asyncio.Queue) -> AsyncIterator[tuple[str, dict]]:
    """Stream pip's output as `log {line}`, then `done {available, ok, message}`."""
    yield "log", {"line": "Installing speech-to-text (faster-whisper). This downloads about 100 MB and can take a few minutes…"}
    while True:
        kind, value = await queue.get()
        if kind == "log":
            yield "log", {"line": value}
            continue
        ready = available(state)
        if value == 0 and ready:
            message = "Speech-to-text is installed. Recordings waiting for it can now be tried again."
        else:
            message = "The install didn't finish. Check the log above, or run this in a terminal: pip install -r requirements-audio.txt"
        yield "done", {"available": ready, "ok": value == 0, "message": message}
        return
