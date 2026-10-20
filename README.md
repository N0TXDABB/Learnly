# Learnly · 香港溫習小幫手

**Snap a homework question and get step-by-step help. Turn your slides, PDFs and lecture recordings into outlines, flashcards and mock exams. Everything runs on your own computer.**

Learnly uses an AI model that runs on your machine (Ollama or LM Studio; Qwen 3.5 recommended, which can also read photos). Your questions, notes and recordings never leave your computer. The website is drawn as Hong Kong at night: every section is a live scene of a district that reacts to what you do.

![Learnly home: the Hong Kong Island skyline across Victoria Harbour](docs/screenshots/home.jpg)

> The screenshots were taken with Learnly's test setup, which uses a simulated AI and sample notes. Your own answers come from the model on your computer.

---

## Quick start (Windows)

1. Install **Python 3.13** from https://www.python.org/downloads/windows/. On the first screen of the installer, tick **"Add python.exe to PATH"**.
2. Unzip Learnly, open the folder and double-click **`start.bat`**. The first start takes a few minutes while it installs what it needs (into its own `.venv` folder). Your browser then opens **http://127.0.0.1:8787**.
3. Create your account. The first account becomes the **administrator**.
4. Install **Ollama** from https://ollama.com/download, then in Command Prompt run:
   ```
   ollama pull qwen3.5:4b
   ```
   The AI pill at the top right turns green.

Mac: double-click `start-mac.command` (first time: right-click → Open). Linux: `./start.sh`.
Options: `start.bat --port 9000` · `--no-browser` · `--lan` (open Learnly on your phone over your home Wi-Fi, e.g. to photograph homework; only on networks you trust).

## 1 · Solving a homework problem — 中環 Central

1. **Input the problem.** Open **Solve** and snap a photo of the question (on a phone the camera opens), or type/paste it. Learnly reads the photo and shows you the question so you can fix anything it misread.
2. **Review the solution steps.** The answer arrives as numbered steps, each explaining *why* before the working, with proper maths. The final answer and the key idea are highlighted at the end.
3. **Ask the AI Tutor.** Unclear line? Press **Ask AI Tutor** on that step and choose *Explain more simply*, *Why does this rule apply?*, *Show more detail*, or type your own question.
4. **Practise similar problems.** The quiz generator makes 3–5 similar problems (easier, the same, or harder). Type your answers and press **Check**. Learnly accepts equivalent answers (`0.5` = `1/2`, `x = ±3` = `3, −3`). Stuck? Ask for a hint, the worked solution, or a full step-by-step solve.

| Check the photo was read right | Read the steps |
|---|---|
| ![A photo of a homework question, read by the AI and ready to check](docs/screenshots/solve-photo.jpg) | ![The solution as numbered steps with the maths typeset](docs/screenshots/solve-steps.jpg) |
| **Ask AI Tutor about a step** | **Practise similar problems** |
| ![Ask AI Tutor under step 3: why the rule applies, and a simpler explanation](docs/screenshots/solve-tutor.jpg) | ![Four practice problems, two marked right and two wrong](docs/screenshots/solve-practice.jpg) |

## 2 · Studying for exams — 山頂 The Peak and 旺角 Mong Kok

1. **Upload documents.** On **Study**, drag and drop lecture slides (`.pptx`), chapter PDFs, Word documents, notes (`.txt`, `.md`), photos of notes, or lecture recordings (`.mp3`, `.m4a`, `.wav`, `.mp4` …).
2. **Generate revision materials.** Tick the documents and choose **Chapter outline**, **Flashcards**, **Quiz** or **Mock exam** (with a time limit). Learnly works through long documents part by part and tells you how far it has got.
3. **Review and self-test.** On **Review**, flip through the flashcards that are due (spaced repetition: cards you know come back less often), take quizzes and mock exams, and see your **weak topics**. **Practise my weak topics** makes a new quiz from the parts of your notes that cover them. Homework practice counts towards your weak topics too.

| Upload and choose what to make | Chapter outline |
|---|---|
| ![Three Biology documents ready, and the Make revision material panel](docs/screenshots/study.jpg) | ![A chapter outline with "What to revise first"](docs/screenshots/outline.jpg) |
| **Flashcards** | **Weak topics** |
| ![A flashcard with Again, Hard, Good and Easy buttons](docs/screenshots/flashcards.jpg) | ![Review: cards due, weak topics with accuracy bars, decks and exams](docs/screenshots/review.jpg) |
| **Timed mock exam** | **Marked, by topic** |
| ![A mock exam question with a timer and question navigator](docs/screenshots/exam.jpg) | ![Mock exam results: 8 out of 13, with a breakdown by topic](docs/screenshots/results.jpg) |

## Run the AI on your computer

| Your computer | Model | Size | Reads photos |
|---|---|---|---|
| 8 GB RAM laptop | `qwen3.5:2b` | 2.7 GB | ✓ |
| 8–16 GB RAM (recommended) | `qwen3.5:4b` | 3.4 GB | ✓ |
| 16 GB+ RAM or a GPU | `qwen3.5:9b` | 6.6 GB | ✓ |
| Older Ollama | `qwen3:4b` | 2.5 GB | — |

Learnly picks the best installed model automatically; you can choose one in **AI setup** and download models there too.
**LM Studio** works as well: load a model, turn on its local server, then **AI setup → AI app → LM Studio…** (`http://127.0.0.1:1234/v1`).

### Lecture recordings (speech to text, optional)

Recordings are turned into text on your computer with Whisper (faster-whisper). It's an optional extra: **AI setup → Lecture recordings → Install** (administrator), or `.venv\Scripts\python -m pip install -r requirements-audio.txt` in the Learnly folder. Model sizes go from `tiny` (75 MB, fastest) and `base` (145 MB, the default) to `large-v3` (3 GB, slow without a graphics card, most accurate); the model downloads the first time it's used. The spoken language is detected automatically. Recordings uploaded before it's installed wait, then press **Try again**.

## The districts

| District | Page | What it does |
|---|---|---|
| 維港 Victoria Harbour | **Home** | Snap or type a problem, what's due today, your weak topics |
| 中環 Central | **Solve** | Step-by-step solutions; the towers light up floor by floor as the steps arrive |
| 山頂 The Peak | **Study** | Your documents and revision material; the city below fills with light as you add notes |
| 旺角 Mong Kok | **Review** | Flashcards, quizzes, mock exams, weak topics; the 答對 neon sign flashes when you get one right |
| 灣仔 Wan Chai | **Tutor** | Chat with the tutor about anything you're studying; the tram sets off when it answers |
| 青馬 Tsing Ma Bridge | **AI setup** | Connect Ollama or LM Studio, download models, speech-to-text, tutor prompt |
| 金鐘 Admiralty | **Admin** | Accounts and roles, background jobs, the audit log |

## Accounts

The first account is the **administrator**; everyone else is a **student** with their own private problems, documents and progress. Sign-in uses short-lived signed tokens, optional **two-step sign-in** with any authenticator app (Account page), and an append-only audit log of important actions.

## Your data

Everything lives in the `data` folder next to this file: accounts, uploads, notes, flashcards and progress. Back it up by copying the folder; to start fresh, stop Learnly and delete it.
What leaves your computer: model downloads (from Ollama) and, if you install speech-to-text, the Whisper model download. Nothing else.

## Troubleshooting

| Problem | Fix |
|---|---|
| `start.bat` closes straight away | Open the Learnly folder, type `cmd` in the address bar, press Enter, then type `start.bat` to see the message |
| "Microsoft Visual C++ 14.0 or greater is required" | Your Python is too new for some packages. Install Python 3.13, delete the `.venv` folder, run `start.bat` again |
| "AI offline" | Start Ollama (open the app), or check **AI setup → Address**, then **Test connection** |
| "can't read photos" | `ollama pull qwen3.5:4b` (or type the question) |
| Photos from an iPhone won't open | Share them as JPEG, or use the camera button in Learnly |
| A PDF says it has no text | It's a scan. Photograph the pages instead, or upload the photos |
| A recording says it needs speech-to-text | **AI setup → Lecture recordings → Install** |
| Answers are slow | Use a smaller model (`qwen3.5:2b`), turn off *Think it through*, or raise **Wait up to** in AI setup |
| Port 8787 in use | Learnly picks the next free port and prints it, or use `--port` |

## For developers

```
pip install -r requirements-dev.txt
python -m pytest -q tests --ignore=tests/e2e     # API and unit tests (simulated AI)
python -m pytest -q tests/e2e                    # browser tests (needs: python -m playwright install chromium)
```

- API documentation: http://127.0.0.1:8787/api/docs
- `learnly/homework/` the solver, step questions and practice problems · `learnly/study/` uploads, text extraction, outlines, flashcards, quizzes, review · `learnly/llm/` the local AI client · `learnly/security/` tokens, roles, two-step sign-in, audit log
- `learnly/web/` website (no build step): `js/scenes/` the Hong Kong scenes, `js/pages/` one file per page
- Tests use `tests/fake_ollama.py`, a stand-in for Ollama and LM Studio. They check Learnly's behaviour, not a real model's answers.

Third-party licences are in `docs/licenses/` (KaTeX, marked, DOMPurify, qrcode-generator, Big Shoulders Display and Instrument Sans fonts).

*Learnly is a study aid. Check important answers, and learn the method, not just the result.*
