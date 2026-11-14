/**
 * Server-side task registry for the shared Gemini proxy (/api/junction2026/gemini).
 *
 * The browser only ever sends { task, input }. Everything that shapes the
 * model's behaviour lives here: the prompt, the JSON schema, input limits and
 * an output check. Adding a task = one entry below. Unknown tasks are refused.
 *
 * Models: set JUNCTION_GEMINI_MODEL (and optionally JUNCTION_GEMINI_FALLBACK_MODEL)
 * in Vercel to pin exact model IDs once they are checked against the live
 * model list. Until then the defaults are the aliases the portfolio's
 * api/ask.js already runs on.
 */
const MODEL = process.env.JUNCTION_GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODEL = process.env.JUNCTION_GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";

/* Every number that appears in a value (strings are scanned, numbers taken as is). */
function numbersIn(value, out = new Set()) {
  if (typeof value === "number" && Number.isFinite(value)) out.add(normalise(value));
  else if (typeof value === "string") for (const m of value.matchAll(/-?\d+(?:[.,]\d+)?/g)) out.add(normalise(Number(m[0].replace(",", "."))));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}
const normalise = (n) => Math.round(n * 100) / 100;

/* Output may only use numbers that are in the input (plus small counting words like 1-14 days). */
function onlyInputNumbers(input, output, allowed = []) {
  const known = numbersIn(input);
  allowed.forEach((n) => known.add(normalise(n)));
  const unknown = [...numbersIn(output)].filter((n) => !known.has(n));
  return unknown.length ? `Output used numbers not in the input: ${unknown.slice(0, 5).join(", ")}` : null;
}

const SMALL_COUNTS = Array.from({ length: 15 }, (_, i) => i); // 0..14: days, arms, lines

const TASKS = {
  /* Health check for tonight's risk test: proves the key, model and JSON mode work. */
  ping: {
    maxInputBytes: 200,
    maxOutputTokens: 64,
    system: "Reply with the JSON object requested. Nothing else.",
    prompt: () => 'Return {"pong": true}.',
    schema: { type: "object", properties: { pong: { type: "boolean" } }, required: ["pong"] },
    validate: (_input, out) => (out.pong === true ? null : "pong was not true"),
  },

  /* Plant the beginning (Dawn lamp): a short, kind summary of the lamp's own numbers,
     for the person and for their clinician. Input comes from the clinic view:
     { days_tracked, baseline_first_activity, recent_first_activity: [..], late_run,
       missed_checkins_7d, mood_avg_7d, mood_avg_baseline, watered_days_7d, room_temp_avg } */
  "dawn.evidence": {
    maxInputBytes: 2000,
    maxOutputTokens: 400,
    system: [
      "You write a short weekly summary for Plant the beginning, a bedside planter-lamp that supports people at home in the months after TMS treatment for depression.",
      "You receive only the lamp's own numbers: when each day's first activity happened (knob check-in, movement or watering) against the person's own baseline, how many mornings in a row were far from their usual time, earlier or later (late_run), missed check-ins, average mood from the knob (1 low to 5 great), how often the plant was watered, and the room temperature.",
      "Write exactly two short, warm, plain-language lines for the person, and one short, factual reason for their clinician.",
      "Rules: use only numbers present in the input, written the same way; never diagnose or name an illness; never promise outcomes; never blame;",
      "call the light a dawn cue, never light therapy; the clinic, not the lamp, decides whether to reach out or offer a booster session.",
      "Set flag_checkin to true only if late_run is 5 or more.",
    ].join(" "),
    prompt: (input) => `Lamp numbers (JSON):\n${JSON.stringify(input)}`,
    validateInput: (input) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be an object";
      if (!Number.isInteger(input.late_run) || input.late_run < 0 || input.late_run > 60) return "late_run must be a whole number";
      return null;
    },
    schema: {
      type: "object",
      properties: {
        patient_lines: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
        clinician_reason: { type: "string" },
        flag_checkin: { type: "boolean" },
      },
      required: ["patient_lines", "clinician_reason", "flag_checkin"],
    },
    validate: (input, out) => {
      if (!Array.isArray(out.patient_lines) || out.patient_lines.length !== 2) return "need exactly two patient lines";
      if (/light therapy|diagnos|depressi(ve|on) (is|has) (returned|relapsed)|relapse/i.test(JSON.stringify(out))) return "used a forbidden claim";
      if (out.flag_checkin !== (input.late_run >= 5)) return "flag_checkin doesn't match late_run";
      return onlyInputNumbers(input, out, SMALL_COUNTS);
    },
  },

  /* Weekly note for the clinician: what changed, how sure the lamp is, one suggested
     next step from a fixed list (the model can't invent actions). Input from the clinic view:
     { level: 0|1|2, late_run, direction, irregular, baseline_first_activity, recent_first_activity: [..],
       missed_checkins_7d, mood_avg_7d, mood_avg_baseline, watered_days_7d, daylight_min_avg_7d,
       away_days_7d, false_alarm_rate_pct } */
  "dawn.digest": {
    maxInputBytes: 2000,
    maxOutputTokens: 500,
    system: [
      "You write a short weekly note for a clinician who follows people at home after TMS treatment for depression, using only numbers from their bedside lamp.",
      "level 0 = steady, 1 = keep an eye, 2 = check in. late_run counts mornings in a row far from the person's own usual time, earlier or later (see direction).",
      "Write: what_changed (one or two plain sentences), confidence (one sentence that names the lamp's known false-alarm rate from the input and says this is a reason to ask, not a verdict), and pick suggested_step from the allowed list.",
      "Rules: use only numbers present in the input, written the same way; never diagnose, never name an illness, never say relapse; away days are not a concern;",
      "pick 'no action this week' for level 0, 'send a PHQ-9' or 'phone call this week' for level 1 or 2, and 'discuss a booster at the next visit' only for level 2.",
    ].join(" "),
    prompt: (input) => `Lamp numbers for one person, last 7 days (JSON):\n${JSON.stringify(input)}`,
    validateInput: (input) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be an object";
      if (![0, 1, 2].includes(input.level)) return "level must be 0, 1 or 2";
      return null;
    },
    schema: {
      type: "object",
      properties: {
        what_changed: { type: "string" },
        confidence: { type: "string" },
        suggested_step: { type: "string", enum: ["no action this week", "send a PHQ-9", "phone call this week", "discuss a booster at the next visit"] },
      },
      required: ["what_changed", "confidence", "suggested_step"],
    },
    validate: (input, out) => {
      if (/light therapy|diagnos|relapse|depressi(ve|on) (is|has)/i.test(JSON.stringify(out))) return "used a forbidden claim";
      const allowed = { 0: ["no action this week"], 1: ["send a PHQ-9", "phone call this week"], 2: ["send a PHQ-9", "phone call this week", "discuss a booster at the next visit"] };
      if (!allowed[input.level].includes(out.suggested_step)) return "suggested step doesn't fit the level";
      return onlyInputNumbers(input, out, SMALL_COUNTS);
    },
  },

  /* For the person: what the lamp has learned about which gentle response helps them.
     Input: { responses: [{ name, label, score, low, high, days }], best, clear, days_learning } */
  "dawn.learned": {
    maxInputBytes: 1500,
    maxOutputTokens: 250,
    system: [
      "You explain to a person what their bedside lamp has learned so far about which of its gentle morning responses seems to suit them.",
      "Scores run from 0 to 1 and summarise how steady their mornings and mood were on days with each response; low and high are the uncertainty.",
      "Write exactly two short, warm lines. If clear is false, say kindly that the lamp is still learning and what it leans towards. If clear is true, say which response it will use more often.",
      "Rules: use only numbers present in the input; no medical claims, no promises, never say therapy or treatment; refer to responses by their label.",
    ].join(" "),
    prompt: (input) => `What the lamp has learned (JSON):\n${JSON.stringify(input)}`,
    validateInput: (input) => (Array.isArray(input?.responses) && input.responses.length <= 5 ? null : "responses must be a short list"),
    schema: {
      type: "object",
      properties: { lines: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 } },
      required: ["lines"],
    },
    validate: (input, out) => {
      if (!Array.isArray(out.lines) || out.lines.length !== 2) return "need exactly two lines";
      if (/therapy|treatment|cure|diagnos/i.test(JSON.stringify(out))) return "used a forbidden claim";
      if (!input.clear && /\b(proven|definitely|always works)\b/i.test(JSON.stringify(out))) return "claimed certainty while still learning";
      return onlyInputNumbers(input, out, SMALL_COUNTS);
    },
  },

  // Pathway Lens tasks (pathway.brief, pathway.ask) are added once the evidence table exists:
  // they load the county's evidence rows on the server and use onlyInputNumbers().
};

module.exports = { TASKS, MODEL, FALLBACK_MODEL, onlyInputNumbers, numbersIn };
