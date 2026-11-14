/**
 * /api/junction2026/health: is the Junction backend set up? Reports only yes/no
 * for each setting, never a value, so it is safe to open in a browser.
 */
const { configured: hasRedis } = require("../_lib/junction2026/redis");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Use GET." });
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    storage: hasRedis,                                          // Upstash Redis for the lamp relay
    device_token: Boolean(process.env.DEVICE_TOKEN),           // lets the lamp post events
    gemini: Boolean(process.env.JUNCTION_GEMINI_API_KEY || process.env.GEMINI_API_KEY),
    gemini_key: process.env.JUNCTION_GEMINI_API_KEY ? "junction" : (process.env.GEMINI_API_KEY ? "portfolio" : "none"),
    gemini_daily_cap: Number(process.env.JUNCTION_GEMINI_DAILY_CAP) || 400,
  });
};
