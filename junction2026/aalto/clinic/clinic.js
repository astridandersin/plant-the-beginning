// Clinic view for Plant the beginning. Reads the lamp's events (live from the relay, or
// the simulated demo people in demo.json), turns them into one ranked list and a
// per-person picture, and asks Gemini for a weekly clinic note and a plain-words
// explanation of what the lamp has learned. The rhythm verdicts (usual time, levels,
// learning) come from the lamp itself (hardware/dawn-lamp/app/python/dawn_core.py);
// this page only displays them.

const RELAY = "/api/junction2026/relay";
const GEMINI = "/api/junction2026/gemini";
const POLL_MS = 5000;
const FALSE_ALARM_PCT = 9;   // "check in" for steady people within a week, measured on Depresjon with the lamp's own code
const MOOD_WORDS = { 1: "low", 2: "meh", 3: "ok", 4: "good", 5: "great" };
const SOURCE_WORDS = { knob: "check-in buttons", movement: "movement", camera: "movement (camera)", water: "watering", remote: "web check-in" };
const ARM_LABELS = { long: "Long wake cue with a chime", short: "Short, silent wake cue", plant: "Wake cue and a plant reminder" };

const $ = (id) => document.getElementById(id);
const state = { source: "demo", patients: [], selected: null, liveRows: [], liveSince: 0, timer: null };

/* ---------- small helpers ---------- */

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : String(k));
  return n;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const dayLabel = (key) => new Date(key + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt1 = (n) => (n == null ? "–" : (Math.round(n * 10) / 10).toString());
const r1 = (n) => (n == null ? 0 : Math.round(n * 10) / 10);

/* ---------- turning events into a person ---------- */

function buildPatient(id, name, events) {
  const evs = events.filter((e) => e && e.type);
  const dayKeys = evs.map((e) => e.day).filter(Boolean).sort();
  const today = dayKeys[dayKeys.length - 1] || null;

  const days = new Map();
  for (const e of evs) if (e.type === "day") days.set(e.day, { ...e, partial: false });

  const todays = evs.filter((e) => e.day === today && e.type !== "day");
  if (today && !days.has(today)) {
    const first = todays.find((e) => e.type === "first_activity");
    const checkins = todays.filter((e) => e.type === "checkin");
    const readings = todays.filter((e) => e.type === "reading");
    const plan = todays.find((e) => e.type === "plan");
    const awayEv = [...evs].reverse().find((e) => e.type === "away");
    days.set(today, {
      day: today, partial: true,
      first_at: first?.at || "", first_min: first ? toMin(first.at) : -1, first_source: first?.source || "",
      late: first?.late ?? 0, dev: first?.dev ?? -9999, baseline_at: first?.baseline_at || "",
      mood: checkins.length ? checkins[checkins.length - 1].mood : 0,
      watered: todays.some((e) => e.type === "watering") ? 1 : 0,
      soil_avg: avg(readings.map((r) => r.soil).filter((v) => v != null)) ?? -1,
      temp_avg: avg(readings.map((r) => r.temp).filter((v) => v != null)) ?? -1,
      away: awayEv?.on ? 1 : 0, arm: plan?.arm || "",
    });
  }
  const series = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-14);

  // Only the rhythm check carries the flag level (0 steady, 1 keep an eye, 2 check in).
  const withLevel = evs.filter((e) => e.level != null && (e.type === "checkin" || e.type === "first_activity" || e.type === "day"));
  const latest = withLevel[withLevel.length - 1] || {};
  const lastDay = [...evs].reverse().find((e) => e.type === "day") || {};
  const baselineAt = [...evs].reverse().find((e) => e.baseline_at)?.baseline_at || "";

  const done = series.filter((d) => !d.partial);
  const last7 = done.slice(-7);
  const here7 = last7.filter((d) => !d.away);
  const first7 = series.filter((d) => !d.away).slice(0, 7);
  const moods7 = here7.map((d) => d.mood).filter(Boolean);
  const moodsBase = first7.map((d) => d.mood).filter(Boolean);
  const stats = {
    level: latest.level || 0,
    late_run: latest.late_run || 0,
    direction: lastDay.direction || "",
    irregular: lastDay.irregular || 0,
    baseline_at: baselineAt,
    missed_7d: here7.filter((d) => !d.mood).length,
    days_7d: here7.length,
    away_7d: last7.filter((d) => d.away).length,
    mood_7d: avg(moods7),
    mood_base: avg(moodsBase),
    watered_7d: here7.filter((d) => d.watered).length,
    temp_7d: avg(here7.map((d) => d.temp_avg).filter((v) => v != null && v >= 0)),
    daylight_7d: avg(here7.map((d) => d.daylight_min).filter((v) => v != null)),
  };
  const learning = lastDay.learn_best ? {
    best: lastDay.learn_best, clear: !!lastDay.learn_clear,
    arms: Object.keys(ARM_LABELS).map((k) => ({ name: k, label: ARM_LABELS[k], mean: lastDay[`arm_${k}_mean`], lo: lastDay[`arm_${k}_lo`], hi: lastDay[`arm_${k}_hi`], days: lastDay[`arm_${k}_days`] })),
    learnDays: done.filter((d) => d.reward != null && d.reward >= 0).length,
  } : null;
  const level = ["ok", "watch", "amber"][stats.level];
  const score = stats.level * 1000 + stats.late_run * 10 + stats.missed_7d;
  const lastReading = [...evs].reverse().find((e) => e.type === "reading");
  const lastStatus = [...evs].reverse().find((e) => e.type === "status");
  const lastT = evs.reduce((m, e) => Math.max(m, e.t || 0), 0);
  return { id, name, today, series, todays, stats, level, score, learning, lastReading, lastStatus, lastT };
}

function reasonFor(p) {
  const s = p.stats;
  const dir = s.direction === "earlier" ? "much earlier" : s.direction === "later" ? "much later" : "far";
  if (s.level === 2) return s.irregular >= 2.5
    ? `Mornings far from usual, both much earlier and much later, for ${s.late_run} days in a row.`
    : `Mornings ${dir} than usual for ${s.late_run} days in a row.`;
  if (s.level === 1) return s.irregular >= 2.5 ? "Mornings much more irregular than usual." : "Mornings drifting from their usual time.";
  if (s.missed_7d >= 3) return `Steady mornings; ${s.missed_7d} missed check-ins this week.`;
  return "Mornings steady.";
}

/* ---------- list ---------- */

function renderList() {
  const ol = $("patients");
  ol.replaceChildren();
  if (!state.patients.length) {
    ol.append(el("li", { class: "hint" }, state.source === "live" ? "No data from the lamp yet." : "Loading…"));
    return;
  }
  for (const p of state.patients) {
    ol.append(el("li", {},
      el("button", { type: "button", "aria-current": String(p.id === state.selected), onclick: () => { state.selected = p.id; clearAi(); render(); } },
        el("span", { class: "name" }, el("span", { class: `dot ${p.level}`, "aria-hidden": "true" }), p.name),
        el("span", { class: "why" }, reasonFor(p)))));
  }
}

/* ---------- detail ---------- */

function renderStatus(p) {
  const box = $("status");
  box.className = `status ${p.level}`;
  const head = ["Steady", "Keep an eye", "Check in this week"][p.stats.level];
  const tail = p.stats.level === 2
    ? `${reasonFor(p)} The lamp flags worrying behaviour, but the clinic decides on the course of action: whether to reach out or offer a booster. About ${FALSE_ALARM_PCT} % of steady people reach this level by mistake in a week.`
    : reasonFor(p);
  box.replaceChildren(el("strong", {}, `${p.name}: ${head}`), el("span", {}, tail));
}

function tile(k, v, d, size = "") { return el("div", { class: `tile ${size}` }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "d" }, d || "")); }

function renderTiles(p) {
  const s = p.stats;
  const recent = p.series.slice(-3).map((d) => (d.away ? "away" : d.first_at || "none")).join("  ");
  $("tiles").replaceChildren(
    tile("Usual first activity", s.baseline_at || "–", p.today && new Date(p.today + "T12:00:00").getDay() % 6 === 0 ? "their own weekend pattern" : "their own weekday pattern"),
    tile("Last 3 mornings", recent || "–", "first activity", "small"),
    tile("Far from usual, in a row", String(s.late_run), s.direction ? `latest ${s.direction}` : "check in at 5"),
    tile("Mood, last 7 days", fmt1(s.mood_7d), s.mood_base != null ? `first week ${fmt1(s.mood_base)}` : ""),
    tile("Missed check-ins", `${s.missed_7d} of ${s.days_7d}`, s.away_7d ? `${s.away_7d} away day${s.away_7d > 1 ? "s" : ""} not counted` : "days at home"),
    tile("Daylight in the room", s.daylight_7d != null ? `${Math.round(s.daylight_7d / 60 * 10) / 10} h` : "–", "a day, from the light sensor"),
  );
}

function svg(w, h, body) { return `<svg viewBox="0 0 ${w} ${h}" role="img">${body}</svg>`; }

function chartRhythm(p) {
  const W = 640, H = 230, L = 44, R = 10, T = 10, B = 26;
  const lo = 4 * 60 + 30, hi = 12 * 60;
  const n = Math.max(p.series.length, 2);
  const step = (W - L - R) / (n - 1);
  const x = (i) => L + i * step;
  const y = (m) => T + ((Math.min(hi, Math.max(lo, m)) - lo) * (H - T - B)) / (hi - lo);
  let g = "";
  for (let hh = 5; hh <= 12; hh++) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(hh * 60)}" y2="${y(hh * 60)}"/><text x="${L - 6}" y="${y(hh * 60) + 4}" text-anchor="end">${String(hh).padStart(2, "0")}:00</text>`;
  p.series.forEach((d, i) => {
    const base = toMin(d.baseline_at);
    if (base != null && !d.away) g += `<rect class="band" x="${x(i) - step * 0.42}" width="${step * 0.84}" y="${y(base - 60)}" height="${y(base + 60) - y(base - 60)}"><title>${esc(dayLabel(d.day))}: usual ${esc(d.baseline_at)}</title></rect>`;
  });
  p.series.forEach((d, i) => {
    const label = `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(dayLabel(d.day).split(" ")[0])}</text>`;
    if (d.away) g += `<rect class="away" x="${x(i) - 6}" y="${y(7 * 60) - 6}" width="12" height="12" rx="2"><title>${esc(dayLabel(d.day))}: away</title></rect>${label}`;
    else if (d.first_min == null || d.first_min < 0) g += `<circle class="miss" cx="${x(i)}" cy="${y(hi)}" r="5"><title>${esc(dayLabel(d.day))}: no activity</title></circle>${label}`;
    else g += `<circle class="pt${d.late ? " late" : ""}" cx="${x(i)}" cy="${y(d.first_min)}" r="5"><title>${esc(dayLabel(d.day))}: ${esc(d.first_at)} (${esc(SOURCE_WORDS[d.first_source] || d.first_source)})${d.partial ? ", today" : ""}</title></circle>${label}`;
  });
  $("chart-rhythm").innerHTML = svg(W, H, g);
}

function chartMood(p) {
  const W = 320, H = 150, L = 22, R = 6, T = 8, B = 22;
  const n = p.series.length || 1;
  const bw = (W - L - R) / n;
  const my = (m) => T + ((5 - m) * (H - T - B)) / 5;
  let g = "";
  for (let m = 1; m <= 5; m++) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${my(m)}" y2="${my(m)}"/><text x="${L - 6}" y="${my(m) + 4}" text-anchor="end">${m}</text>`;
  p.series.forEach((d, i) => {
    const cx = L + bw * i + bw / 2;
    if (d.away) g += `<rect class="away" x="${cx - 3}" y="${H - B - 7}" width="6" height="6" rx="1"><title>${esc(dayLabel(d.day))}: away</title></rect>`;
    else if (d.mood) { const top = my(d.mood); g += `<rect class="bar" x="${cx - bw * 0.3}" width="${bw * 0.6}" y="${top}" height="${H - B - top}"><title>${esc(dayLabel(d.day))}: ${d.mood} (${MOOD_WORDS[d.mood]})</title></rect>`; }
    else if (!d.partial) g += `<circle class="miss" cx="${cx}" cy="${H - B - 4}" r="3.5"><title>${esc(dayLabel(d.day))}: no check-in</title></circle>`;
    if (i % 2 === n % 2) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(dayLabel(d.day).split(" ")[0])}</text>`;
  });
  $("chart-mood").innerHTML = svg(W, H, g);
}

function chartPlant(p) {
  const W = 320, H = 150, L = 30, R = 6, T = 8, B = 22;
  const n = Math.max(p.series.length, 2);
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  let g = "";
  for (const v of [0, 50, 100]) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
  const pts = p.series.map((d, i) => (d.soil_avg != null && d.soil_avg >= 0 ? [x(i), y(d.soil_avg)] : null)).filter(Boolean);
  if (pts.length > 1) g += `<path class="line" d="${pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("")}"/>`;
  p.series.forEach((d, i) => {
    if (d.watered) g += `<path class="drop" d="M${x(i)},${T + 2} q4,6 0,9 q-4,-3 0,-9z"><title>${esc(dayLabel(d.day))}: watered</title></path>`;
    if (i % 2 === n % 2) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(dayLabel(d.day).split(" ")[0])}</text>`;
  });
  $("chart-plant").innerHTML = svg(W, H, g);
}

function describe(e) {
  switch (e.type) {
    case "plan": return `Today's response: ${(ARM_LABELS[e.arm] || e.arm).toLowerCase()}`;
    case "dawn": return e.trigger === "remote" ? "Wake cue played from the web" : `Wake cue started (${e.minutes} min)`;
    case "reminder": return "Soft reminder chime (no check-in yet)";
    case "first_activity": return `First activity: ${SOURCE_WORDS[e.source] || e.source}${e.late ? ` (far from usual${e.dev > 0 ? ", later" : e.dev < 0 ? ", earlier" : ""})` : ""}`;
    case "checkin": return `Check-in: ${e.mood} (${e.mood_word || MOOD_WORDS[e.mood]})${e.via === "web" ? " from the web" : ""}`;
    case "watering": return `Plant watered (${e.soil_before}% → ${e.soil_after}%)`;
    case "daylight": return "Daylight in the room (curtains open)";
    case "away": return e.on ? "Marked away (held the green button)" : "Back home";
    default: return null;
  }
}

function renderToday(p) {
  const items = p.todays.map((e) => [e.at, describe(e)]).filter(([, d]) => d).sort((a, b) => (toMin(a[0]) ?? 0) - (toMin(b[0]) ?? 0));
  $("today").replaceChildren(...(items.length ? items.map(([at, d]) => el("li", {}, el("time", {}, at || ""), d)) : [el("li", {}, "Nothing yet today.")]));
  const r = p.lastReading || {};
  // Temperature and humidity stay in the person's own view: they're comfort readings, not clinical signals.
  const rows = [
    ["Room light", r.light != null ? `${r.light} / 100` : "–"],
    ["Soil moisture", r.soil != null ? `${r.soil} %` : "–"],
    ["Lamp", state.source === "live" ? (p.lastT ? `last heard ${ago(p.lastT)}` : "not heard yet") : "simulated"],
  ];
  if (p.lastStatus?.modules) rows.push(["Modules", p.lastStatus.modules]);
  $("room").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
}

function renderLearning(p) {
  const box = $("learning");
  const L = p.learning;
  if (!L) { box.replaceChildren(el("p", { class: "sub" }, "Not enough days yet.")); return; }
  const rows = L.arms.map((a) => el("div", { class: `r${a.name === L.best ? " best" : ""}` },
    el("span", { class: "lab" }, a.label),
    el("span", { class: "trk", title: `${a.label}: ${a.mean} (range ${a.lo}–${a.hi}), ${a.days} days` },
      el("span", { class: "ci", style: `left:${a.lo * 100}%;width:${(a.hi - a.lo) * 100}%` }),
      el("span", { class: "mean", style: `left:${a.mean * 100}%` })),
    el("span", { class: "num" }, `${Math.round(a.days)} d`)));
  const best = L.arms.find((a) => a.name === L.best);
  const verdict = L.clear ? `It has learned that the ${best.label.toLowerCase()} suits this person best, and uses it most.`
    : `Still learning. It leans towards the ${best.label.toLowerCase()}, but the ranges still overlap.`;
  box.replaceChildren(el("div", { class: "learn" }, rows), el("p", { class: "sub" }, verdict));
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

/* ---------- Gemini ---------- */

function clearAi() { $("ai-out").replaceChildren(); $("learn-out").replaceChildren(); }

async function askGemini(task, input) {
  try {
    const res = await fetch(GEMINI, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, input }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return { data: j.data, note: `Written by ${j.model}, checked on the server.` };
    return { data: null, note: j.error || "The AI isn't available right now." };
  } catch { return { data: null, note: "The AI isn't reachable from here." }; }
}

// Fallbacks, built from the same numbers (no AI), so the page always says something true.
function digestFallback(p, input) {
  const s = p.stats;
  const step = s.level === 0 ? "no action this week" : s.level === 1 ? "send a PHQ-9" : "phone call this week";
  const what = s.level === 0 ? `Mornings stayed close to the usual ${input.baseline_first_activity || "time"}; mood ${fmt1(s.mood_7d)} on average.`
    : `${reasonFor(p)} Recent first activity: ${input.recent_first_activity.join(", ")}. Mood ${fmt1(s.mood_7d)} against ${fmt1(s.mood_base)} in the first week.`;
  return { what_changed: what, confidence: `The lamp flags about ${FALSE_ALARM_PCT} % of steady people by mistake in a week; this is a reason to ask, not a verdict.`, suggested_step: step };
}

async function digest() {
  const p = state.patients.find((x) => x.id === state.selected);
  if (!p) return;
  const s = p.stats;
  const input = {
    level: s.level, late_run: s.late_run, direction: s.direction, irregular: r1(s.irregular),
    baseline_first_activity: s.baseline_at,
    recent_first_activity: p.series.slice(-5).map((d) => (d.away ? "away" : d.first_at || "none")),
    missed_checkins_7d: s.missed_7d, mood_avg_7d: r1(s.mood_7d), mood_avg_baseline: r1(s.mood_base),
    watered_days_7d: s.watered_7d, daylight_min_avg_7d: Math.round(s.daylight_7d || 0), away_days_7d: s.away_7d,
    false_alarm_rate_pct: FALSE_ALARM_PCT,
  };
  const out = $("ai-out");
  out.replaceChildren(el("p", { class: "note" }, "Asking Gemini…"));
  $("ai-go").disabled = true;
  let { data, note } = await askGemini("dawn.digest", input);
  if (!data) { data = digestFallback(p, input); note += " Showing a summary built from the same numbers without AI."; }
  out.replaceChildren(
    el("p", { class: "who" }, "What changed"), el("p", {}, data.what_changed),
    el("p", { class: "who" }, "How sure"), el("p", {}, data.confidence),
    el("p", { class: "who" }, "Suggested next step"), el("p", {}, data.suggested_step[0].toUpperCase() + data.suggested_step.slice(1) + ". The clinic decides."),
    el("p", { class: "note" }, note));
  $("ai-go").disabled = false;
}

async function explainLearning() {
  const p = state.patients.find((x) => x.id === state.selected);
  if (!p?.learning) {
    $("learn-out").replaceChildren(el("p", { class: "note" },
      "Nothing to explain yet: the lamp needs about a week of mornings before it can compare its three responses. Choose a simulated person above to see this explained."));
    return;
  }
  const L = p.learning;
  const input = {
    responses: L.arms.map((a) => ({ name: a.name, label: a.label.toLowerCase(), score: a.mean, low: a.lo, high: a.hi, days: Math.round(a.days) })),
    best: L.best, clear: L.clear, days_learning: L.learnDays,
  };
  const out = $("learn-out");
  out.replaceChildren(el("p", { class: "note" }, "Asking Gemini…"));
  $("learn-go").disabled = true;
  let { data, note } = await askGemini("dawn.learned", input);
  if (!data) {
    const best = L.arms.find((a) => a.name === L.best).label.toLowerCase();
    data = { lines: L.clear ? [`Your lamp has noticed your mornings tend to go best with the ${best}.`, "It will use that more often, and still try the others now and then."]
      : ["Your lamp is still getting to know your mornings.", `So far it leans towards the ${best}, but it's too early to be sure.`] };
    note += " Showing a version written without AI.";
  }
  out.replaceChildren(el("p", { class: "who" }, "For the person"), ...data.lines.map((l) => el("p", {}, l)), el("p", { class: "note" }, note));
  $("learn-go").disabled = false;
}

/* ---------- live lamp ---------- */

async function pollLive() {
  try {
    const url = `${RELAY}?channel=dawn${state.liveSince ? `&since=${state.liveSince}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 503 ? "The relay isn't set up on this server yet." : `Relay answered ${res.status}.`);
    const j = await res.json();
    if (j.readings?.length) {
      state.liveRows.push(...j.readings);
      state.liveSince = Math.max(state.liveSince, ...j.readings.map((r) => r.t || 0));
    }
    state.patients = state.liveRows.length ? [buildPatient("lamp", "Lamp at Junction (live)", state.liveRows)] : [];
    state.selected = state.patients[0]?.id || null;
    $("banner").textContent = state.liveRows.length
      ? "Live data from the real lamp at Junction. Demo device only: no real patient data."
      : "Waiting for the lamp: nothing has arrived yet.";
  } catch (err) {
    $("banner").textContent = `Live lamp not available: ${err.message} Switch back to the demo patients.`;
    clearInterval(state.timer);
  }
  render();
}

async function sendCmd(cmd) {
  const note = $("cmd-note");
  note.textContent = "Sending…";
  try {
    const res = await fetch(RELAY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "dawn", cmd }) });
    const j = await res.json().catch(() => ({}));
    note.textContent = res.ok ? "Sent. The lamp picks it up within a few seconds." : j.error || "Couldn't send.";
  } catch { note.textContent = "Couldn't reach the relay."; }
}

/* ---------- sources and rendering ---------- */

async function useSource(src) {
  state.source = src;
  clearInterval(state.timer);
  $("src-demo").setAttribute("aria-pressed", String(src === "demo"));
  $("src-live").setAttribute("aria-pressed", String(src === "live"));
  $("controls").hidden = src !== "live";
  clearAi();
  state.patients = [];
  render();
  if (src === "demo") {
    $("banner").innerHTML = "Demo with <strong>simulated people</strong>, generated through the lamp's real logic. Never use this page with real patient data.";
    const res = await fetch("demo.json", { cache: "no-store" });
    const demo = await res.json();
    state.patients = demo.patients.map((p) => buildPatient(p.id, p.name, p.events)).sort((a, b) => b.score - a.score);
    state.selected = state.patients[0]?.id || null;
    render();
  } else {
    state.liveRows = []; state.liveSince = 0;
    await pollLive();
    if (!/not available/.test($("banner").textContent)) state.timer = setInterval(pollLive, POLL_MS);
  }
}

function render() {
  renderList();
  const p = state.patients.find((x) => x.id === state.selected);
  $("detail").hidden = !p;
  if (!p) return;
  renderStatus(p); renderTiles(p); chartRhythm(p); chartMood(p); chartPlant(p); renderToday(p); renderLearning(p);
}

$("src-demo").addEventListener("click", () => useSource("demo"));
$("src-live").addEventListener("click", () => useSource("live"));
$("ai-go").addEventListener("click", digest);
$("learn-go").addEventListener("click", explainLearning);
document.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => sendCmd(b.dataset.cmd)));
useSource(new URLSearchParams(location.search).get("live") != null ? "live" : "demo");
