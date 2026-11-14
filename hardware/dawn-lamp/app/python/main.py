"""
Plant the beginning (Dawn lamp): the UNO Q's Linux side. Run by Arduino App Lab.

Every 0.2 s it asks the sketch for a reading (knob, button, room, soil, distance),
feeds it to the brain (dawn_core.Brain), draws what the brain wants on the LED
matrix / light strip / buzzer, and queues the brain's events for the clinic.
Every few seconds it sends queued events to the website relay and runs any
commands that came back (play the dawn cue, a check-in from the web).

Settings: config.json next to this file. The device token is NOT in the repo:
put it in the DEVICE_TOKEN environment variable, or in a file named
device_token.txt next to this file (git-ignored).
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from arduino.app_utils import App, Bridge

from dawn_core import FIRMWARE, Brain, Config, Sense
from relay_client import Relay
from camera import LightMotionCamera

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("NB_DATA_DIR", HERE)          # where state and the offline queue live


def load_json(path: str, default: dict) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


settings = load_json(os.path.join(HERE, "config.json"), {})
TZ = ZoneInfo(settings.get("timezone", "Europe/Helsinki"))
cfg = Config(**{k: v for k, v in settings.get("lamp", {}).items() if k in Config.__dataclass_fields__})

token = os.environ.get("DEVICE_TOKEN")
if not token:
    try:
        with open(os.path.join(HERE, "device_token.txt")) as f:
            token = f.read().strip() or None
    except OSError:
        token = None

STATE_FILE = os.path.join(DATA, "state.json")
brain = Brain(cfg, load_json(STATE_FILE, {}))
relay = Relay(settings.get("relay_url", "https://www.astridandersin.com/api/junction2026/relay"), token,
              channel=settings.get("channel", "dawn"), spool=os.path.join(DATA, "outbox.jsonl"))

camera = LightMotionCamera(index=int(settings.get("camera_index", 0))) if settings.get("camera") else None
if camera is not None and not camera.available:
    print("[lamp] camera is on in config.json but OpenCV isn't installed; running without it", flush=True)
    camera = None

timing = {"last_sync": 0.0, "last_status": 0.0, "last_save": 0.0, "last_print": 0.0, "modules": ""}
SHOW_READINGS_S = float(settings.get("console_readings_s", 10))   # 0 = don't print raw readings
shown = {"matrix": None, "strip": None}


def now() -> datetime:
    return datetime.now(TZ).replace(tzinfo=None)


def parse_sense(text: str) -> tuple[Sense, str]:
    vals = dict(part.split("=", 1) for part in str(text).split(";") if "=" in part)
    num = lambda k, f=float: f(vals[k]) if k in vals and vals[k] not in ("", "nan") else None
    s = Sense(knob=num("k", int), pressed=vals.get("p") == "1", temp=num("t"), hum=num("h"),
              soil_raw=num("s", int), distance_mm=num("d", int), light=num("l"))
    return s, vals.get("m", "")


def show(scene) -> None:
    m = scene.matrix_string()
    if m != shown["matrix"]:
        Bridge.call("draw", bytes(int(c) for c in m), timeout=2)
        shown["matrix"] = m
    if scene.strip != shown["strip"]:
        Bridge.call("strip", *[int(v) for v in scene.strip], timeout=2)
        shown["strip"] = scene.strip
    for hz, ms in scene.sounds[:4]:
        Bridge.call("beep", int(hz), int(ms), timeout=2)
        time.sleep(ms / 1000 + 0.03)
    scene.sounds.clear()


def log_events(events: list[dict]) -> None:
    """Everything except the 10-minute readings goes to the console, for checking the wiring."""
    for e in events:
        if e.get("type") != "reading":
            detail = " ".join(f"{k}={v}" for k, v in e.items() if k not in ("type", "day", "at"))
            print(f"[lamp] {e.get('at', '')} {e['type']} {detail}", flush=True)


def loop() -> None:
    t0 = time.monotonic()
    try:
        raw = Bridge.call("sense", timeout=2)
        sense, modules = parse_sense(raw)
    except Exception as err:   # sketch restarting or not flashed yet
        print(f"[lamp] no reading from the sketch: {err}", flush=True)
        time.sleep(1)
        return
    if camera is not None:            # the camera's light reading wins over the phototransistor
        light, sense.cam_motion = camera.read()
        if light is not None:
            sense.light = light
            if "camera" not in modules:
                modules += ",camera"
    n = now()
    events = brain.step(n, sense)
    log_events(events)
    relay.add(events)

    wall = time.time()
    if SHOW_READINGS_S and wall - timing["last_print"] > SHOW_READINGS_S:
        timing["last_print"] = wall
        print(f"[lamp] reading {raw}", flush=True)
    if modules != timing["modules"] or wall - timing["last_status"] > 3600:
        timing["modules"], timing["last_status"] = modules, wall
        relay.add([{"type": "status", "fw": FIRMWARE, "modules": modules, "queued": len(relay.queue)}])

    try:
        show(brain.scene)
    except Exception as err:
        print(f"[lamp] couldn't update lights: {err}", flush=True)

    if wall - timing["last_sync"] > (2 if relay.queue else 10):
        timing["last_sync"] = wall
        for cmd in relay.sync(force=True):
            print(f"[lamp] command from the web: {cmd}", flush=True)
            cmd_events = brain.command(now(), cmd)
            log_events(cmd_events)
            relay.add(cmd_events)

    if wall - timing["last_save"] > 300:
        timing["last_save"] = wall
        try:
            tmp = STATE_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(brain.state(), f)
            os.replace(tmp, STATE_FILE)
        except OSError as err:
            print(f"[lamp] couldn't save state: {err}", flush=True)

    time.sleep(max(0.0, 0.2 - (time.monotonic() - t0)))


print(f"[lamp] Plant the beginning {FIRMWARE} starting; relay {'on' if token else 'off (no DEVICE_TOKEN)'}", flush=True)
App.run(user_loop=loop)
