/**
 * Shared Gemini proxy for the Junction 2026 products: /api/junction2026/gemini
 *
 *   POST { task, input }  ->  { ok, data, model }      data is validated JSON
 *                         or  { ok: false, busy?, error }   the page then shows its saved example
 *
 * The browser never chooses the model, prompt or schema: those live in the
 * server-side task registry (api/_lib/junction2026/tasks.js). Limits: 5 calls a
 * minute per visitor (in memory), a daily cap per task in Redis when it is
 * configured (JUNCTION_GEMINI_DAILY_CAP, default 400), a 15 s timeout per try.
 *
 * Key: JUNCTION_GEMINI_API_KEY (separate quota from the portfolio), falling back
 * to GEMINI_API_KEY. Never sent to the browser.
 */
const { TASKS, MODEL, FALLBACK_MODEL } = require("../_lib/junction2026/tasks");
const { configured: hasRedis, pipeline } = require("../_lib/junction2026/redis");
const { makeLimiter } = require("../_lib/junction2026/limits");

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 15000;
const DAILY_CAP = Number(process.env.JUNCTION_GEMINI_DAILY_CAP) || 400;
const overVisitorLimit = makeLimiter(5, 60 * 1000);

async function underDailyCap(task) {
  if (!hasRedis) return true;
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const key = `junction2026:gemini:${task}:${day}`;
  try {
    const [count] = await pipeline([["INCR", key], ["EXPIRE", key, "172800"]]);
    return count <= DAILY_CAP;
  } catch {
    return true; // the store being down must not take the AI down with it
  }
}

async function callModel(model, key, spec, input) {
  const parts = spec.audio
    ? [{ inlineData: { mimeType: input.mime, data: input.audio_base64 } }, { text: "This is the check-in recording." }]
    : [{ text: spec.prompt(input) }];
  const body = {
    systemInstruction: { parts: [{ text: spec.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: spec.maxOutputTokens,
      responseMimeType: "application/json",
      responseJsonSchema: spec.schema,
    },
  };
  const upstream = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (upstream.status === 429) {
    const detail = await upstream.text().catch(() => "");
    const err = new Error(/PerDay/i.test(detail) ? "daily" : "minute");
    err.busy = true;
    throw err;
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    throw new Error(`model ${model} responded ${upstream.status}: ${detail.slice(0, 300)}`);
  }
  const data = await upstream.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("").trim();
  if (!text) throw new Error(`model ${model} returned no text`);
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Use POST." });
  }
  const key = process.env.JUNCTION_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "The AI isn't set up on this server." });

  const task = typeof req.body?.task === "string" ? req.body.task : "";
  const spec = Object.prototype.hasOwnProperty.call(TASKS, task) ? TASKS[task] : null;
  if (!spec) return res.status(400).json({ ok: false, error: "Unknown task." });
  const input = req.body?.input ?? {};
  if (JSON.stringify(input).length > spec.maxInputBytes) return res.status(413).json({ ok: false, error: "Input too large." });
  const inputProblem = spec.validateInput?.(input);
  if (inputProblem) return res.status(400).json({ ok: false, error: inputProblem });

  if (overVisitorLimit(req, task)) return res.status(429).json({ ok: false, busy: true, error: "Please wait a minute before asking again." });
  if (!(await underDailyCap(task))) return res.status(429).json({ ok: false, busy: true, error: "Today's AI allowance is used up. Showing a saved example." });

  // Try the main model, then the fallback; retry once on a failed output check.
  const attempts = [MODEL, MODEL, FALLBACK_MODEL];
  let lastError = "unknown";
  for (const model of attempts) {
    try {
      const out = await callModel(model, key, spec, input);
      const problem = spec.validate(input, out);
      if (problem) { lastError = problem; continue; }
      return res.status(200).json({ ok: true, data: out, model });
    } catch (err) {
      if (err.busy) return res.status(429).json({ ok: false, busy: true, error: "The AI is busy. Showing a saved example." });
      if (err.name === "TimeoutError" || err.name === "AbortError") { lastError = "timeout"; continue; }
      lastError = err.message;
      console.error(`Gemini task ${task} failed on ${model}:`, err.message);
    }
  }
  return res.status(502).json({ ok: false, error: "The AI couldn't give a checked answer. Showing a saved example.", detail: lastError.slice(0, 200) });
};
