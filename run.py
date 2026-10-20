#!/usr/bin/env python3
"""Start Learnly and open it in your browser.

    python run.py                 # http://127.0.0.1:8787
    python run.py --port 9000
    python run.py --no-browser
    python run.py --lan           # also reachable from other devices on your network
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser

if sys.version_info < (3, 10):
    sys.exit("Learnly needs Python 3.10 or newer. Get it from https://www.python.org/downloads/")

try:
    import httpx
    import uvicorn
except ImportError:
    sys.exit("Some packages are missing. Run: python -m pip install -r requirements.txt  (or use start.bat / start.sh)")

from learnly import __version__
from learnly.app import create_app
from learnly.config import AppConfig


def port_free(host: str, port: int) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            return False
    return True


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # no packets are sent; this only picks the outgoing interface
            return s.getsockname()[0]
    except OSError:
        return "your-computer's-address"


def ai_hint() -> str:
    for name, url in (("Ollama", "http://127.0.0.1:11434/api/version"), ("LM Studio", "http://127.0.0.1:1234/v1/models")):
        try:
            if httpx.get(url, timeout=1.0, trust_env=False).status_code == 200:
                return f"Found {name} running on this computer."
        except httpx.HTTPError:
            continue
    return "No local AI found yet. Install Ollama (https://ollama.com/download), then: ollama pull qwen3.5:4b"


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Learnly")
    parser.add_argument("--port", type=int, default=None, help="port to use (default 8787)")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    parser.add_argument("--lan", action="store_true", help="let other devices on your network open Learnly")
    args = parser.parse_args()

    cfg = AppConfig.from_env()
    if args.port:
        cfg.port = args.port
    if args.lan:
        cfg.host = "0.0.0.0"
        cfg.allowed_hosts = ["*"]
    port = cfg.port
    while not port_free(cfg.host, port) and port < cfg.port + 20:
        port += 1
    if port != cfg.port:
        print(f"Port {cfg.port} is busy, using {port}.")
        cfg.port = port

    url = f"http://127.0.0.1:{cfg.port}"
    print()
    print(f"  Learnly {__version__} · snap, solve and study with AI on your own computer")
    print(f"  Open {url}")
    if args.lan:
        print(f"  On your network: http://{local_ip()}:{cfg.port}   (only on networks you trust)")
        print("  Tip: open that address on your phone to snap homework photos with its camera.")
    print(f"  Data folder: {cfg.data_dir}")
    print(f"  {ai_hint()}")
    print("  Press Ctrl+C to stop.")
    print()

    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port, log_level="warning")


if __name__ == "__main__":
    main()
