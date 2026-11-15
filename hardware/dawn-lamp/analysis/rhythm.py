"""Test New beginning's 'slipping mornings' rule on the Depresjon actigraphy dataset."""
import csv, glob, os, statistics as st, sys
from collections import defaultdict
from datetime import datetime, timedelta

ROOT = sys.argv[1]

def load(path):
    days = defaultdict(lambda: [0] * 1440)
    for row in csv.DictReader(open(path)):
        t = datetime.strptime(row["timestamp"], "%Y-%m-%d %H:%M:%S")
        d = (t - timedelta(hours=4)).date()        # day starts 04:00
        m = (t.hour * 60 + t.minute - 240) % 1440   # minutes since 04:00
        days[d][m] = int(row["activity"])
    keys = sorted(days)
    return [(k, days[k]) for k in keys[1:-1]]       # drop partial first/last days

NOWEAR = "nowear"
def onset(series, thr=100, win=30, need=20):
    """'Got up': first 30-min window after 04:00 with >=20 active minutes.
    A day with almost no activity at all is treated as 'wristband not worn' (missing)."""
    if sum(1 for v in series if v > thr) < 60:
        return NOWEAR
    for i in range(0, 1440 - win):
        if sum(1 for v in series[i:i + win] if v > thr) >= need:
            return 240 + i
    return None

def rule(onsets, margin=60, flag_days=5, base_days=7):
    early = [o for o in onsets[:base_days] if isinstance(o, int)]
    base = st.median(early) if early else None
    run = best = 0; flagged_day = None
    for i, o in enumerate(onsets):
        if o == NOWEAR:                    # missing data: neither late nor on time
            continue
        late = (o is None or o >= 14 * 60) or (base is not None and o > base + margin)
        if i < base_days:                  # baseline week isn't judged
            continue
        run = run + 1 if late else 0
        best = max(best, run)
        if run >= flag_days and flagged_day is None:
            flagged_day = i
    return base, best, flagged_day

def ra(days):  # relative amplitude: (M10 - L5) / (M10 + L5) on the average day
    avg = [st.mean(d[i] for _, d in days) for i in range(1440)]
    roll = lambda w: [st.mean(avg[(i + j) % 1440] for j in range(w)) for i in range(0, 1440, 10)]
    m10, l5 = max(roll(600)), min(roll(300))
    return (m10 - l5) / (m10 + l5) if m10 + l5 else 0

def is_(days):  # interdaily stability, hourly bins
    hours = [sum(d[h * 60:(h + 1) * 60]) for _, d in days for h in range(24)]
    n, mean = len(hours), st.mean(hours)
    prof = [st.mean(hours[h::24]) for h in range(24)]
    num = n * sum((p - mean) ** 2 for p in prof)
    den = 24 * sum((x - mean) ** 2 for x in hours)
    return num / den if den else 0

def auc(a, b):  # P(random condition value > random control value)
    wins = sum((x > y) + 0.5 * (x == y) for x in a for y in b)
    return wins / (len(a) * len(b))

rows = []
for grp in ("condition", "control"):
    for f in sorted(glob.glob(os.path.join(ROOT, grp, "*.csv")), key=lambda p: int(p.rsplit("_", 1)[1][:-4])):
        days = load(f)
        ons = [onset(d) for _, d in days]
        valid = [o for o in ons if isinstance(o, int)]
        wk = [o for (k, _), o in zip(days, ons) if isinstance(o, int) and k.weekday() < 5]
        we = [o for (k, _), o in zip(days, ons) if isinstance(o, int) and k.weekday() >= 5]
        base, best, flagged = rule(ons)
        base45 = rule(ons, margin=45)[1]; base90 = rule(ons, margin=90)[1]
        rows.append(dict(id=os.path.basename(f)[:-4], grp=grp, n=len(days), mean=st.mean(valid) if valid else None,
                         sd=st.pstdev(valid) if len(valid) > 1 else None, none=sum(o is None for o in ons), nowear=sum(o == NOWEAR for o in ons),
                         wkend=(st.mean(we) - st.mean(wk)) if we and wk else None,
                         best=best, flag=flagged is not None, judged=max(0, len(days) - 7),
                         ra=ra(days), is_=is_(days), best45=base45, best90=base90))

def summ(key, grp):
    v = [r[key] for r in rows if r["grp"] == grp and r[key] is not None]
    return st.mean(v), st.median(v), len(v)

hm = lambda m: f"{int(m)//60:02d}:{int(m)%60:02d}"
print(f"participants: {sum(r['grp']=='condition' for r in rows)} depression, {sum(r['grp']=='control' for r in rows)} control; days per person median {st.median(r['n'] for r in rows)}")
for key, label in [("mean", "mean getting-up time"), ("sd", "day-to-day SD of getting-up time (min)"), ("wkend", "weekend minus weekday (min)"), ("ra", "relative amplitude"), ("is_", "interdaily stability"), ("none", "worn days with no clear getting-up"), ("nowear", "days not worn")]:
    c, k = summ(key, "condition"), summ(key, "control")
    fmt = (lambda x: hm(x)) if key == "mean" else (lambda x: f"{x:.2f}" if key in ("ra", "is_") else f"{x:.0f}")
    a = auc([r[key] for r in rows if r['grp']=='condition' and r[key] is not None], [r[key] for r in rows if r['grp']=='control' and r[key] is not None])
    print(f"{label:42s} depression mean {fmt(c[0])} (median {fmt(c[1])})  control mean {fmt(k[0])} (median {fmt(k[1])})  AUC dep>ctrl {a:.2f}")
for grp in ("condition", "control"):
    g = [r for r in rows if r["grp"] == grp]
    judged = [r for r in g if r["judged"] >= 5]
    print(f"{grp:9s}: judgeable (>=5 days after the baseline week) {len(judged)}/{len(g)}; flagged by the rule {sum(r['flag'] for r in judged)}; "
          f"longest late run median {st.median(r['best'] for r in judged) if judged else '-'}; any 2+ late run {sum(r['best']>=2 for r in judged)}; "
          f"any 3+ {sum(r['best']>=3 for r in judged)}")
    print(f"           margin 45 min: 3+ runs {sum(r['best45']>=3 for r in judged)}, 5+ {sum(r['best45']>=5 for r in judged)}; margin 90 min: 3+ {sum(r['best90']>=3 for r in judged)}, 5+ {sum(r['best90']>=5 for r in judged)}")
