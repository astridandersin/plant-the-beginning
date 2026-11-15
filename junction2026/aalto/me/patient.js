// The person's own view of Plant the beginning. Same events as the clinic view (the
// simulated people in ../clinic/demo.json, or the real lamp through the relay), told
// kindly: no scores, no "late", no streaks. Temperature and humidity appear only here.

const RELAY = "/api/junction2026/relay";
const POLL_MS = 5000;
const MOOD_WORDS = { 1: "low", 2: "meh", 3: "ok", 4: "good", 5: "great" };
// The lamp's rising-sun colours (dawn_core.py), folded the way the sketch drives the strip.
const MOODS = { 1: [110, 22, 0, 0], 2: [190, 70, 10, 15], 3: [200, 115, 35, 70], 4: [255, 150, 20, 90], 5: [255, 200, 60, 160] };
const WAKE = { long: "a longer sunrise with a soft chime", short: "a short, silent sunrise", plant: "a sunrise with a reminder about your plant" };

const $ = (id) => document.getElementById(id);
const state = { who: "demo:maija", rows: [], since: 0, timer: null, demo: null };

const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const dayName = (key) => new Date(key + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });
const dayLong = (key) => new Date(key + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const addDays = (key, n) => { const d = new Date(key + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
function moodRgb(m) {
  const [r, g, b, w] = MOODS[m];
  return [Math.min(255, r + w), Math.min(255, g + w * 0.45), Math.min(255, b + w * 0.12)].map(Math.round);
}
const css = (rgb, a = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

/* ---------- the person's picture, from the lamp's events ---------- */

function picture(events) {
  const evs = events.filter((e) => e && e.type && e.day).sort((a, b) => (a.t || 0) - (b.t || 0));
  const today = evs.map((e) => e.day).sort().pop() || null;
  const todays = evs.filter((e) => e.day === today);
  const last = (type, list = evs) => [...list].reverse().find((e) => e.type === type);
  const summaries = new Map(evs.filter((e) => e.type === "day").map((e) => [e.day, e]));
  const checkin = last("checkin", todays);
  const reading = last("reading");
  const daylightToday = last("daylight", todays);
  const watering = last("watering");
  const awayEv = last("away");
  const rhythm = [...evs].reverse().find((e) => e.level != null && ["checkin", "first_activity", "day"].includes(e.type));
  const lastDay = last("day") || {};

  const week = [];
  for (let i = 6; i >= 0 && today; i--) {
    const key = addDays(today, -i);
    const s = summaries.get(key);
    if (key === today) {
      week.push({ key, today: true, mood: checkin?.mood || 0, watered: todays.some((e) => e.type === "watering"), sunny: false, away: !!awayEv?.on });
    } else if (s) {
      week.push({ key, mood: s.mood || 0, watered: !!s.watered, sunny: (s.daylight_min || 0) >= 180, away: !!s.away });
    } else {
      week.push({ key, none: true });
    }
  }
  return {
    today, checkin, reading, daylightToday, watering, away: !!awayEv?.on,
    level: rhythm?.level || 0, yesterday: summaries.get(addDays(today, -1)), lastDay, week,
    lastT: evs.reduce((m, e) => Math.max(m, e.t || 0), 0),
  };
}

/* ---------- rendering ---------- */

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

function render(p, name) {
  $("greeting").textContent = greeting(name);
  const live = state.who === "live";
  $("dateline").textContent = p.today
    ? `${dayLong(p.today)}${live && p.lastT ? ` · your lamp was last heard ${ago(p.lastT)}` : ""}`
    : "Waiting for your lamp.";

  // today
  const sun = $("today-sun");
  if (p.checkin) {
    const rgb = moodRgb(p.checkin.mood);
    sun.style.setProperty("--mood", css(rgb)); sun.style.setProperty("--mood-glow", css(rgb, 0.55));
    $("today-mood").textContent = `You're feeling ${p.checkin.mood_word || MOOD_WORDS[p.checkin.mood]} today`;
    $("today-note").textContent = `You checked in at ${p.checkin.at}. Thank you. Your lamp is glowing in that colour.`;
  } else {
    sun.style.removeProperty("--mood"); sun.style.removeProperty("--mood-glow");
    $("today-mood").textContent = "No check-in yet today";
    $("today-note").textContent = "Whenever you're ready: green on the lamp, choose with + or −, then green again. There's no hurry, and no wrong answer.";
  }
  $("checkin").querySelectorAll("button").forEach((b) => (b.disabled = !live));
  if (!live) $("cmd-note").textContent = "In the demo these buttons are off; with the real lamp they send your check-in to it.";

  // plant
  const soil = p.reading?.soil;
  $("soil-fill").style.height = soil != null ? `${Math.max(4, Math.min(100, soil))}%` : "0";
  $("plant-state").textContent = soil == null ? "Your plant" : soil < 25 ? "Your plant would like some water" : soil < 45 ? "Your plant is fine for now" : "Your plant is happy";
  const w = p.watering;
  $("plant-note").textContent = w
    ? `Last watered ${w.day === p.today ? "today" : dayLong(w.day)}${w.at ? ` at ${w.at}` : ""}.${soil != null ? ` Soil moisture ${Math.round(soil)} %.` : ""}`
    : "No watering seen lately. A little water now and then is all it needs.";

  // room (smart-home readings: only here)
  const r = p.reading || {};
  const rows = [];
  if (r.temp != null) rows.push(["Temperature", r.temp.toFixed(1) + " °C", r.temp < 17 ? "a bit cool" : r.temp <= 22 ? "comfortable" : "on the warm side; many people sleep better a little cooler"]);
  if (r.hum != null) rows.push(["Humidity", Math.round(r.hum) + " %", r.hum < 30 ? "dry air" : r.hum <= 60 ? "comfortable" : "humid"]);
  const dl = p.daylightToday ? `reached the room at ${p.daylightToday.at}` : "hasn't reached the room yet today";
  rows.push(["Daylight", "", dl + (p.yesterday?.daylight_min ? `; about ${Math.round(p.yesterday.daylight_min / 6) / 10} h yesterday` : "")]);
  $("room").replaceChildren(...rows.flatMap(([k, v, note]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd");
    if (v) { const b = document.createElement("b"); b.textContent = v; dd.append(b); }
    const s = document.createElement("span"); s.textContent = note; dd.append(s);
    return [dt, dd];
  }));

  // week
  $("week").replaceChildren(...p.week.map((d) => {
    const li = document.createElement("li");
    const label = document.createElement("span"); label.className = "d"; label.textContent = d.today ? "Today" : dayName(d.key);
    const m = document.createElement("span"); m.className = "m";
    let text = `${dayLong(d.key)}: `;
    if (d.none) text += "no lamp data";
    else if (d.away) { m.classList.add("away"); text += "away"; }
    else if (d.mood) { const rgb = moodRgb(d.mood); m.classList.add("has"); m.style.setProperty("--mood", css(rgb)); m.style.setProperty("--mood-glow", css(rgb, 0.5)); text += `mood ${MOOD_WORDS[d.mood]}`; }
    else text += "no check-in";
    const marks = document.createElement("span"); marks.className = "marks";
    if (d.watered) { const i = document.createElement("span"); i.className = "ico drop"; marks.append(i); text += ", plant watered"; }
    if (d.sunny) { const i = document.createElement("span"); i.className = "ico day"; marks.append(i); text += ", a bright day"; }
    li.title = text; li.setAttribute("aria-label", text);
    li.append(label, m, marks);
    return li;
  }));

  // what seems to help
  const L = p.lastDay;
  if (!L.learn_best) $("learn-text").textContent = "Your lamp is still getting to know you. Give it a couple of weeks.";
  else if (L.learn_clear) $("learn-text").textContent = `So far, ${WAKE[L.learn_best]} seems to suit you best.`;
  else $("learn-text").textContent = `Still learning. Right now ${WAKE[L.learn_best]} is a little ahead, but it's too early to say.`;

  // away
  $("away-text").textContent = p.away ? "You're marked as away. Welcome back whenever you are." : "You're at home.";

  // what the clinic sees, in calm words
  $("clinic-level").textContent = [
    "Your mornings look steady. Nothing has been flagged.",
    "Your mornings have been changing a little lately. Your clinic can see this; nothing more happens unless it continues.",
    "Your mornings have been different for several days, so your clinic may get in touch this week. That's what the lamp is for, and it's always fine to contact them first.",
  ][p.level] || "";
}

// The real lamp has sent nothing (switched off, or its history was cleared): say so plainly,
// and clear whatever a simulated person left on the page.
function renderOffline() {
  $("banner").textContent = "The real lamp hasn't sent anything yet. If it's offline, choose a simulated person above to see the full view.";
  $("greeting").textContent = greeting("");
  $("dateline").textContent = "Waiting for the lamp.";
  const sun = $("today-sun"); sun.style.removeProperty("--mood"); sun.style.removeProperty("--mood-glow");
  $("today-mood").textContent = "Nothing from the lamp yet";
  $("today-note").textContent = "As soon as the lamp is on, its check-ins, plant and room readings appear here within seconds.";
  $("checkin").querySelectorAll("button").forEach((b) => (b.disabled = true));
  $("cmd-note").textContent = "These buttons send a check-in to the real lamp while it's on.";
  $("soil-fill").style.height = "0";
  $("plant-state").textContent = "Your plant";
  $("plant-note").textContent = "";
  $("room").replaceChildren();
  $("week").replaceChildren();
  $("learn-text").textContent = "Your lamp is still getting to know you. Give it a couple of weeks.";
  $("away-text").textContent = "";
  $("clinic-level").textContent = "";
}

/* ---------- sources ---------- */

async function load() {
  clearInterval(state.timer);
  if (state.who.startsWith("demo:")) {
    const id = state.who.slice(5);
    if (!state.demo) state.demo = await (await fetch("../clinic/demo.json", { cache: "no-store" })).json();
    const person = state.demo.patients.find((x) => x.id === id);
    $("banner").innerHTML = "Demo with a <strong>simulated person</strong>, whose days went through the lamp's real software.";
    render(picture(person.events), person.name.replace(/\s*\(simulated\)/, ""));
  } else {
    state.rows = []; state.since = 0;
    await poll();
    state.timer = setInterval(poll, POLL_MS);
  }
}

async function poll() {
  try {
    const res = await fetch(`${RELAY}?channel=dawn${state.since ? `&since=${state.since}` : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`the relay answered ${res.status}`);
    const j = await res.json();
    if (j.readings?.length) { state.rows.push(...j.readings); state.since = Math.max(state.since, ...j.readings.map((r) => r.t || 0)); }
    if (!state.rows.length) { renderOffline(); return; }
    $("banner").textContent = "The real lamp at Junction, live. A demo device: no real personal data.";
    render(picture(state.rows), "");
  } catch (err) {
    $("banner").textContent = `The live lamp isn't reachable (${err.message}). Try a simulated person instead.`;
    clearInterval(state.timer);
  }
}

async function sendCmd(cmd) {
  const note = $("cmd-note");
  note.textContent = "Sending…";
  try {
    const res = await fetch(RELAY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "dawn", cmd }) });
    const j = await res.json().catch(() => ({}));
    note.textContent = res.ok ? "Sent. Your lamp picks it up within a few seconds." : j.error || "Couldn't send it.";
  } catch { note.textContent = "Couldn't reach your lamp."; }
}

$("who").addEventListener("change", (e) => { state.who = e.target.value; load(); });
document.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => sendCmd(b.dataset.cmd)));
const params = new URLSearchParams(location.search);
if (params.has("live")) { state.who = "live"; $("who").value = "live"; }
else if (["maija", "antti", "leena"].includes(params.get("who"))) { state.who = `demo:${params.get("who")}`; $("who").value = state.who; }
load();
