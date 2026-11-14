"""Quick checks for dawn_core. Run: python3 test_core.py"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from dawn_core import Brain, Config, Sense, arm_summary, day_key, minute_of_day  # noqa: E402

T0 = datetime(2026, 11, 11, 8, 0)   # a Wednesday
fails = 0


def check(name, cond):
    global fails
    print(("PASS " if cond else "FAIL ") + name)
    fails += 0 if cond else 1


def checkin(b, t, k, steps=0):
    """Press green to open the picker, step `steps`, press green again. Returns (events, knob)."""
    ev = []
    ev += b.step(t, Sense(knob=k, pressed=True))
    ev += b.step(t + timedelta(milliseconds=200), Sense(knob=k, pressed=False))
    for i in range(abs(steps)):
        k += 1 if steps > 0 else -1
        ev += b.step(t + timedelta(seconds=1 + i), Sense(knob=k))
    ev += b.step(t + timedelta(seconds=6), Sense(knob=k, pressed=True))
    ev += b.step(t + timedelta(seconds=7), Sense(knob=k, pressed=False))
    return ev, k


# day boundary at 04:00
check("02:00 belongs to the previous day", day_key(datetime(2026, 11, 14, 2, 0)) == "2026-11-13")
check("02:00 counts as minute 26*60", minute_of_day(datetime(2026, 11, 14, 2, 0)) == 26 * 60)

# mood picker: green opens it on 3, two steps up = 5, green again confirms
b = Brain(Config(seed=1))
b.step(T0, Sense(knob=10))
ev, _ = checkin(b, T0, 10, steps=2)
check("first touch logs first activity", any(e["type"] == "first_activity" and e["source"] == "knob" for e in ev))
ci = [e for e in ev if e["type"] == "checkin"]
check("press and release confirms mood 5", ci and ci[0]["mood"] == 5)
check("matrix string is 104 digits", len(b.scene.matrix_string()) == 104 and set(b.scene.matrix_string()) <= set("01234567"))
check("strip respects the brightness cap", max(b.scene.strip) <= 255 * Config().strip_max + 1)

# picker times out without an event
b = Brain(Config(seed=1))
b.step(T0, Sense(knob=0)); b.step(T0, Sense(knob=0, pressed=True)); b.step(T0, Sense(knob=0))
ev = b.step(T0 + timedelta(seconds=30), Sense(knob=0))
check("picker closes after 20 s with no check-in", b._ui is None and not any(e["type"] == "checkin" for e in ev))

# away: hold 3 s toggles, no check-in
b = Brain(Config(seed=1))
b.step(T0, Sense(knob=0))
ev = b.step(T0 + timedelta(seconds=1), Sense(knob=0, pressed=True))
ev += b.step(T0 + timedelta(seconds=5), Sense(knob=0, pressed=True))
ev += b.step(T0 + timedelta(seconds=6), Sense(knob=0, pressed=False))
check("holding 3 s turns away on", b.away and any(e["type"] == "away" and e["on"] == 1 for e in ev))
check("holding doesn't record a check-in", not any(e["type"] == "checkin" for e in ev))

# watering: a big jump in moisture
b = Brain(Config(seed=1))
t = T0
for i in range(5):
    b.step(t, Sense(soil_raw=2800)); t += timedelta(minutes=1)
evs = []
for i in range(6):
    evs += b.step(t, Sense(soil_raw=1400)); t += timedelta(minutes=1)
check("watering detected once", sum(e["type"] == "watering" for e in evs) == 1)

# camera: daylight after a dark night, movement as first activity
b = Brain(Config(seed=1))
day = datetime(2026, 11, 11, 5, 0)
evs = []
for m in range(0, 240, 5):
    t = day + timedelta(minutes=m)
    light = 5 if t.hour < 8 else 60
    evs += b.step(t, Sense(light=light, cam_motion=12 if t.hour == 7 and t.minute < 20 else 0))
check("camera movement is first activity", any(e["type"] == "first_activity" and e["source"] == "camera" for e in evs))
check("daylight event when the room gets bright", any(e["type"] == "daylight" for e in evs))


def run_days(b, wakes, start=datetime(2026, 11, 2, 5, 0)):   # starts on a Monday
    events, k = [], 0
    for d, wake in enumerate(wakes):
        day = start + timedelta(days=d)
        events += b.step(day, Sense(knob=k))
        if wake is not None:
            w = day.replace(hour=wake // 60, minute=wake % 60)
            ev, k = checkin(b, w, k)
            events += ev
        events += b.step(day + timedelta(hours=10), Sense(knob=k))
    events += b.step(start + timedelta(days=len(wakes)), Sense(knob=k))
    return events


# rhythm: steady weekday mornings, weekends 90 minutes later -> no alarm
steady = [7 * 60 + 10 if (d % 7) < 5 else 8 * 60 + 40 for d in range(21)]
days = [e for e in run_days(Brain(Config(seed=1)), steady) if e["type"] == "day"]
check("weekend lie-ins don't raise anything", all(e["level"] == 0 for e in days))

# late slip: 5+ late days in a row -> check in
slip = [7 * 60 + 10] * 7 + [9 * 60 + 40] * 6
days = [e for e in run_days(Brain(Config(seed=1)), slip) if e["type"] == "day"]
check("5 late mornings in a row raise 'check in'", any(e["flag"] == 1 and e["level"] == 2 for e in days))
check("no level in the baseline week", all(e["level"] == 0 for e in days[:7]))

# early waking counts too
early = [7 * 60 + 30] * 7 + [5 * 60 + 10] * 6
days = [e for e in run_days(Brain(Config(seed=1)), early) if e["type"] == "day"]
check("5 very early mornings also raise 'check in'", any(e["flag"] == 1 and e["direction"] == "earlier" for e in days))

# missing data is not a late day
b = Brain(Config(seed=1))
start = datetime(2026, 11, 2, 5, 0)
k = 0
for d in range(7):
    day = start + timedelta(days=d)
    b.step(day, Sense(knob=k))
    ev, k = checkin(b, day.replace(hour=7, minute=10), k)
# three days with the lamp unplugged (no steps), then back on
b.step(start + timedelta(days=10), Sense(knob=k))
check("days the lamp was off are not late", b.rhythm(start + timedelta(days=10, hours=1))["late_run"] == 0)

# learning: rewards move the estimates, and Thompson sampling explores every response
b = Brain(Config(seed=3))
for name, r in (("long", 0.9), ("short", 0.2), ("plant", 0.5)):
    for _ in range(14):
        a_, b_ = b.arm_stats[name]
        b.arm_stats[name] = [a_ + r, b_ + 1 - r]
s = arm_summary(b.arm_stats)
check("the best response is the one with the best days", s["best"] == "long")
check("a clear winner after enough days", s["clear"])
check("no clear winner at the start", not arm_summary(Brain(Config()).arm_stats)["clear"])
picks = set()
b2 = Brain(Config(seed=5))
for d in range(15):
    t = datetime(2026, 11, 2, 5, 0) + timedelta(days=d)
    b2.step(t, Sense())
    picks.add(b2._today(t)["arm"])
check("with no data yet it tries every response", picks == {"long", "short", "plant"})

# remote demo dawn
b = Brain(Config(seed=1))
ev = b.command(T0, "scene_dawn")
b.step(T0 + timedelta(seconds=10), Sense())
check("remote dawn starts and lights the strip", any(e["type"] == "dawn" for e in ev) and sum(b.scene.strip) > 0)

# rising-sun colours and the lasting glow
from dawn_core import MOOD_COLOURS  # noqa: E402
check("no mood colour is mostly blue", all(b_ <= max(r, g) for r, g, b_, w in MOOD_COLOURS.values()))
check("brighter colours for better moods", all(sum(MOOD_COLOURS[i]) < sum(MOOD_COLOURS[i + 1]) for i in range(1, 5)))
b = Brain(Config(seed=1))
b.step(T0, Sense(knob=0))
_, k = checkin(b, T0, 0, steps=1)
b.step(T0 + timedelta(minutes=5), Sense(knob=k))
check("after a check-in the lamp keeps glowing in that mood's colour", b.glow_mood == 4 and sum(b.scene.strip) > 0)
glow_soft = sum(b.scene.strip)
ev = []
for i in range(3):          # minus three times: soft -> dim -> off -> (already off)
    k -= 1; ev += b.step(T0 + timedelta(minutes=6, seconds=i), Sense(knob=k))
b.step(T0 + timedelta(minutes=7), Sense(knob=k))
check("minus with the picker closed dims the lamp to off", b.light == 0 and sum(b.scene.strip) == 0 and b._ui is None)
check("dimming doesn't record a check-in", not any(e["type"] == "checkin" for e in ev))
for i in range(3):
    k += 1; b.step(T0 + timedelta(minutes=8, seconds=i), Sense(knob=k))
b.step(T0 + timedelta(minutes=9), Sense(knob=k))
check("plus turns it back up, brighter than soft", b.light == 3 and sum(b.scene.strip) > glow_soft)
b.step(datetime(2026, 11, 11, 22, 30), Sense(knob=k))
check("at bedtime a bright glow drops to dim by itself", b.light == 1)

print("\nall passed" if not fails else f"\n{fails} failed")
sys.exit(1 if fails else 0)
