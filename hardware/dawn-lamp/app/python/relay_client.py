"""
Sends the lamp's events to the website relay (/api/junction2026/relay) and picks up
commands from the web page on the same round trip. Standard library only.

Events wait in a small queue (also saved to disk) while the network is down, so a
Wi-Fi drop at the venue loses nothing.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

MAX_BATCH = 50
MAX_QUEUE = 2000


class Relay:
    def __init__(self, url: str, token: str | None, channel: str = "dawn", spool: str | None = None, timeout: float = 6):
        self.url, self.token, self.channel, self.spool, self.timeout = url, token, channel, spool, timeout
        self.queue: list[dict] = []
        self.backoff_until = 0.0
        self.failures = 0
        self.last_ok: float | None = None
        if spool and os.path.exists(spool):
            try:
                with open(spool) as f:
                    self.queue = [json.loads(line) for line in f if line.strip()][-MAX_QUEUE:]
            except (OSError, ValueError):
                self.queue = []

    def add(self, events: list[dict]) -> None:
        if not events:
            return
        self.queue = (self.queue + events)[-MAX_QUEUE:]
        self._save()

    def _save(self) -> None:
        if not self.spool:
            return
        try:
            tmp = self.spool + ".tmp"
            with open(tmp, "w") as f:
                f.writelines(json.dumps(e) + "\n" for e in self.queue)
            os.replace(tmp, self.spool)
        except OSError:
            pass

    def sync(self, force: bool = False) -> list[str]:
        """Send up to one batch (or an empty heartbeat when force=True). Returns commands."""
        if not self.token or not self.url:
            return []
        now = time.time()
        if now < self.backoff_until or (not self.queue and not force):
            return []
        batch = self.queue[:MAX_BATCH]
        body = json.dumps({"channel": self.channel, "events": batch}).encode()
        req = urllib.request.Request(self.url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "x-device-token": self.token})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                reply = json.loads(res.read().decode() or "{}")
        except (urllib.error.URLError, OSError, ValueError) as err:
            self.failures += 1
            self.backoff_until = now + min(60, 2 ** min(self.failures, 6))
            print(f"[relay] send failed ({err}); retrying in {int(self.backoff_until - now)} s", flush=True)
            return []
        self.failures, self.last_ok = 0, now
        if reply.get("ok"):
            self.queue = self.queue[len(batch):]
            self._save()
        return [c.get("cmd") for c in reply.get("cmds", []) if isinstance(c, dict) and c.get("cmd")]
