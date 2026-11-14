"""
Plant the beginning (Dawn lamp): the lamp's brain. Runs on the Arduino UNO Q's Linux side.

Pure logic, no hardware and no network: main.py feeds it sensor readings and the
clock, and it returns events (for the clinic) plus the scene the lights and buzzer
should show. Testable on a laptop (sim.py, test_core.py).

What it does
  * Morning mood check-in on the Knob: turn to pick a mood (1 low .. 5 great), the
    LED matrix and light show it, press to confirm. Hold the knob 3 s to say
    "I'm away" (and again to say "I'm back"): away days are never judged.
  * Plant care: soil moisture in %, a watering event when it jumps up.
  * Room: temperature and humidity (Modulino Thermo).
  * Camera (optional, USB camera on the board, frames never stored or sent): room
    brightness, so "curtains opened / daylight" and daylight minutes, plus movement.
  * Movement (optional Modulino Distance).
  * Rhythm, checked against real data (Depresjon) and the research (see
    challenges/beyond-the-clinic/outputs/17-evidence-review.md):
      - each day's first activity against the person's own baseline, kept separately
        for weekdays and weekends (healthy people sleep in ~1.7 h at weekends);
      - the baseline rolls with the seasons once there are 3 weeks of data;
      - early waking counts as much as sleeping in (deviation in either direction);
      - two levels: "watch" when the 3-day median is off by >60 min on 5 of the last
        6 days, or mornings got much more irregular; "check in" (flag) after 5 off
        days in a row. Days with no data, or marked away, are skipped, never "late".
  * Learning what helps this person (the brief's "sense, respond, learn"): each day
    the lamp picks one of three gentle responses (a long wake cue with a chime, a
    short silent one, or a short one with a plant reminder) by Thompson sampling,
    and scores the day by how steady the morning was and the mood. Over time it
    favours what's followed by steadier mornings for this person, and says "still
    learning" until the difference is clear.

The lamp flags; the clinic decides. It never diagnoses.
Events are flat dicts (numbers, short strings, booleans) so the relay accepts them.
"""
from __future__ import annotations

import math
import random
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

FIRMWARE = "nb-0.2"

DAY_START_HOUR = 4          # 00:00-03:59 still belongs to the previous day
OFF_MARGIN_MIN = 60         # a morning this far from baseline (either way) is "off"
MISSING_BY_MIN = 14 * 60    # no activity by 14:00 (and not away) = an off day
FLAG_DAYS = 5               # off days in a row -> "check in"
WATCH_NEED, WATCH_OF = 5, 6 # 3-day-median off on 5 of the last 6 days -> "watch" (tuned on Depresjon)
IRREGULAR_RATIO = 2.5       # spread of the last 7 mornings vs baseline spread -> "watch" (tuned on Depresjon)
BASELINE_DAYS = 7
ROLLING_AFTER = 21          # after this many judged days, the baseline rolls
READING_EVERY_S = 600       # room/soil/light reading every 10 minutes
AWAY_HOLD_S = 3             # hold the knob this long to toggle "away"
MOODS = {1: "low", 2: "meh", 3: "ok", 4: "good", 5: "great"}

# The lamp's gentle responses it learns between (all are kind; none withholds care).
ARMS = {
    "long": {"dawn": 25, "chime": True, "plant": False, "label": "long wake cue with a chime"},
    "short": {"dawn": 10, "chime": False, "plant": False, "label": "short, silent wake cue"},
    "plant": {"dawn": 15, "chime": True, "plant": True, "label": "wake cue and a plant reminder"},
}
PRIOR = (2.0, 2.0)          # Beta prior: "no idea yet"

MATRIX_W, MATRIX_H = 13, 8


# --------------------------------------------------------------------------- time

def day_key(now: datetime) -> str:
    return (now - timedelta(hours=DAY_START_HOUR)).date().isoformat()


def minute_of_day(now: datetime) -> int:
    """Minutes since midnight, with 00:00-03:59 counted as 24:00-27:59 of the previous day."""
    m = now.hour * 60 + now.minute
    return m + 1440 if now.hour < DAY_START_HOUR else m


def hhmm(minutes: float | None) -> str:
    if minutes is None or minutes < 0:
        return ""
    minutes = int(round(minutes))
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def parse_hhmm(text: str) -> int:
    h, m = text.split(":")
    return int(h) * 60 + int(m)


def is_weekend(key: str) -> bool:
    return date.fromisoformat(key).weekday() >= 5


# --------------------------------------------------------------------------- inputs

@dataclass
class Sense:
    """One reading. None = that sensor isn't connected."""
    knob: int | None = None          # encoder position (counts)
    pressed: bool = False            # knob button held
    temp: float | None = None        # deg C
    hum: float | None = None         # % relative humidity
    soil_raw: int | None = None      # analog reading of the soil sensor
    distance_mm: int | None = None   # Modulino Distance, if fitted
    light: float | None = None       # camera: room brightness 0-100
    cam_motion: float | None = None  # camera: movement score 0-100


@dataclass
class Config:
    wake: str = "07:30"              # wake-cue time
    reminder_after_min: int = 90     # soft chime if no check-in by wake + this
    night_from: str = "22:00"        # dim, silent
    night_to: str = "06:00"
    knob_step: int = 1               # encoder counts per mood step (check on the real knob)
    soil_dry_raw: int = 3000         # raw reading in dry air / dry soil (calibrate)
    soil_wet_raw: int = 1300         # raw reading in a glass of water (calibrate)
    soil_dry_pct: int = 25           # below this the plant asks for water
    watering_jump_pct: int = 15      # rise within 15 min that counts as watering
    motion_mm: int = 120             # distance change between samples that counts as movement
    cam_motion_min: float = 6.0      # camera movement score that counts as movement
    daylight_pct: float = 35.0       # camera brightness that counts as daylight in the room
    strip_max: float = 0.3           # cap LED strip brightness (power budget)
    learn: bool = True               # vary the response and learn; False = always "long"
    seed: int | None = None          # for repeatable simulations


# --------------------------------------------------------------------------- matrix art

def _art(rows: list[str]) -> list[list[int]]:
    rows = [r.ljust(MATRIX_W)[:MATRIX_W] for r in rows] + [" " * MATRIX_W] * (MATRIX_H - len(rows))
    return [[1 if c == "#" else 0 for c in r] for r in rows[:MATRIX_H]]

GLYPHS = {
    1: _art(["             ", "   #     #   ", "   #     #   ", "             ", "             ", "    #####    ", "   #     #   ", "             "]),
    2: _art(["             ", "   #     #   ", "   #     #   ", "             ", "             ", "     ####    ", "   ##        ", "             "]),
    3: _art(["             ", "   #     #   ", "   #     #   ", "             ", "             ", "   #######   ", "             ", "             "]),
    4: _art(["             ", "   #     #   ", "   #     #   ", "             ", "   #     #   ", "    #####    ", "             ", "             "]),
    5: _art(["             ", "   ##   ##   ", "   ##   ##   ", "             ", "  #       #  ", "   #######   ", "    #####    ", "             "]),
    "drop": _art(["      #      ", "     ###     ", "    #####    ", "   #######   ", "   #######   ", "    #####    ", "     ###     ", "             "]),
    "leaf": _art(["        ###  ", "      #####  ", "     ######  ", "    ######   ", "   #####     ", "   ###       ", "  #          ", " #           "]),
    "ask": _art(["    #####    ", "   #     #   ", "        #    ", "      ##     ", "      #      ", "             ", "      #      ", "             "]),
    "thanks": _art(["             ", "          #  ", "         #   ", "        #    ", "  #    #     ", "   #  #      ", "    ##       ", "             "]),
    "away": _art(["             ", "  #########  ", "  #       #  ", "  # #   # #  ", "  #  # #  #  ", "  #   #   #  ", "  #########  ", "             "]),
}


def sunrise_frame(level: float) -> list[list[float]]:
    """A sun rising from the bottom edge; level 0..1."""
    cx, cy = 6.0, 7.5 + 3.0 - 6.5 * level
    out = []
    for y in range(MATRIX_H):
        row = []
        for x in range(MATRIX_W):
            d = ((x - cx) ** 2 + ((y - cy) * 1.2) ** 2) ** 0.5
            sun = max(0.0, 1.0 - d / 4.2)
            sky = 0.15 * level * (y / (MATRIX_H - 1))
            row.append(min(1.0, sun * (0.3 + 0.7 * level) + sky))
        out.append(row)
    return out


# --------------------------------------------------------------------------- outputs

@dataclass
class Scene:
    matrix: list[list[float]] = field(default_factory=lambda: [[0.0] * MATRIX_W for _ in range(MATRIX_H)])
    strip: tuple[int, int, int, int] = (0, 0, 0, 0)    # r, g, b, w, already brightness-capped
    sounds: list[tuple[int, int]] = field(default_factory=list)  # (Hz, ms) to play once

    def matrix_string(self) -> str:
        """104 characters '0'-'7', row by row: the format the sketch draws."""
        return "".join(str(max(0, min(7, round(v * 7)))) for row in self.matrix for v in row)


# "The sun rising": one warm family, dimmer and deeper for low moods, brighter and more
# golden for good ones. No mood gets a "sad" colour, and nothing blue glows at night.
MOOD_COLOURS = {1: (110, 22, 0, 0),        # dim ember
                2: (190, 70, 10, 15),      # soft peach
                3: (200, 115, 35, 70),     # warm white
                4: (255, 150, 20, 90),     # golden
                5: (255, 200, 60, 160)}    # bright, sunny
LIGHT_STEPS = (0.0, 0.25, 0.55, 1.0)       # lamp glow between check-ins: off, dim, soft, bright


def dawn_colour(level: float, cap: float) -> tuple[int, int, int, int]:
    """Deep red -> amber -> warm white as the sun rises."""
    r = 255 * min(1.0, 0.3 + level)
    g = 160 * max(0.0, level - 0.15)
    b = 30 * max(0.0, level - 0.6)
    w = 255 * max(0.0, level - 0.5) * 2
    s = cap * (0.15 + 0.85 * level)
    return (int(r * s), int(g * s), int(b * s), int(min(255, w) * s))


def _blank() -> list[list[float]]:
    return [[0.0] * MATRIX_W for _ in range(MATRIX_H)]


def _scaled(glyph: list[list[int]], level: float) -> list[list[float]]:
    return [[v * level for v in row] for row in glyph]


# --------------------------------------------------------------------------- learning

def arm_summary(stats: dict) -> dict:
    """Mean and an ~80 % interval for each response, and whether one clearly leads."""
    out = {}
    for name, (a, b) in stats.items():
        n = a + b - sum(PRIOR)
        mean = a / (a + b)
        half = 1.28 * math.sqrt(mean * (1 - mean) / (a + b + 1))
        out[name] = {"mean": round(mean, 2), "lo": round(max(0, mean - half), 2), "hi": round(min(1, mean + half), 2), "days": round(n, 1)}
    best = max(out, key=lambda k: out[k]["mean"])
    clear = all(out[best]["lo"] > out[k]["hi"] for k in out if k != best)
    return {"arms": out, "best": best, "clear": clear}


# --------------------------------------------------------------------------- the brain

class Brain:
    def __init__(self, cfg: Config | None = None, state: dict | None = None):
        self.cfg = cfg or Config()
        st = state or {}
        self.days: dict[str, dict] = st.get("days", {})       # per-day record
        self.arm_stats: dict[str, list[float]] = st.get("arm_stats") or {k: list(PRIOR) for k in ARMS}
        self.away: bool = st.get("away", False)
        self.rng = random.Random(self.cfg.seed)
        self.events: list[dict] = []
        self.scene = Scene()
        self._day: str | None = None
        self._ui: dict | None = None
        self._thanks_until: datetime | None = None
        self._last_knob: int | None = None
        self._last_pressed = False
        self._press_start: datetime | None = None
        self._hold_done = False
        self._dawn: dict | None = None
        self._dawn_done_day: str | None = None
        self._reminded_day: str | None = None
        self._plant_prompt_until: datetime | None = None
        self._soil_pct: float | None = None
        self._soil_window: list[tuple[datetime, float]] = []
        self._water_cooldown: datetime | None = None
        self._acc = {"temp": [], "hum": [], "soil": [], "light": [], "motion": 0}
        self._last_reading: datetime | None = None
        self._last_distance: int | None = None
        self._motion_minutes: set[tuple[str, int]] = set()
        self._dark_seen_day: str | None = None
        self.glow_mood: int = st.get("glow_mood", 0)        # last confirmed mood: the lamp glows in its colour
        self.light: int = st.get("light", 0)                # 0 off, 1 dim, 2 soft, 3 bright (index into LIGHT_STEPS)
        self._night_dimmed_day: str | None = None

    # ----- persistence
    def state(self) -> dict:
        return {"days": dict(sorted(self.days.items())[-90:]), "arm_stats": self.arm_stats, "away": self.away,
                "glow_mood": self.glow_mood, "light": self.light}

    # ----- helpers
    def _rec(self, key: str) -> dict:
        return self.days.setdefault(key, {"first_min": None, "first_source": "", "mood": 0, "checkin_at": "",
                                          "watered": 0, "temp": [], "hum": [], "soil": [], "motion_min": 0,
                                          "away": 0, "arm": "", "daylight_min": 0, "curtains_at": ""})

    def _today(self, now: datetime) -> dict:
        return self._rec(day_key(now))

    def _emit(self, now: datetime, kind: str, **fields) -> None:
        ev = {"type": kind, "day": day_key(now), "at": hhmm(minute_of_day(now))}
        ev.update({k: v for k, v in fields.items() if v is not None})
        self.events.append(ev)

    def _is_night(self, now: datetime) -> bool:
        m = now.hour * 60 + now.minute
        a, b = parse_hhmm(self.cfg.night_from), parse_hhmm(self.cfg.night_to)
        return m >= a or m < b

    # ----- rhythm
    def _judgeable(self, key: str, rec: dict, today: str, now_min: int | None) -> bool:
        if rec.get("away"):
            return False
        if rec.get("first_min") is not None:
            return True
        if key != today:
            return bool(rec.get("seen"))            # the lamp was on that day and nobody showed up
        return now_min is not None and now_min >= MISSING_BY_MIN

    def baseline(self, key: str) -> float | None:
        """Median first activity for this kind of day (weekday/weekend), from the person's own past."""
        weekend = is_weekend(key)
        past = [(k, d) for k, d in sorted(self.days.items()) if k < key and not d.get("away") and d.get("first_min") is not None]
        if len(past) >= ROLLING_AFTER:
            pool = past[-28:-7]                      # roll with the seasons, lagging the last week
        else:
            pool = past[:BASELINE_DAYS] if len(past) >= BASELINE_DAYS else past
        same = [d["first_min"] for k, d in pool if is_weekend(k) == weekend]
        if len(same) >= 2:
            return statistics.median(same)
        other = [d["first_min"] for k, d in pool if is_weekend(k) != weekend]
        if len(other) >= 3:
            return statistics.median(other) + (45 if weekend else -45)   # a mild guess until there are 2 days of this kind
        return None

    def _baseline_spread(self) -> float | None:
        firsts = [d["first_min"] for _, d in sorted(self.days.items()) if d.get("first_min") is not None and not d.get("away")][:BASELINE_DAYS]
        return statistics.pstdev(firsts) if len(firsts) >= 5 else None

    def _deviation(self, key: str, rec: dict) -> float | None:
        base = self.baseline(key)
        if base is None:
            return None
        if rec.get("first_min") is None:
            return MISSING_BY_MIN - base             # nobody by 14:00: as late as it gets
        return rec["first_min"] - base

    def rhythm(self, now: datetime) -> dict:
        today, now_min = day_key(now), minute_of_day(now)
        judged = []                                   # (key, deviation), oldest first
        with_data = 0
        for key, rec in sorted(self.days.items()):
            if rec.get("first_min") is not None and not rec.get("away"):
                with_data += 1
            if with_data <= BASELINE_DAYS and key != today and rec.get("first_min") is not None:
                continue                              # the baseline week sets the pattern; it isn't judged
            if not self._judgeable(key, rec, today, now_min):
                continue
            dev = self._deviation(key, rec)
            if dev is not None:
                judged.append((key, dev))
        run = 0
        for _, dev in reversed(judged):
            if abs(dev) > OFF_MARGIN_MIN:
                run += 1
            else:
                break
        smooth_off = []
        devs = [d for _, d in judged]
        for i in range(len(devs)):
            window = devs[max(0, i - 2): i + 1]
            smooth_off.append(abs(statistics.median(window)) > OFF_MARGIN_MIN)
        watch_smooth = sum(smooth_off[-WATCH_OF:]) >= WATCH_NEED
        recent_first = [self.days[k]["first_min"] for k, _ in judged[-7:] if self.days[k].get("first_min") is not None]
        spread0 = self._baseline_spread()
        irregular = (statistics.pstdev(recent_first) / spread0) if spread0 and len(recent_first) >= 5 and spread0 > 0 else 0
        flag = int(run >= FLAG_DAYS)
        watch = int(not flag and (watch_smooth or irregular >= IRREGULAR_RATIO))
        recent = [d for _, d in sorted(self.days.items())[-7:] if not d.get("away")]
        moods = [d["mood"] for d in recent if d.get("mood")]
        direction = ""
        if judged:
            last = [d for _, d in judged[-3:]]
            direction = "later" if statistics.median(last) > 0 else "earlier"
        return {
            "baseline_at": hhmm(self.baseline(today)),
            "late_run": run,                          # off days in a row (late OR early)
            "flag": flag,
            "watch": watch,
            "level": 2 if flag else 1 if watch else 0,
            "irregular": round(irregular, 2),
            "direction": direction,
            "missed_checkins_7d": sum(1 for d in recent if not d.get("mood")),
            "mood_avg_7d": round(sum(moods) / len(moods), 1) if moods else 0,
            "watered_days_7d": sum(1 for d in recent if d.get("watered")),
        }

    def _first_activity(self, now: datetime, source: str) -> None:
        rec = self._today(now)
        if rec["first_min"] is not None or rec.get("away"):
            return
        rec["first_min"] = minute_of_day(now)
        rec["first_source"] = source
        dev = self._deviation(day_key(now), rec)
        r = self.rhythm(now)
        self._emit(now, "first_activity", source=source, dev=None if dev is None else round(dev),
                   late=int(dev is not None and abs(dev) > OFF_MARGIN_MIN), late_run=r["late_run"],
                   baseline_at=r["baseline_at"], flag=r["flag"], watch=r["watch"], level=r["level"])

    # ----- learning
    def _choose_arm(self, now: datetime) -> None:
        rec = self._today(now)
        if rec.get("arm"):
            return
        if not self.cfg.learn:
            arm = "long"
        else:
            draws = {k: self.rng.betavariate(a, b) for k, (a, b) in self.arm_stats.items()}
            arm = max(draws, key=draws.get)
        rec["arm"] = arm
        self._emit(now, "plan", arm=arm, dawn_minutes=ARMS[arm]["dawn"])

    def _reward(self, key: str, rec: dict) -> float | None:
        """How the day went, 0..1: a steady morning (and the mood, when given)."""
        if rec.get("away") or not rec.get("arm"):
            return None
        dev = self._deviation(key, rec)
        if dev is None:
            return None
        steady = max(0.0, 1.0 - max(0.0, abs(dev) - 30) / 120)
        if rec.get("mood"):
            return round(0.5 * steady + 0.5 * (rec["mood"] - 1) / 4, 3)
        return round(steady * 0.8, 3)                 # a missed check-in counts a little against the day

    def _close_day(self, key: str, now: datetime) -> None:
        rec = self.days.get(key)
        if not rec:
            return
        reward = self._reward(key, rec)
        if reward is not None and rec["arm"] in self.arm_stats:
            a, b = self.arm_stats[rec["arm"]]
            self.arm_stats[rec["arm"]] = [a + reward, b + (1 - reward)]
        rec["reward"] = reward
        dev = self._deviation(key, rec) if not rec.get("away") else None
        avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else -1
        r = self.rhythm(now)
        learned = arm_summary(self.arm_stats)
        ev = {
            "type": "day", "day": key, "at": hhmm(minute_of_day(now)),
            "first_at": hhmm(rec["first_min"]), "first_min": rec["first_min"] if rec["first_min"] is not None else -1,
            "first_source": rec["first_source"], "mood": rec["mood"], "checkin_at": rec["checkin_at"],
            "watered": rec["watered"], "temp_avg": avg(rec["temp"]), "hum_avg": avg(rec["hum"]), "soil_avg": avg(rec["soil"]),
            "motion_min": rec["motion_min"], "daylight_min": rec.get("daylight_min", 0), "curtains_at": rec.get("curtains_at", ""),
            "away": rec.get("away", 0), "dev": -9999 if dev is None else round(dev),
            "late": int(dev is not None and abs(dev) > OFF_MARGIN_MIN),
            "late_run": r["late_run"], "baseline_at": hhmm(self.baseline(key)), "flag": r["flag"], "watch": r["watch"],
            "level": r["level"], "irregular": r["irregular"], "direction": r["direction"],
            "arm": rec.get("arm", ""), "reward": -1 if reward is None else reward,
            "learn_best": learned["best"], "learn_clear": int(learned["clear"]),
        }
        for name, s in learned["arms"].items():
            ev[f"arm_{name}_mean"], ev[f"arm_{name}_lo"], ev[f"arm_{name}_hi"], ev[f"arm_{name}_days"] = s["mean"], s["lo"], s["hi"], s["days"]
        self.events.append(ev)
        rec["temp"], rec["hum"], rec["soil"] = [avg(rec["temp"])], [avg(rec["hum"])], [avg(rec["soil"])]

    # ----- sensors
    def _soil(self, now: datetime, raw: int) -> None:
        span = self.cfg.soil_dry_raw - self.cfg.soil_wet_raw
        pct = max(0.0, min(100.0, 100.0 * (self.cfg.soil_dry_raw - raw) / span)) if span else 0.0
        self._soil_pct = pct if self._soil_pct is None else 0.7 * self._soil_pct + 0.3 * pct
        self._soil_window = [(t, p) for t, p in self._soil_window if now - t <= timedelta(minutes=15)] + [(now, self._soil_pct)]
        low = min(p for _, p in self._soil_window)
        cooling = self._water_cooldown and now < self._water_cooldown
        if self._soil_pct - low >= self.cfg.watering_jump_pct and not cooling:
            self._today(now)["watered"] = 1
            self._emit(now, "watering", soil_before=round(low), soil_after=round(self._soil_pct))
            self._water_cooldown = now + timedelta(minutes=30)
            self._soil_window = [(now, self._soil_pct)]
            self._first_activity(now, "water")
        self._acc["soil"].append(self._soil_pct)

    def _moved(self, now: datetime, source: str) -> None:
        key = (day_key(now), now.hour * 60 + now.minute)
        if key not in self._motion_minutes:
            self._motion_minutes.add(key)
            self._today(now)["motion_min"] += 1
            self._acc["motion"] += 1
            if len(self._motion_minutes) > 5000:
                self._motion_minutes = {k for k in self._motion_minutes if k[0] == key[0]}
        if now.hour >= DAY_START_HOUR + 1:              # ignore 04:00-04:59 restlessness
            self._first_activity(now, source)

    def _distance(self, now: datetime, mm: int) -> None:
        if self._last_distance is not None and abs(mm - self._last_distance) >= self.cfg.motion_mm:
            self._moved(now, "movement")
        self._last_distance = mm

    def _camera(self, now: datetime, light: float | None, motion: float | None) -> None:
        rec = self._today(now)
        if light is not None:
            self._acc["light"].append(light)
            dawn_on = self._dawn is not None            # the lamp's own glow mustn't count as daylight
            if light < 15:
                self._dark_seen_day = day_key(now)
            if (not dawn_on and light >= self.cfg.daylight_pct and 5 <= now.hour < 16
                    and not rec.get("curtains_at") and self._dark_seen_day == day_key(now)):
                rec["curtains_at"] = hhmm(minute_of_day(now))
                self._emit(now, "daylight", light=round(light))
        if motion is not None and motion >= self.cfg.cam_motion_min:
            self._moved(now, "camera")

    def _knob(self, now: datetime, s: Sense) -> None:
        if s.knob is None:
            return
        moved = self._last_knob is not None and s.knob != self._last_knob
        press = s.pressed and not self._last_pressed
        release = self._last_pressed and not s.pressed
        self._last_pressed = s.pressed
        if press:
            self._press_start, self._hold_done = now, False
        if s.pressed and self._press_start and not self._hold_done and (now - self._press_start).total_seconds() >= AWAY_HOLD_S:
            self._hold_done = True
            self._toggle_away(now)
            self._ui = None
            self._last_knob = s.knob
            return
        if release and self._hold_done:
            self._last_knob = s.knob
            return
        if self.away and (moved or press):
            self._last_knob = s.knob
            return
        if self._ui is None and moved:
            # Picker closed: + / - (or turning the knob) work as a dimmer for the lamp's glow.
            self._first_activity(now, "knob")
            self._set_light(now, self.light + (1 if s.knob > self._last_knob else -1))
            self._last_knob = s.knob
            return
        if self._ui is None and press:
            self._ui = {"base": s.knob, "sel": 3, "last": now}
            self._first_activity(now, "knob")
            self._dawn = None
            self._dawn_done_day = day_key(now)
            self.scene.sounds.append((880, 30))
            moved = press = False
        if self._ui is not None:
            if moved:
                step = max(1, self.cfg.knob_step)
                steps = (s.knob - self._ui["base"]) // step
                sel = max(1, min(5, 3 + steps))
                if sel != 3 + steps:
                    # past the end: move the base so one press the other way moves straight back
                    self._ui["base"] = s.knob - (sel - 3) * step
                old = self._ui["sel"]
                # One short tone per press keeps the buttons quick (each tone pauses the loop).
                if sel > old:
                    self.scene.sounds.append((900 + 60 * sel, 20))     # up: bright, higher with each step
                elif sel < old:
                    self.scene.sounds.append((420 + 40 * sel, 20))     # down: soft, lower with each step
                else:
                    self.scene.sounds.append((260, 25))                # already at the end: low bump
                self._ui["sel"], self._ui["last"] = sel, now
            if press:
                self._ui["pressed_at"] = now
            if release and self._ui.get("pressed_at"):
                self._checkin(now, self._ui["sel"], via=None)
                self._ui = None
            elif self._ui is not None and now - self._ui["last"] > timedelta(seconds=20) and not s.pressed:
                self._ui = None
        self._last_knob = s.knob

    def _checkin(self, now: datetime, mood: int, via: str | None) -> None:
        rec = self._today(now)
        rec["mood"], rec["checkin_at"] = mood, hhmm(minute_of_day(now))
        r = self.rhythm(now)
        self._emit(now, "checkin", mood=mood, mood_word=MOODS[mood], via=via, late_run=r["late_run"],
                   flag=r["flag"], watch=r["watch"], level=r["level"])
        self.scene.sounds += [(784, 80), (1047, 120)]
        self._thanks_until = now + timedelta(seconds=2)
        self.glow_mood = mood
        if self.light < 2:                 # a check-in brings the glow back, softly
            self.light = 2
            self._emit(now, "light", brightness=self.light)

    def _set_light(self, now: datetime, level: int) -> None:
        new = max(0, min(len(LIGHT_STEPS) - 1, level))
        if new == self.light:
            self.scene.sounds.append((260, 25))                           # already off / already brightest
            return
        self.scene.sounds.append((1100, 15) if new > self.light else (520, 15))
        self.light = new
        self._emit(now, "light", brightness=new)

    def _glow(self) -> tuple[int, int, int, int]:
        """The lamp's resting light: the last mood's colour at the chosen brightness."""
        if not self.light or not self.glow_mood:
            return (0, 0, 0, 0)
        k = self.cfg.strip_max * LIGHT_STEPS[self.light]
        r, g, b, w = MOOD_COLOURS[self.glow_mood]
        return (int(r * k), int(g * k), int(b * k), int(w * k))

    def _toggle_away(self, now: datetime) -> None:
        self.away = not self.away
        rec = self._today(now)
        if self.away:
            rec["away"] = 1
        self._emit(now, "away", on=int(self.away))
        self.scene.sounds += [(523, 90), (392, 140)] if self.away else [(392, 90), (523, 140)]

    def _reading(self, now: datetime) -> None:
        if self._last_reading is None:
            # First reading one minute after start, then every 10 minutes, so a freshly
            # started lamp shows its room straight away in the clinic view.
            self._last_reading = now - timedelta(seconds=READING_EVERY_S - 60)
            return
        if self._last_reading and (now - self._last_reading).total_seconds() < READING_EVERY_S:
            return
        a = self._acc
        avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
        rec = self._today(now)
        t, h, so, li = avg(a["temp"]), avg(a["hum"]), avg(a["soil"]), avg(a["light"])
        if self._last_reading is not None and (t is not None or so is not None or li is not None):
            self._emit(now, "reading", temp=t, hum=h, soil=so, light=li, motion=a["motion"])
            if t is not None: rec["temp"].append(t)
            if h is not None: rec["hum"].append(h)
            if so is not None: rec["soil"].append(so)
            if li is not None and li >= self.cfg.daylight_pct and 6 <= now.hour < 16:
                rec["daylight_min"] = rec.get("daylight_min", 0) + READING_EVERY_S // 60
        self._acc = {"temp": [], "hum": [], "soil": [], "light": [], "motion": 0}
        self._last_reading = now

    # ----- wake cue and reminder
    def _schedule(self, now: datetime) -> None:
        key = day_key(now)
        rec = self._today(now)
        if self.away:
            return
        m = now.hour * 60 + now.minute
        wake = parse_hhmm(self.cfg.wake)
        if now.hour >= DAY_START_HOUR:
            self._choose_arm(now)
        if self._dawn is None and self._dawn_done_day != key and wake <= m < wake + 5:
            arm = ARMS.get(rec.get("arm") or "long")
            self.start_dawn(now, "schedule", arm["dawn"], chime=arm["chime"], plant=arm["plant"])
        if (not rec["mood"] and self._reminded_day != key and m >= wake + self.cfg.reminder_after_min
                and not self._is_night(now) and m < MISSING_BY_MIN):
            self._reminded_day = key
            self.scene.sounds += [(523, 120), (659, 160)]
            self._emit(now, "reminder")

    def start_dawn(self, now: datetime, trigger: str, minutes: float, chime: bool = True, plant: bool = False) -> None:
        self._dawn = {"start": now, "minutes": minutes, "trigger": trigger, "chime": chime, "plant": plant, "chimed": False}
        self._dawn_done_day = day_key(now)
        self._emit(now, "dawn", trigger=trigger, minutes=minutes, arm=self._today(now).get("arm") or "")

    # ----- lights
    def _render(self, now: datetime) -> None:
        cap = self.cfg.strip_max
        night = self._is_night(now)
        level = 0.25 if night else 1.0
        sc = self.scene
        key = day_key(now)
        if night and self.light > 1 and self._night_dimmed_day != key and now.hour >= 12:
            # Bedtime: a glow left on drops to the dimmest step once each evening.
            self._night_dimmed_day = key
            self.light = 1
            self._emit(now, "light", brightness=1, auto=1)
        if self._thanks_until and now < self._thanks_until:
            r, g, b, w = MOOD_COLOURS[self.glow_mood or 3]
            sc.matrix, sc.strip = _scaled(GLYPHS["thanks"], level), (int(r * cap), int(g * cap), int(b * cap), int(w * cap))
            return
        if self.away:
            sc.matrix, sc.strip = _scaled(GLYPHS["away"], 0.15), (0, 0, 0, 0)
            return
        if self._ui is not None:
            sel = self._ui["sel"]
            r, g, b, w = MOOD_COLOURS[sel]
            sc.matrix = _scaled(GLYPHS[sel], level)
            sc.strip = (int(r * cap), int(g * cap), int(b * cap), int(w * cap))
            return
        if self._dawn is not None:
            d = self._dawn
            p = (now - d["start"]).total_seconds() / 60 / d["minutes"]
            if p >= 1.0 and d["chime"] and not d["chimed"]:
                d["chimed"] = True
                sc.sounds += [(659, 200), (784, 260)]
                if d["plant"]:
                    self._plant_prompt_until = now + timedelta(minutes=30)
            if p >= 1.6:
                self._dawn = None
            else:
                lv = min(1.0, max(0.0, p)) if p < 1.3 else max(0.0, 1 - (p - 1.3) / 0.3)
                sc.matrix, sc.strip = sunrise_frame(lv), dawn_colour(lv, cap)
                return
        rec = self._today(now)
        m = now.hour * 60 + now.minute
        glow = self._glow()
        if self._reminded_day == key and not rec["mood"] and m < MISSING_BY_MIN:
            pulse = 0.4 + 0.3 * ((now.second % 4) / 3)
            sc.matrix, sc.strip = _scaled(GLYPHS["ask"], pulse * level), glow
            return
        if self._plant_prompt_until and now < self._plant_prompt_until:
            sc.matrix, sc.strip = _scaled(GLYPHS["leaf"], 0.5), glow
            return
        if self._soil_pct is not None and self._soil_pct < self.cfg.soil_dry_pct and not night:
            sc.matrix, sc.strip = _scaled(GLYPHS["drop"], 0.35), glow
            return
        sc.matrix, sc.strip = _blank(), glow

    # ----- main entry points
    def step(self, now: datetime, s: Sense) -> list[dict]:
        """Feed one reading. Returns new events (and leaves self.scene updated)."""
        key = day_key(now)
        if self._day is None:
            self._day = key
        elif key != self._day:
            self._close_day(self._day, now)
            self._day = key
            if self.away:
                self._today(now)["away"] = 1
        rec = self._today(now)
        rec["seen"] = 1
        if s.temp is not None: self._acc["temp"].append(s.temp)
        if s.hum is not None: self._acc["hum"].append(s.hum)
        if s.soil_raw is not None: self._soil(now, s.soil_raw)
        if s.distance_mm is not None and s.distance_mm >= 0: self._distance(now, s.distance_mm)
        if s.light is not None or s.cam_motion is not None: self._camera(now, s.light, s.cam_motion)
        self._knob(now, s)
        self._schedule(now)
        self._reading(now)
        self._render(now)
        out, self.events = self.events, []
        return out

    def command(self, now: datetime, cmd: str) -> list[dict]:
        """A command from the web page (via the relay)."""
        if cmd == "scene_dawn":
            arm = ARMS.get(self._today(now).get("arm") or "long")
            self.start_dawn(now, "remote", 20 / 60, chime=arm["chime"], plant=arm["plant"])   # 20-second demo
        elif cmd.startswith("checkin_"):
            mood = {"checkin_low": 1, "checkin_ok": 3, "checkin_good": 4}.get(cmd)
            if mood:
                self._first_activity(now, "remote")
                self._checkin(now, mood, via="web")
        out, self.events = self.events, []
        return out

    def learned(self) -> dict:
        return arm_summary(self.arm_stats)
