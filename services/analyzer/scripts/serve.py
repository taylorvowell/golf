"""Serve the analyzer output + player so swings can be scrubbed in a browser.

    python scripts/serve.py [--port 8000]

Then open the printed URL. Range requests are supported so video seeking works, which the
stdlib SimpleHTTPRequestHandler does not do on its own.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler + HTTP Range, so <video> can seek."""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().do_GET()

        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        if not m:
            return super().do_GET()

        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416)
            return
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)

    def log_message(self, *a):
        pass


def write_index():
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    swings = sorted(
        d.name for d in out.iterdir()
        if d.is_dir() and (d / "analysis.json").exists() and (d / "normalized.mp4").exists()
    )
    (out / "index.json").write_text(json.dumps(swings), encoding="utf-8")
    return swings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    swings = write_index()
    if not swings:
        print("no analysed swings in out/ — run scripts/burnin.py first")
        return 1

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), RangeHandler) as httpd:
        print(f"swings: {', '.join(swings)}")
        print(f"\n  http://localhost:{args.port}/web/player.html?swing={swings[0]}\n")
        print("ctrl-c to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
