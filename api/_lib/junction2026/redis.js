/**
 * Tiny Upstash Redis REST client shared by the Junction 2026 functions.
 * Lives under api/_lib, so Vercel does not deploy it as a function.
 *
 * Env (set by Vercel Storage > Upstash): UPSTASH_REDIS_REST_URL/TOKEN or
 * KV_REST_API_URL/TOKEN. Without them, `configured` is false and callers
 * fall back (the relay answers 503, the Gemini proxy skips its daily cap).
 */
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const configured = Boolean(URL_ && TOKEN);

async function redis(command) {
  if (!configured) throw new Error("Redis isn't configured.");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`store responded ${res.status}`);
  return (await res.json()).result;
}

/* Several commands in one round trip. Returns the results in order. */
async function pipeline(commands) {
  if (!configured) throw new Error("Redis isn't configured.");
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`store responded ${res.status}`);
  return (await res.json()).map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

module.exports = { configured, redis, pipeline };
