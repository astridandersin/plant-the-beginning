"""Feed real Depresjon getting-up times into the lamp's actual brain (dawn_core.Brain)."""
import glob, os, sys, statistics as st
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(__file__))
from rhythm import load, onset, NOWEAR
sys.path.insert(0, sys.argv[2])
from dawn_core import Brain, Config, Sense

def run(ons_by_day, drift=0, drift_from=7):
    b = Brain(Config(seed=1, learn=False))
    k = 0
    levels = []
    for i, (d, o) in enumerate(ons_by_day):
        day = datetime(d.year, d.month, d.day, 4, 30)
        if o == NOWEAR:
            continue                                   # wristband off = lamp unplugged
        b.step(day, Sense(knob=k))
        if o is not None:
            o = min(o + (drift * (i - drift_from + 1) if i >= drift_from else 0), 15 * 60)
            t = datetime(d.year, d.month, d.day) + timedelta(minutes=o)
            k += 1; b.step(t, Sense(knob=k)); b.step(t + timedelta(seconds=5), Sense(knob=k, pressed=True)); b.step(t + timedelta(seconds=6), Sense(knob=k))
        ev = b.step(datetime(d.year, d.month, d.day, 15, 0), Sense(knob=k))
        r = b.rhythm(datetime(d.year, d.month, d.day, 15, 0))
        levels.append(r["level"])
    return levels

people = []
for grp in ("control", "condition"):
    for f in glob.glob(os.path.join(sys.argv[1], grp, "*.csv")):
        days = load(f)
        people.append((grp, [(k, onset(d)) for k, d in days]))
for grp in ("control", "condition"):
    g = [p for p in people if p[0] == grp]
    lv = [run(o) for _, o in g]
    print(f"{grp:9s} no drift: 'watch' at any point {sum(1 in l for l in lv)}/{len(g)}, 'check in' {sum(2 in l for l in lv)}/{len(g)}")
g = [p for p in people if p[0] == "control" and len(p[1]) >= 13]
for drift in (15, 25, 40):
    lv = [run(o, drift) for _, o in g]
    first = []
    for l in lv:
        hit = next((i for i, x in enumerate(l) if x >= 1), None)
        if hit is not None: first.append(hit)
    print(f"drift +{drift} min/day: 'watch' or 'check in' {sum(any(x>=1 for x in l) for l in lv)}/{len(g)}, 'check in' {sum(2 in l for l in lv)}/{len(g)}")
