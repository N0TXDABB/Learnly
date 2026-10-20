#!/usr/bin/env bash
# Learnly for Mac and Linux: run ./start.sh (on a Mac you can also double-click start-mac.command).
set -e
cd "$(dirname "$0")"

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  echo
  echo "  Learnly needs Python 3.10 or newer."
  echo "  Mac: download it from https://www.python.org/downloads/ (or: brew install python)"
  echo "  Linux: install python3 and python3-venv with your package manager."
  echo
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "  Setting up Learnly for the first time. This takes a minute or two..."
  if ! "$PY" -m venv .venv; then
    echo "  Couldn't create the virtual environment. On Debian/Ubuntu run: sudo apt install python3-venv"
    exit 1
  fi
fi

if ! .venv/bin/python -c "import fastapi, uvicorn, httpx, jwt, cryptography, pypdf" 2>/dev/null; then
  echo "  Installing the packages Learnly needs..."
  .venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt
fi

exec .venv/bin/python run.py "$@"
