"""Turning uploaded course files into plain text, section by section.

These are pure functions (no database, no AI) so they are easy to test. Each extractor
returns a list of Section(location, text) in reading order. The location is what a student
sees as the source of a fact: "Page 3", "Slide 4", "Section: Cell division", "12:30".

Files come from students, so every extractor assumes the file may be damaged, huge or
hostile: zip archives (.pptx, .docx) are checked for zip bombs before anything is read,
XML with a DOCTYPE is refused wherever it sits (OOXML never has one), and any parsing problem
becomes an ExtractError with a friendly message instead of a crash.
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from xml.parsers import expat

# Zip-bomb guards for .pptx/.docx. Real decks with embedded pictures stay far below these.
MAX_ZIP_ENTRIES = 5000
MAX_ZIP_TOTAL_BYTES = 400 * 1024 * 1024  # declared uncompressed size of everything
MAX_XML_PART_BYTES = 40 * 1024 * 1024  # one slide or the document body, actually read
MAX_RATIO = 200  # compression ratio allowed for parts over RATIO_FLOOR
RATIO_FLOOR = 2 * 1024 * 1024

MAX_PDF_PAGES = 2000
MAX_TEXT_CHARS = 1_500_000  # about 600 pages of a textbook; more should be split into chapters
TIMED_BLOCK_SECONDS = 60  # transcripts are grouped into blocks of about a minute

DAMAGED_PART = "Part of this file is damaged. Open it and save it again."
UNSAFE_XML = "This file contains something Office files never do, so it wasn't opened."

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
_W = "{%s}" % NS["w"]
_A = "{%s}" % NS["a"]
_P = "{%s}" % NS["p"]
_R = "{%s}" % NS["r"]


@dataclass
class Section:
    location: str
    text: str


class ExtractError(Exception):
    """The file can't be turned into text. The message is shown to the student as it is."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


# -- shared text helpers -----------------------------------------------------------------
_SPACES = re.compile(r"[ \t 　]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def clean_text(text: str) -> str:
    """Tidy extracted text: normal Unicode, no control characters, single spaces, at most one blank line."""
    text = unicodedata.normalize("NFC", text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def total_chars(sections: list[Section]) -> int:
    return sum(len(s.text) for s in sections)


def check_length(sections: list[Section]) -> list[Section]:
    if total_chars(sections) > MAX_TEXT_CHARS:
        raise ExtractError(
            "This file has more text than Learnly can study at once (about 600 pages). "
            "Split it into chapters and upload them separately."
        )
    return sections


def mmss(seconds: float) -> str:
    """12:30 for 750 s, 1:02:30 past an hour: how students find a moment in a recording."""
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def group_by_size(paragraphs: list[str], label: str = "Part", target: int = 1800) -> list[Section]:
    """Plain text without headings: group paragraphs into numbered parts of about `target` characters."""
    sections: list[Section] = []
    current: list[str] = []
    size = 0
    for para in paragraphs:
        if current and size + len(para) > target:
            sections.append(Section(f"{label} {len(sections) + 1}", "\n\n".join(current)))
            current, size = [], 0
        current.append(para)
        size += len(para) + 2
    if current:
        sections.append(Section(f"{label} {len(sections) + 1}", "\n\n".join(current)))
    return sections


def heading_label(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip().strip("#").strip()
    return "Section: " + (text[:60] + "…" if len(text) > 60 else text)


# -- PDF -----------------------------------------------------------------------------------
def pdf_sections(data: bytes) -> list[Section]:
    """Text of each page ("Page 3"). Scanned PDFs (pictures of pages) have no text to read."""
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            # Many PDFs are "encrypted" with an empty password just to stop editing; those still open.
            try:
                if not reader.decrypt(""):
                    raise ValueError("password")
            except Exception:
                raise ExtractError("This PDF is password-protected. Open it, save a copy without the password, and upload that.")
        pages = list(reader.pages)
    except ExtractError:
        raise
    except Exception:
        raise ExtractError("This PDF couldn't be opened. It may be damaged: try opening it and saving or printing it as a new PDF.")
    if len(pages) > MAX_PDF_PAGES:
        raise ExtractError(f"This PDF has {len(pages)} pages. Upload chapters of up to {MAX_PDF_PAGES} pages instead.")
    sections = []
    for number, page in enumerate(pages, 1):
        try:
            text = clean_text(page.extract_text() or "")
        except Exception:  # one odd page shouldn't lose the rest of the document
            text = ""
        if text:
            sections.append(Section(f"Page {number}", text))
    if not any(len(s.text) >= 20 for s in sections):
        raise ExtractError(
            "This PDF looks like scanned pages (pictures with no text inside), so there are no words to read. "
            "Take clear photos of the pages and upload those instead: the AI can read photos of notes."
        )
    return check_length(sections)


# -- zip-based Office files ------------------------------------------------------------------
def open_zip(data: bytes, what: str) -> zipfile.ZipFile:
    """Open a .pptx/.docx after checking it isn't a zip bomb."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except (zipfile.BadZipFile, ValueError, OSError):
        raise ExtractError(f"This {what} file is damaged or isn't really a {what} file. Open it and save it again.")
    if len(infos) > MAX_ZIP_ENTRIES:
        raise ExtractError(f"This {what} file has too many parts inside to be a normal document.")
    if sum(i.file_size for i in infos) > MAX_ZIP_TOTAL_BYTES:
        raise ExtractError(f"This {what} file unpacks to far more data than a normal document. It can't be read safely.")
    for info in infos:
        if info.file_size > RATIO_FLOOR and info.file_size > MAX_RATIO * max(1, info.compress_size):
            raise ExtractError(f"This {what} file is packed in an unusual way that isn't safe to open.")
    return zf


def read_part(zf: zipfile.ZipFile, name: str) -> bytes | None:
    """Read one part, never more than MAX_XML_PART_BYTES (the sizes in the zip header can lie)."""
    try:
        with zf.open(name) as fh:
            data = fh.read(MAX_XML_PART_BYTES + 1)
    except KeyError:
        return None
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError, EOFError):
        raise ExtractError(DAMAGED_PART)
    if len(data) > MAX_XML_PART_BYTES:
        raise ExtractError("Part of this file is far larger than a normal document. It can't be read safely.")
    return data


class _RootReached(Exception):
    """The prolog check has reached the root element, after which XML allows no DOCTYPE."""


def refuse_doctype(data: bytes) -> None:
    """Refuse XML with a DOCTYPE. Office files never have one, and a DOCTYPE is the only place the
    entities of a "billion laughs" file can be declared, which would make ElementTree expand a few
    kilobytes into gigabytes. expat reads only the prolog (in whatever encoding the part declares,
    and past any comments placed first to hide the DOCTYPE) and stops at the root element."""

    def refuse(*_args):
        raise ExtractError(UNSAFE_XML)

    def root_reached(*_args):
        raise _RootReached()

    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = refuse
    parser.EntityDeclHandler = refuse
    parser.StartElementHandler = root_reached
    try:
        parser.Parse(data, True)
    except _RootReached:
        return
    except expat.ExpatError:
        raise ExtractError(DAMAGED_PART)


def parse_xml(data: bytes | None) -> ET.Element | None:
    if data is None:
        return None
    refuse_doctype(data)
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        raise ExtractError(DAMAGED_PART)


def relationships(zf: zipfile.ZipFile, part: str) -> dict[str, tuple[str, str]]:
    """rId -> (type, full part name) for a part such as ppt/slides/slide1.xml."""
    path = PurePosixPath(part)
    rels = parse_xml(read_part(zf, str(path.parent / "_rels" / (path.name + ".rels"))))
    out: dict[str, tuple[str, str]] = {}
    if rels is None:
        return out
    for rel in rels.findall("rel:Relationship", NS):
        target = rel.get("Target", "")
        if rel.get("TargetMode") == "External" or not target:
            continue
        full = target.lstrip("/") if target.startswith("/") else _normalise_part(path.parent / target)
        out[rel.get("Id", "")] = (rel.get("Type", ""), full)
    return out


def _normalise_part(path: PurePosixPath) -> str:
    parts: list[str] = []
    for piece in path.parts:
        if piece == "..":
            if parts:
                parts.pop()
        elif piece not in (".", ""):
            parts.append(piece)
    return "/".join(parts)


# -- PowerPoint -----------------------------------------------------------------------------
_SKIP_PLACEHOLDERS = {"sldNum", "dt", "ftr", "hdr", "sldImg"}


def _paragraphs(element: ET.Element) -> list[str]:
    """Text of each a:p paragraph inside a shape, keeping line breaks."""
    out = []
    for para in element.iter(_A + "p"):
        pieces = []
        for node in para.iter():
            if node.tag == _A + "t" and node.text:
                pieces.append(node.text)
            elif node.tag == _A + "br":
                pieces.append("\n")
        text = "".join(pieces).strip()
        if text:
            out.append(text)
    return out


def _table_rows(table: ET.Element) -> list[str]:
    rows = []
    for tr in table.iter(_A + "tr"):
        cells = [" ".join(_paragraphs(tc)) for tc in tr.findall(_A + "tc")]
        if any(cells):
            rows.append(" | ".join(cells))
    return rows


def _shape_texts(tree: ET.Element) -> list[tuple[bool, list[str]]]:
    """(is_title, paragraphs) for each text shape and table on a slide, in document order."""
    found: list[tuple[bool, list[str]]] = []
    for node in tree.iter():
        if node.tag == _P + "sp":
            ph = node.find("p:nvSpPr/p:nvPr/p:ph", NS)
            kind = ph.get("type", "") if ph is not None else ""
            if kind in _SKIP_PLACEHOLDERS:
                continue
            body = node.find("p:txBody", NS)
            paras = _paragraphs(body) if body is not None else []
            if paras:
                found.append((kind in ("title", "ctrTitle"), paras))
        elif node.tag == _A + "tbl":
            rows = _table_rows(node)
            if rows:
                found.append((False, rows))
    return found


def _slide_order(zf: zipfile.ZipFile) -> list[str]:
    """Slide parts in presentation order, falling back to slide numbers in the file names."""
    names = set(zf.namelist())
    order: list[str] = []
    pres = parse_xml(read_part(zf, "ppt/presentation.xml"))
    if pres is not None:
        rels = relationships(zf, "ppt/presentation.xml")
        for sld in pres.findall("p:sldIdLst/p:sldId", NS):
            target = rels.get(sld.get(_R + "id", ""), ("", ""))[1]
            if target in names and target not in order:
                order.append(target)
    if not order:
        numbered = [(int(m.group(1)), n) for n in names if (m := re.fullmatch(r"ppt/slides/slide(\d+)\.xml", n))]
        order = [n for _, n in sorted(numbered)]
    return order


def pptx_sections(data: bytes) -> list[Section]:
    """Each slide's text (title first, then the other shapes) plus its speaker notes ("Slide 4")."""
    zf = open_zip(data, ".pptx")
    with zf:
        slides = _slide_order(zf)
        if not slides:
            raise ExtractError("No slides were found in this .pptx file.")
        sections = []
        for number, part in enumerate(slides, 1):
            tree = parse_xml(read_part(zf, part))
            if tree is None:
                continue
            shapes = _shape_texts(tree)
            lines = [line for is_title, paras in shapes if is_title for line in paras]
            lines += [line for is_title, paras in shapes if not is_title for line in paras]
            notes = ""
            for rel_type, target in relationships(zf, part).values():
                if rel_type.endswith("/notesSlide"):
                    notes = _notes_text(parse_xml(read_part(zf, target)))
            text = "\n".join(lines)
            if notes:
                text = (text + "\n\n" if text else "") + "Speaker notes: " + notes
            text = clean_text(text)
            if text:
                sections.append(Section(f"Slide {number}", text))
    if not sections:
        raise ExtractError("These slides have no text in them (only pictures?). Upload a PDF of the slides, or photos of them.")
    return check_length(sections)


def _notes_text(tree: ET.Element | None) -> str:
    if tree is None:
        return ""
    paras = []
    for node in tree.iter(_P + "sp"):
        ph = node.find("p:nvSpPr/p:nvPr/p:ph", NS)
        if ph is None or ph.get("type") != "body":
            continue
        body = node.find("p:txBody", NS)
        if body is not None:
            paras += _paragraphs(body)
    return " ".join(paras)


# -- Word -------------------------------------------------------------------------------------
_HEADING_STYLE = re.compile(r"heading|title|berschrift|titre|titulo|kop", re.I)


def _word_text(element: ET.Element) -> str:
    pieces = []
    for node in element.iter():
        if node.tag == _W + "t" and node.text:
            pieces.append(node.text)
        elif node.tag == _W + "tab":
            pieces.append("\t")
        elif node.tag in (_W + "br", _W + "cr"):
            pieces.append("\n")
    return "".join(pieces).strip()


def _is_heading(para: ET.Element) -> bool:
    ppr = para.find("w:pPr", NS)
    if ppr is None:
        return False
    style = ppr.find("w:pStyle", NS)
    if style is not None and _HEADING_STYLE.search(style.get(_W + "val", "")):
        return True
    level = ppr.find("w:outlineLvl", NS)
    return level is not None and level.get(_W + "val", "9").isdigit() and int(level.get(_W + "val")) < 9


def _word_blocks(body: ET.Element) -> list[tuple[bool, str]]:
    """(is_heading, text) for each paragraph and table row, in reading order."""
    blocks: list[tuple[bool, str]] = []
    for child in body:
        if child.tag == _W + "p":
            text = _word_text(child)
            if text:
                blocks.append((_is_heading(child) and len(text) <= 200, text))
        elif child.tag == _W + "tbl":
            for tr in child.iter(_W + "tr"):
                cells = [_word_text(tc) for tc in tr.findall(_W + "tc")]
                if any(cells):
                    blocks.append((False, " | ".join(c.replace("\n", " ") for c in cells)))
        elif child.tag == _W + "sdt":  # content controls (tables of contents, cover pages) hold paragraphs too
            content = child.find("w:sdtContent", NS)
            if content is not None:
                blocks += _word_blocks(content)
    return blocks


def docx_sections(data: bytes) -> list[Section]:
    """Paragraphs and tables, split at headings ("Section: <heading>"), or into "Part N" without headings."""
    zf = open_zip(data, ".docx")
    with zf:
        tree = parse_xml(read_part(zf, "word/document.xml"))
    if tree is None:
        raise ExtractError("This .docx file has no document inside. Open it in Word and save it again.")
    body = tree.find("w:body", NS)
    blocks = _word_blocks(body) if body is not None else []
    if not blocks:
        raise ExtractError("This Word document has no text in it.")
    if not any(is_heading for is_heading, _ in blocks):
        return check_length([Section(s.location, clean_text(s.text)) for s in group_by_size([t for _, t in blocks])])
    sections: list[Section] = []
    label, current = "Part 1", []
    for is_heading, text in blocks:
        if is_heading:
            if current:
                sections.append(Section(label, clean_text("\n\n".join(current))))
            label, current = heading_label(text), [text]
        else:
            current.append(text)
    if current:
        sections.append(Section(label, clean_text("\n\n".join(current))))
    return check_length([s for s in sections if s.text])


# -- text, Markdown and subtitles ------------------------------------------------------------------
def decode_text(data: bytes) -> str:
    """Decode a text file: UTF-8 or UTF-16 (with a BOM), else Big5-HKSCS or GB18030 (common for
    Chinese notes in Hong Kong), else Windows-1252 as a last resort."""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", "replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", "replace")
    for encoding in ("utf-8", "big5hkscs", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("cp1252", "replace")


def looks_like_text(data: bytes) -> bool:
    """A text upload shouldn't be a binary file renamed to .txt."""
    head = data[:8192]
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return True
    return b"\x00" not in head


_MD_HEADING = re.compile(r"^#{1,6}\s+\S")


def text_sections(data: bytes, ext: str) -> list[Section]:
    ext = ext.lower()
    text = decode_text(data)
    if ext in (".vtt", ".srt"):
        cues = parse_subtitles(text)
        if not cues:
            raise ExtractError("No captions were found in this subtitle file.")
        return check_length(timed_sections(cues))
    text = clean_text(text)
    if not text:
        raise ExtractError("This file is empty.")
    if ext in (".md", ".markdown") and any(_MD_HEADING.match(line) for line in text.split("\n")):
        sections: list[Section] = []
        label, current = "Part 1", []
        for line in text.split("\n"):
            if _MD_HEADING.match(line):
                if "".join(current).strip():
                    sections.append(Section(label, "\n".join(current).strip()))
                label, current = heading_label(line), [line]
            else:
                current.append(line)
        if "".join(current).strip():
            sections.append(Section(label, "\n".join(current).strip()))
        return check_length(sections)
    return check_length(group_by_size([p for p in re.split(r"\n\s*\n", text) if p.strip()]))


_CUE_TIME = re.compile(
    r"^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}"
)
_TAG = re.compile(r"<[^>]{0,80}>")


def parse_subtitles(text: str) -> list[tuple[float, str]]:
    """(start seconds, text) for each caption in a WebVTT or SRT file. Cue numbers, styling tags,
    NOTE/STYLE blocks and the repeated lines of automatic captions are dropped."""
    cues: list[tuple[float, str]] = []
    start: float | None = None
    lines: list[str] = []
    skipping = False

    def flush():
        if start is not None and lines:
            caption = clean_text(" ".join(lines))
            if caption and (not cues or cues[-1][1] != caption):
                cues.append((start, caption))

    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        match = _CUE_TIME.match(line)
        if match:
            flush()
            hours, minutes, seconds, _ms = match.groups()
            start = int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds)
            lines, skipping = [], False
            continue
        if not line:
            flush()
            start, lines, skipping = None, [], False
            continue
        if start is None:
            if line.startswith(("NOTE", "STYLE", "REGION")):
                skipping = True
            continue  # header, cue numbers and identifiers
        if not skipping:
            cleaned = _TAG.sub("", line).strip()
            if cleaned and (not lines or lines[-1] != cleaned):
                lines.append(cleaned)
    flush()
    return cues


def timed_sections(segments: list[tuple[float, str]], block_seconds: int = TIMED_BLOCK_SECONDS) -> list[Section]:
    """Group transcript segments into blocks of about a minute, each labelled with its start time ("12:30")."""
    sections: list[Section] = []
    block_start: float | None = None
    texts: list[str] = []
    for start, text in sorted(segments, key=lambda s: s[0]):
        text = (text or "").strip()
        if not text:
            continue
        if block_start is None:
            block_start = start
        elif start - block_start >= block_seconds:
            sections.append(Section(mmss(block_start), " ".join(texts)))
            block_start, texts = start, []
        texts.append(text)
    if texts and block_start is not None:
        sections.append(Section(mmss(block_start), " ".join(texts)))
    return [Section(s.location, clean_text(s.text)) for s in sections]
