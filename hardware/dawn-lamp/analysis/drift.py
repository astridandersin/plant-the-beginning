"""Inject a slow 'slipping mornings' drift into REAL control-group days and see how
fast each rule notices, and how often it false-alarms with no drift."""
import glob, os, statistics as st, sys, random
sys.path.insert(0, os.path.dirname(__file__))
from rhythm import load, onset, NOWEAR

ROOT = sys.argv[1]
people = []
for f in glob.glob(os.path.join(ROOT, "control", "*.csv")) + glob.glob(os.path.join(ROOT, "condition", "*.csv")):
    days = load(f)
    people.append((os.path.basename(f), [(k.weekday() >= 5, onset(d)) for k, d in days]))

def current(ons, base_days=7, margin=60, flag=5):
    """The rule in the lamp today: consecutive late days vs one baseline."""
    base = st.median([o for _, o in ons[:base_days] if isinstance(o, int)])
    run = 0
    for i, (_, o) in enumerate(ons):
        if o == NOWEAR or i < base_days: continue
        run = run + 1 if (o is None or o > base + margin) else 0
        if run >= flag: return i
    return None

def refined(ons, base_days=7, margin=60, need=4, window=5):
    """Proposed: separate weekday/weekend baselines; flag when >= 4 of the last 5
    judged days have a 3-day rolling median more than `margin` after baseline."""
    wd = [o for we, o in ons[:base_days] if isinstance(o, int) and not we]
    we_ = [o for we, o in ons[:base_days] if isinstance(o, int) and we]
    b_wd = st.median(wd) if wd else None
    b_we = st.median(we_) if we_ else (b_wd + 90 if b_wd is not None else None)
    devs = []
    hist = []
    for i, (we, o) in enumerate(ons):
        if o == NOWEAR: continue
        base = b_we if we else b_wd
        dev = (14 * 60 - base) if o is None else o - base
        hist.append(dev)
        if i < base_days: continue
        devs.append(st.median(hist[-3:]) > margin)
        if len(devs) >= window and sum(devs[-window:]) >= need: return i
    return None

def shifted(ons, start, per_day):
    out = []
    for i, (we, o) in enumerate(ons):
        if isinstance(o, int) and i >= start: o = min(o + per_day * (i - start + 1), 16 * 60)
        out.append((we, o))
    return out

for name, rule in (("current rule (5 late days in a row)", current), ("refined (weekday/weekend baseline, 3-day median, 4 of 5)", refined)):
    for grp in ("control", "condition"):
        g = [p for p in people if p[0].startswith(grp)]
        fa = sum(rule(o) is not None for _, o in g)
        print(f"{name:58s} {grp:9s} false alarms with no drift: {fa}/{len(g)}")
    for per_day in (15, 25, 40):
        hits, delays = 0, []
        g = [p for p in people if p[0].startswith("control") and len(p[1]) >= 13]
        for _, o in g:
            d = rule(shifted(o, 7, per_day))
            if d is not None: hits += 1; delays.append(d - 7 + 1)
        print(f"{'':58s} drift +{per_day} min/day from day 8: caught {hits}/{len(g)}, median {st.median(delays) if delays else '-'} days after drift began")
