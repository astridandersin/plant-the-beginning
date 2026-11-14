/**
 * Best-effort per-visitor rate limit, kept in memory like api/ask.js.
 * It resets when the function instance restarts, which is fine for a demo:
 * it only stops one person from hammering an endpoint.
 */
function visitorId(req) {
  const forwarded = req.headers && req.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || "").split(",")[0].trim() || "unknown";
}

function makeLimiter(limit, windowMs) {
  const hits = new Map();
  return function overLimit(req, scope = "") {
    const key = `${scope}|${visitorId(req)}`;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    const over = recent.length >= limit;
    if (!over) recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return over;
  };
}

module.exports = { visitorId, makeLimiter };
