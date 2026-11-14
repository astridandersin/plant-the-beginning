"""
Runs the lamp's brain on a laptop with simulated people, no hardware needed.

  python3 sim.py                       print the day summaries of a 21-day simulation
  python3 sim.py --demo-out FILE.json  save three people as the clinic view's demo data
  python3 sim.py --post                send Maija's events to the relay (needs RELAY_URL and DEVICE_TOKEN)

The people are invented. Their mornings use the noise measured in real wristband data
(Depresjon: getting-up time varies by about 1-2 h day to day; healthy people get up
~1.7 h later at weekends). Each person also responds a little differently to the
lamp's three gentle responses, so the learning loop has something real to find.
Everything goes through the same dawn_core.Brain the lamp runs.

  maija  steady for two weeks, then her mornings become irregular (some very late,
         some very early, one with no activity), her mood drops and check-ins stop.
         Her mornings are steadier on days with the long wake cue.
  antti  steady; the plant reminder suits him best.
  leena  steady with weekend lie-ins, away for a weekend (held the knob 3 s).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from dawn_core import Brain, Config, Sense, day_key, is_weekend  # noqa: E402

DAYS = 21
SLIP_FROM = 14

PEOPLE = {
    "maija": {"name": "Maija (simulated)", "seed": 7, "wake": 7 * 60 + 15, "noise": 45, "weekend": 45,
              "helps": {"long": 0.35, "short": 1.3, "plant": 1.0}, "profile": "slipping", "away": []},
    "antti": {"name": "Antti (simulated)", "seed": 3, "wake": 6 * 60 + 50, "noise": 45, "weekend": 60,
              "helps": {"long": 1.0, "short": 1.3, "plant": 0.4}, "profile": "steady", "away": []},
    "leena": {"name": "Leena (simulated)", "seed": 11, "wake": 7 * 60 + 40, "noise": 45, "weekend": 90,
              "helps": {"long": 1.0, "short": 0.5, "plant": 1.1}, "profile": "steady", "away": [9, 10]},
}


def plan_day(p: dict, day: int, key: str, arm: str, rng: random.Random) -> dict:
    # a response that suits the person makes the morning steadier (less noise) and the mood a bit better
    factor = p["helps"].get(arm, 1.0)
    wake = p["wake"] + rng.gauss(0, p["noise"] * factor) + (p["weekend"] if is_weekend(key) else 0)
    mood = rng.choice([4, 4, 5]) if factor < 0.8 else rng.choice([3, 3, 4]) if factor > 1.1 else rng.choice([3, 4, 4])
    checkin, water = rng.random() > 0.08, day % 3 == 1
    if p["profile"] == "slipping" and day >= SLIP_FROM:
        k = day - SLIP_FROM
        swing = [150, -110, 190, None, -140, 210, 170][k % 7]    # irregular: late, early, very late, nothing...
        wake = None if swing is None else p["wake"] + swing + rng.gauss(0, 15)
        mood = rng.choice([1, 2, 2]) if k < 4 else 1
        checkin, water = k < 4 and swing is not None, False
    return {"wake": None if wake is None else int(wake), "mood": mood, "checkin": checkin, "water": water,
            "away": day in p["away"]}


def simulate(start: datetime, days: int, person: dict) -> list[dict]:
    rng = random.Random(person["seed"])
    brain = Brain(Config(wake="07:30", seed=person["seed"]))
    events: list[dict] = []
    soil_raw, knob = 1700.0, 0
    t, end = start, start + timedelta(days=days)
    plan_key, plan = None, None
    away_now = False
    while t < end:
        key = day_key(t)
        m = t.hour * 60 + t.minute
        if key != plan_key and t.hour >= 5:
            plan_key = key
            arm = brain._today(t).get("arm") or "long"
            plan = plan_day(person, (t - start).days, key, arm, rng)
        temp = 20.5 + (1.5 if 8 <= t.hour < 22 else 0) + rng.uniform(-0.2, 0.2)
        soil_raw = min(3000, soil_raw + 0.15)
        # camera: dark at night, daylight once the curtains open ~20 min after getting up (short winter days)
        up = plan and plan["wake"] is not None and m >= plan["wake"] + 20 and 9 * 60 <= m < 15 * 60 + 30
        light = 55 + rng.uniform(-5, 5) if up and not plan["away"] else 4 + rng.uniform(0, 3)
        motion = 0.0
        if plan and plan["wake"] is not None and not plan["away"] and plan["wake"] <= m < plan["wake"] + 25 and m % 2 == 0:
            motion = 12.0
        s = Sense(knob=knob, temp=round(temp, 1), hum=round(38 + rng.uniform(-1.5, 1.5), 1), soil_raw=int(soil_raw),
                  light=round(light, 1), cam_motion=motion)

        def checkin(sel_steps: int) -> None:
            nonlocal knob
            # green opens the picker on 3 ...
            events.extend(brain.step(t, Sense(knob=knob, pressed=True, temp=s.temp, hum=s.hum, soil_raw=s.soil_raw)))
            events.extend(brain.step(t + timedelta(milliseconds=300), Sense(knob=knob, temp=s.temp, hum=s.hum, soil_raw=s.soil_raw)))
            # ... + / - choose, green again saves
            for i in range(abs(sel_steps)):
                knob += 1 if sel_steps > 0 else -1
                events.extend(brain.step(t + timedelta(seconds=1 + i), Sense(knob=knob, temp=s.temp, hum=s.hum, soil_raw=s.soil_raw)))
            events.extend(brain.step(t + timedelta(seconds=6), Sense(knob=knob, pressed=True, temp=s.temp)))
            events.extend(brain.step(t + timedelta(seconds=7), Sense(knob=knob, pressed=False, temp=s.temp)))

        if plan:
            if plan["away"] != away_now and m == 9 * 60:        # hold the knob 3 s to say away / back
                events.extend(brain.step(t, Sense(knob=knob, pressed=True)))
                events.extend(brain.step(t + timedelta(seconds=4), Sense(knob=knob, pressed=True)))
                events.extend(brain.step(t + timedelta(seconds=5), Sense(knob=knob, pressed=False)))
                away_now = plan["away"]
            if not plan["away"] and plan["checkin"] and plan["wake"] is not None and m == plan["wake"] + 10:
                checkin(plan["mood"] - 3)
            if not plan["away"] and plan["water"] and plan["wake"] is not None and m == plan["wake"] + 30:
                soil_raw = 1350
        events.extend(brain.step(t, s))
        t += timedelta(minutes=1)
    return events


def trimmed(events: list[dict], last_day: str) -> list[dict]:
    """What the clinic needs: everything except routine readings, plus the last day's readings."""
    return [e for e in events if e["type"] != "reading" or e.get("day") == last_day]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo-out")
    ap.add_argument("--post", action="store_true")
    ap.add_argument("--days", type=int, default=DAYS)
    args = ap.parse_args()
    today = datetime.now().replace(hour=4, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=args.days - 1)
    last_day = day_key(start + timedelta(days=args.days - 1, hours=5))
    if args.demo_out:
        patients = [{"id": pid, "name": p["name"], "events": trimmed(simulate(start, args.days, p), last_day)} for pid, p in PEOPLE.items()]
        with open(args.demo_out, "w") as f:
            json.dump({"generated": datetime.now().isoformat(timespec="minutes"),
                       "note": "Invented people, generated by hardware/dawn-lamp/app/python/sim.py through the lamp's real logic.",
                       "patients": patients}, f, separators=(",", ":"))
        print(f"wrote {sum(len(p['events']) for p in patients)} events for {len(patients)} people to {args.demo_out}")
        return
    events = trimmed(simulate(start, args.days, PEOPLE["maija"]), last_day)
    if args.post:
        from relay_client import Relay
        url, token = os.environ.get("RELAY_URL"), os.environ.get("DEVICE_TOKEN")
        if not url or not token:
            sys.exit("Set RELAY_URL and DEVICE_TOKEN first.")
        relay = Relay(url, token)
        relay.add(events)
        while relay.queue:
            relay.sync()
        print(f"posted {len(events)} events")
        return
    for e in events:
        if e["type"] in ("day", "away") or (e["type"] == "first_activity" and e["day"] == last_day):
            print(json.dumps(e))


if __name__ == "__main__":
    main()
