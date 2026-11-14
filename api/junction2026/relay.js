/**
 * Device relay for the Junction 2026 products: /api/junction2026/relay
 *
 * Gets live hardware events onto the hosted HTTPS page, and page commands back
 * to the hardware, in one round trip. Only the Dawn lamp uses it (channel "dawn");
 * Pathway Lens has no hardware.
 *
 * Device (UNO Q Python side):
 *   POST  header "x-device-token: <DEVICE_TOKEN>"
 *         body { channel: "dawn", events: [{...}, ...] }   (up to 50 flat objects)
 *     ->  { ok, stored, cmds: [{ cmd, at }] }   pending page commands, oldest first
 *
 * Page:
 *   GET   ?channel=dawn[&since=<ms>]  ->  { ok, now, readings: [{ t, ...fields }] }
 *         CDN-cached for 1 s so many judges cost about one store read a second.
 *   POST  body { channel: "dawn", cmd: "<allowlisted command>" }  ->  { ok, queued }
 *         At most one command per 2 s per visitor.
 *
 * Reset (before a demo):
 *   DELETE ?channel=dawn  header "x-device-token: <DEVICE_TOKEN>"  ->  { ok, cleared }
 *         Empties the channel's history and pending commands. Same token as the device.
 *
 * Storage: Upstash Redis (see api/_lib/junction2026/redis.js). Routine events
 * (type "reading" or "status") keep the last 300; everything else (check-ins,
 * day summaries, watering...) keeps the last 1000, so two weeks of history
 * survive. At most 20 pending commands. Reading is public,
 * like the page itself, so never send anything private through it.
 */
const { configured, redis, pipeline } = require("../_lib/junction2026/redis");
const { makeLimiter } = require("../_lib/junction2026/limits");

const CHANNELS = {
  dawn: {
    commands: new Set(["checkin_low", "checkin_ok", "checkin_good", "scene_dawn", "replay14"]),
  },
};
const KEEP = 300;          // routine readings
const KEEP_LOG = 1000;     // check-ins, day summaries and other events
const ROUTINE = new Set(["reading", "status"]);
const MAX_PENDING = 20;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN;

const pageCommandLimit = makeLimiter(1, 2000);

// Events are small flat objects: numbers, short strings, booleans.
function clean(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const out = {};
  for (const [k, v] of Object.entries(r).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,30}$/i.test(k)) return null;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string" && v.length <= 200) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else return null;
  }
  return Object.keys(out).length ? out : null;
}

// Per-instance write limit for the device: 20 writes a second is plenty.
let windowStart = 0, writes = 0;
function deviceTooFast() {
  const now = Date.now();
  if (now - windowStart > 1000) { windowStart = now; writes = 0; }
  return ++writes > 20;
}

const keys = (channel) => ({
  events: `junction2026:${channel}:events`,
  log: `junction2026:${channel}:log`,
  cmds: `junction2026:${channel}:cmd`,
});

module.exports = async function handler(req, res) {
  if (!configured) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ ok: false, error: "Relay storage isn't set up." });
  }
  const channel = String((req.method === "POST" ? req.body?.channel : req.query?.channel) || "dawn");
  if (!CHANNELS[channel]) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ ok: false, error: "Unknown channel." });
  }
  const k = keys(channel);

  if (req.method === "GET") {
    const since = Number(req.query?.since) || 0;
    try {
      const [routine, log] = await pipeline([
        ["LRANGE", k.events, "0", String(KEEP - 1)],
        ["LRANGE", k.log, "0", String(KEEP_LOG - 1)],
      ]);
      const rows = [...(routine || []), ...(log || [])].map((s) => JSON.parse(s)).sort((a, b) => a.t - b.t);
      res.setHeader("Cache-Control", since ? "no-store" : "public, s-maxage=1, stale-while-revalidate=2");
      return res.status(200).json({ ok: true, now: Date.now(), readings: rows.filter((r) => r.t > since) });
    } catch (err) {
      console.error("Relay read failed:", err.message);
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({ ok: false, error: "Couldn't read events." });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  if (req.method === "DELETE") {
    if (!DEVICE_TOKEN || req.headers["x-device-token"] !== DEVICE_TOKEN) {
      return res.status(401).json({ ok: false, error: "Not allowed." });
    }
    try {
      const [cleared] = await pipeline([["DEL", k.events, k.log, k.cmds]]);
      return res.status(200).json({ ok: true, cleared });
    } catch (err) {
      console.error("Relay reset failed:", err.message);
      return res.status(502).json({ ok: false, error: "Couldn't clear the history." });
    }
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "Use GET, POST or DELETE." });
  }
  if (JSON.stringify(req.body ?? null).length > 64 * 1024) {
    return res.status(413).json({ ok: false, error: "Too large." });
  }

  // Page command: no token, but allowlisted and rate-limited.
  if (typeof req.body?.cmd === "string") {
    const cmd = req.body.cmd;
    if (!CHANNELS[channel].commands.has(cmd)) return res.status(400).json({ ok: false, error: "Unknown command." });
    if (pageCommandLimit(req, channel)) return res.status(429).json({ ok: false, error: "One command every 2 seconds, please." });
    try {
      const [len] = await pipeline([
        ["RPUSH", k.cmds, JSON.stringify({ cmd, at: Date.now() })],
        ["LTRIM", k.cmds, String(-MAX_PENDING), "-1"],
        ["EXPIRE", k.cmds, "120"],
      ]);
      return res.status(200).json({ ok: true, queued: Math.min(len, MAX_PENDING) });
    } catch (err) {
      console.error("Relay command failed:", err.message);
      return res.status(502).json({ ok: false, error: "Couldn't queue the command." });
    }
  }

  // Device write: needs the token.
  if (!DEVICE_TOKEN || req.headers["x-device-token"] !== DEVICE_TOKEN) {
    return res.status(401).json({ ok: false, error: "Not allowed." });
  }
  if (deviceTooFast()) return res.status(429).json({ ok: false, error: "Too many writes; send at most 20 a second." });
  const raw = Array.isArray(req.body?.events) ? req.body.events : [];
  const list = raw.slice(0, 50).map(clean);
  if (list.some((r) => !r)) return res.status(400).json({ ok: false, error: "Events must be flat objects of numbers, short strings or booleans." });
  const now = Date.now();
  try {
    const commands = [
      ["LRANGE", k.cmds, "0", "4"],
      ["LTRIM", k.cmds, "5", "-1"],
    ];
    const stamped = list.map((r, i) => ({ t: now + i, ...r }));
    const routine = stamped.filter((r) => ROUTINE.has(r.type));
    const logged = stamped.filter((r) => !ROUTINE.has(r.type));
    if (routine.length) {
      commands.push(["LPUSH", k.events, ...routine.map((r) => JSON.stringify(r))]);
      commands.push(["LTRIM", k.events, "0", String(KEEP - 1)]);
    }
    if (logged.length) {
      commands.push(["LPUSH", k.log, ...logged.map((r) => JSON.stringify(r))]);
      commands.push(["LTRIM", k.log, "0", String(KEEP_LOG - 1)]);
    }
    const [pending] = await pipeline(commands);
    return res.status(200).json({ ok: true, stored: list.length, cmds: (pending || []).map((s) => JSON.parse(s)) });
  } catch (err) {
    console.error("Relay write failed:", err.message);
    return res.status(502).json({ ok: false, error: "Couldn't store events." });
  }
};
