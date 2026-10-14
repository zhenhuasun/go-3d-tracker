#!/usr/bin/env python3
"""
go-3d-tracker dev proxy.

- Serves the frontend from ./public
- Proxies the GO OpenData API server-side so the API key never ships to browsers
- Caches upstream responses for 30s (also protects the key from excessive calls)

Usage:
    GO_API_KEY=your_key_here python3 proxy.py [port]

Then open http://localhost:8080
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

API_BASE = "https://api.openmetrolinx.com/OpenDataAPI/api/V1"
CACHE_TTL = 30
_cache = {}  # upstream_path -> (timestamp, normalized_vehicles)


def fetch_vehicles(upstream_path, kind):
    key = os.environ.get("GO_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GO_API_KEY environment variable is not set")
    now = time.time()
    if upstream_path in _cache and now - _cache[upstream_path][0] < CACHE_TTL:
        return _cache[upstream_path][1]
    url = f"{API_BASE}/{upstream_path}?key={urllib.parse.quote(key)}"
    req = urllib.request.Request(url, headers={"User-Agent": "go-3d-tracker/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    meta = data.get("Metadata") or {}
    if str(meta.get("ErrorCode")) not in ("200", "204"):
        raise RuntimeError(f"upstream: {meta.get('ErrorCode')} {meta.get('ErrorMessage')}")
    trips = (data.get("Trips") or {}).get("Trip") or []
    out = []
    for t in trips:
        try:
            lat = float(t.get("Latitude"))
            lon = float(t.get("Longitude"))
        except (TypeError, ValueError):
            continue
        out.append({
            "id": str(t.get("TripNumber") or "?"),
            "kind": kind,
            "lat": lat,
            "lon": lon,
            "line": str(t.get("LineCode") or t.get("RouteNumber") or "").strip(),
            "label": t.get("Display") or str(t.get("TripNumber")),
            "delayMin": round((t.get("DelaySeconds") or 0) / 60.0, 1),
            "moving": bool(t.get("IsInMotion")),
            "heading": t.get("Course"),
            "updated": t.get("ModifiedDate"),
        })
    _cache[upstream_path] = (now, out)
    return out


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            body = json.dumps({
                "ok": True,
                "keyConfigured": bool(os.environ.get("GO_API_KEY")),
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            }).encode()
            self._send_json(body)
            return
        if parsed.path == "/api/vehicles":
            qs = urllib.parse.parse_qs(parsed.query)
            qtype = qs.get("type", ["trains"])[0]
            kind = "train" if qtype == "trains" else "bus"
            upstream = ("ServiceataGlance/Trains/All" if kind == "train"
                        else "ServiceataGlance/Buses/All")
            try:
                vehicles = fetch_vehicles(upstream, kind)
            except RuntimeError as e:
                self.send_error(500, str(e))
                return
            except Exception as e:
                self.send_error(502, f"upstream fetch failed: {e}")
                return
            self._send_json(json.dumps({"vehicles": vehicles}).encode())
            return
        return super().do_GET()

    def _send_json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    # Bind 127.0.0.1 by default; set HOST=0.0.0.0 to let other devices
    # on your local network (e.g. your phone) reach the proxy.
    host = os.environ.get("HOST", "127.0.0.1")
    server = ThreadingHTTPServer(
        (host, port), partial(Handler, directory="public"))
    print(f"go-3d-tracker proxy on http://{host}:{port}")
    print("key configured:", bool(os.environ.get("GO_API_KEY")))
    server.serve_forever()
