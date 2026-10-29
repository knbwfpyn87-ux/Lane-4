/* Lane 4 Worker (Cloudflare): Strava sync, race-day push reminders, and small AI tweaks to premade workouts.
   Setup steps are in worker/README.md.
   Secrets live only in Cloudflare (Settings → Variables and Secrets). Never paste them into this file: the repo is public.

   Needs:
     D1 database bound as DB
     Workers AI bound as AI (free daily allowance)
     Variables: APP_URL (e.g. https://knbwfpyn87-ux.github.io/Lane-4/), STRAVA_CLIENT_ID
     Secret:    STRAVA_CLIENT_SECRET
     Cron trigger: * * * * *  (sends due reminders every minute)
*/

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)",
  "CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, created INTEGER)",
  "CREATE TABLE IF NOT EXISTS strava (sid TEXT PRIMARY KEY, athlete INTEGER, access TEXT, refresh TEXT, expires INTEGER, created INTEGER)",
  "CREATE TABLE IF NOT EXISTS reminders (endpoint TEXT, at INTEGER, p256dh TEXT, auth TEXT, title TEXT, body TEXT, PRIMARY KEY (endpoint, at))",
  "CREATE TABLE IF NOT EXISTS ai_cache (k TEXT PRIMARY KEY, v TEXT, created INTEGER)",
];
let ready = null;
function ensure(env) { return ready ||= env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); }

/* Push services this Worker will deliver to. Anything else is refused so the Worker can't be used to hit other sites. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const MAX_STEPS = 20, MAX_AHEAD = 30 * 24 * 3600e3;

/* ---------- helpers ---------- */
const enc = new TextEncoder();
function b64u(buf) { let s = ""; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); const b = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); }
function concat(...parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function randomId(n = 32) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
function appOrigin(env) { return new URL(env.APP_URL).origin; }
function cors(env) { return { "Access-Control-Allow-Origin": appOrigin(env), "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", "Vary": "Origin" }; }
function json(env, data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors(env) } }); }
function backToApp(env, hash) { return Response.redirect(env.APP_URL + "#" + hash, 302); }
function bearer(req) { const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+([\w-]{20,})$/); return m ? m[1] : null; }

/* ---------- web push (RFC 8291 payload encryption, RFC 8292 VAPID) ---------- */
async function vapidKeys(env) {
  const row = await env.DB.prepare("SELECT v FROM config WHERE k = 'vapid'").first();
  if (row) return JSON.parse(row.v);
  /* first run: make this Worker's own key pair and keep it in D1 */
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
  await env.DB.prepare("INSERT OR IGNORE INTO config (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(keys)).run();
  return JSON.parse((await env.DB.prepare("SELECT v FROM config WHERE k = 'vapid'").first()).v);
}
async function vapidHeader(env, endpoint) {
  const keys = await vapidKeys(env);
  const key = await crypto.subtle.importKey("jwk", keys.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.CONTACT_EMAIL ? "mailto:" + env.CONTACT_EMAIL : env.APP_URL })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.pub}`;
}
async function hmac(key, data) { const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, data)); }
async function encryptPayload(p256dh, auth, text) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hmac(await hmac(authSecret, ecdh), concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(text), [2])));
  return concat(salt, [0, 0, 16, 0], [asPublic.length], asPublic, sealed);
}
async function sendPush(env, r) {
  const body = await encryptPayload(r.p256dh, r.auth, JSON.stringify({ title: r.title, body: r.body }));
  return fetch(r.endpoint, { method: "POST", body, headers: {
    "Authorization": await vapidHeader(env, r.endpoint), "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream", "TTL": "900", "Urgency": "high" } });
}
function okEndpoint(u) { try { const x = new URL(u); return x.protocol === "https:" && PUSH_HOSTS.some(h => h.test(x.hostname)); } catch { return false; } }

async function schedule(req, env) {
  const { subscription: s, steps } = await req.json().catch(() => ({}));
  if (!s || !okEndpoint(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth || !Array.isArray(steps)) return json(env, { error: "bad request" }, 400);
  const now = Date.now();
  const due = steps.filter(x => x && Number.isFinite(x.at) && x.at > now && x.at < now + MAX_AHEAD).slice(0, MAX_STEPS);
  const stmts = [env.DB.prepare("DELETE FROM reminders WHERE endpoint = ?").bind(s.endpoint)];
  for (const x of due) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO reminders (endpoint, at, p256dh, auth, title, body) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(s.endpoint, Math.round(x.at), s.keys.p256dh, s.keys.auth, String(x.title || "Lane 4").slice(0, 80), String(x.body || "").slice(0, 200)));
  await env.DB.batch(stmts);
  return json(env, { scheduled: due.length });
}
async function cancel(req, env) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (!okEndpoint(endpoint)) return json(env, { error: "bad request" }, 400);
  await env.DB.prepare("DELETE FROM reminders WHERE endpoint = ?").bind(endpoint).run();
  return json(env, { ok: true });
}
async function sendDue(env) {
  await ensure(env);
  const now = Date.now();
  const { results } = await env.DB.prepare("SELECT * FROM reminders WHERE at <= ? ORDER BY at LIMIT 200").bind(now).all();
  const gone = new Set();
  await Promise.all(results.map(async r => {
    if (now - r.at > 10 * 60e3) return; /* too late to be useful; just drop it */
    try { const res = await sendPush(env, r); if (res.status === 404 || res.status === 410) gone.add(r.endpoint); } catch {}
  }));
  const stmts = [env.DB.prepare("DELETE FROM reminders WHERE at <= ?").bind(now), env.DB.prepare("DELETE FROM oauth_state WHERE created < ?").bind(now - 3600e3), env.DB.prepare("DELETE FROM ai_cache WHERE created < ?").bind(now - 30 * 864e5)];
  gone.forEach(e => stmts.push(env.DB.prepare("DELETE FROM reminders WHERE endpoint = ?").bind(e)));
  await env.DB.batch(stmts);
}

/* ---------- Strava ---------- */
async function stravaStart(req, env) {
  const state = randomId(24);
  await env.DB.prepare("INSERT INTO oauth_state (state, created) VALUES (?, ?)").bind(state, Date.now()).run();
  const u = new URL("https://www.strava.com/oauth/authorize");
  u.search = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, redirect_uri: new URL("/strava/callback", req.url).href, response_type: "code", approval_prompt: "auto", scope: "activity:read_all", state });
  return Response.redirect(u.href, 302);
}
async function stravaCallback(req, env) {
  const q = new URL(req.url).searchParams, state = q.get("state") || "";
  const known = await env.DB.prepare("DELETE FROM oauth_state WHERE state = ? RETURNING state").bind(state).first();
  if (!known) return backToApp(env, "strava-error=expired");
  if (q.get("error") || !q.get("code")) return backToApp(env, "strava-error=denied");
  if (!/activity:read/.test(q.get("scope") || "")) return backToApp(env, "strava-error=scope");
  const res = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, code: q.get("code"), grant_type: "authorization_code" }) });
  if (!res.ok) return backToApp(env, "strava-error=token");
  const t = await res.json(), sid = randomId();
  await env.DB.prepare("INSERT INTO strava (sid, athlete, access, refresh, expires, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sid, t.athlete ? t.athlete.id : null, t.access_token, t.refresh_token, t.expires_at, Date.now()).run();
  return backToApp(env, "strava=" + sid);
}
async function stravaToken(env, sid) {
  const row = await env.DB.prepare("SELECT * FROM strava WHERE sid = ?").bind(sid).first();
  if (!row) return null;
  if (row.expires * 1000 > Date.now() + 60e3) return row.access;
  const res = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: row.refresh }) });
  if (!res.ok) { if (res.status === 400 || res.status === 401) await env.DB.prepare("DELETE FROM strava WHERE sid = ?").bind(sid).run(); return null; }
  const t = await res.json();
  await env.DB.prepare("UPDATE strava SET access = ?, refresh = ?, expires = ? WHERE sid = ?").bind(t.access_token, t.refresh_token, t.expires_at, sid).run();
  return t.access_token;
}
async function stravaActivities(req, env) {
  const sid = bearer(req); const token = sid && await stravaToken(env, sid);
  if (!token) return json(env, { error: "not connected" }, 401);
  const after = Math.max(0, parseInt(new URL(req.url).searchParams.get("after") || "0", 10) || 0);
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}&after=${after}`, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 429) return json(env, { error: "Strava is busy. Try again in 15 minutes." }, 429);
    if (!res.ok) return json(env, { error: "Strava error" }, 502);
    const list = await res.json();
    list.forEach(a => out.push({ id: a.id, name: a.name, type: a.sport_type || a.type, date: a.start_date_local, moving: a.moving_time, elapsed: a.elapsed_time, meters: a.distance }));
    if (list.length < 100) break;
  }
  return json(env, { activities: out });
}
async function stravaDisconnect(req, env) {
  const sid = bearer(req); const token = sid && await stravaToken(env, sid);
  if (token) await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(() => {});
  if (sid) await env.DB.prepare("DELETE FROM strava WHERE sid = ?").bind(sid).run();
  return json(env, { ok: true });
}

/* ---------- AI workout tweak, on Cloudflare's free Workers AI allowance (requests just fail past the daily limit; nothing is billed).
   The AI may only nudge a premade workout, and it sees only: the workout, the athlete's events, their sore spots, and their
   part of the season. Anything else in the request is dropped. The caps are enforced here and again in the app (clampAdj).
   Answers are cached in D1, so the same question never uses the free allowance twice. ---------- */
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const PHASES = { off: "off-season", pre: "pre-season", early: "early season", mid: "mid-season", champ: "championship season" };
const SORE = { hamstring: "hamstring", quad: "quad", calf: "calf or Achilles", shin: "shins", knee: "knee", foot: "foot or ankle", hip: "hip or groin", back: "back", arm: "shoulder or elbow" };
const AI_RULES = `You make a very small change to a high school track athlete's premade workout. You only consider three things: their events, their part of the season, and any sore spots. You never write new workouts, never write any text, and never give medical advice.
Reply with JSON only, no other text: {"sets":[...],"pct":0,"rest":0}
- "sets": one number per workout part, in order: -1 (one fewer rep), 0, or 1 (one more rep).
- "pct": change to the effort percent, a whole number from -3 to 3.
- "rest": change to rest in seconds: -30, -15, 0, 15, or 30.
Sore spots: make the workout a little easier (fewer reps, less effort, more rest), never harder.
Championship season: never add reps; trimming a rep keeps them fresh. Off-season: never raise effort.
Pre-season: one extra rep is fine for aerobic work if nothing is sore.
If the workout doesn't fit their events well, keep the changes small. When unsure, change nothing.`;
const clean = (v, n) => String(v || "").replace(/[^\w ’'.()-]/g, "").slice(0, n);
async function sha(s) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function aiAdjust(req, env) {
  if (!env.AI) return json(env, { error: "AI not set up" }, 503);
  const body = await req.json().catch(() => ({})), w = body.workout || {}, a = body.athlete || {};
  if (!Array.isArray(w.parts) || w.parts.length < 1 || w.parts.length > 6) return json(env, { error: "bad request" }, 400);
  const n = (v, hi) => Number.isFinite(+v) && v !== null ? Math.max(0, Math.min(hi, Math.round(+v))) : null;
  /* rebuild the request from allowed fields only */
  const workout = { id: clean(w.id, 20), parts: w.parts.map(p => ({ reps: n(p && p.reps, 50), meters: n(p && p.meters, 10000), effortPct: n(p && p.effortPct, 100), restSec: n(p && p.restSec, 1200) })) };
  const sore = [...new Set(Array.isArray(a.sore) ? a.sore.filter(s => SORE[s]) : [])];
  const athlete = { events: (Array.isArray(a.events) ? a.events : []).slice(0, 4).map(e => clean(e, 24)).filter(Boolean),
    partOfSeason: PHASES[a.phase] || "not set", sore: sore.map(s => SORE[s]) };
  const q = JSON.stringify({ workout, athlete }), key = await sha(AI_MODEL + AI_RULES + q);
  const hit = await env.DB.prepare("SELECT v FROM ai_cache WHERE k = ?").bind(key).first();
  if (hit) return json(env, JSON.parse(hit.v));
  const out = await env.AI.run(AI_MODEL, { messages: [{ role: "system", content: AI_RULES }, { role: "user", content: q }], max_tokens: 60, temperature: 0.1 });
  let r = out && out.response;
  if (typeof r !== "object" || !r) { const m = String(r || "").match(/\{[\s\S]*\}/); try { r = JSON.parse(m ? m[0] : ""); } catch { return json(env, { error: "no answer" }, 502); } }
  /* caps, and never harder when something is sore, no added reps at championships, no added effort in the off-season */
  const c = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0))), hurt = sore.length > 0, ph = a.phase;
  const ans = { sets: workout.parts.map((p, i) => (p.reps || 0) < 2 ? 0 : c(Array.isArray(r.sets) ? r.sets[i] : 0, -1, hurt || ph === "champ" ? 0 : 1)),
    pct: c(r.pct, -3, hurt || ph === "off" ? 0 : 3), rest: Math.round(c(r.rest, hurt ? 0 : -30, 30) / 15) * 15 };
  await env.DB.prepare("INSERT OR REPLACE INTO ai_cache (k, v, created) VALUES (?, ?, ?)").bind(key, JSON.stringify(ans), Date.now()).run();
  return json(env, ans);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    await ensure(env);
    const path = new URL(req.url).pathname, m = req.method;
    try {
      if (m === "GET" && path === "/push/key") return json(env, { key: (await vapidKeys(env)).pub });
      if (m === "POST" && path === "/push/schedule") return await schedule(req, env);
      if (m === "POST" && path === "/push/cancel") return await cancel(req, env);
      if (m === "GET" && path === "/strava/start") return await stravaStart(req, env);
      if (m === "GET" && path === "/strava/callback") return await stravaCallback(req, env);
      if (m === "GET" && path === "/strava/activities") return await stravaActivities(req, env);
      if (m === "POST" && path === "/strava/disconnect") return await stravaDisconnect(req, env);
      if (m === "POST" && path === "/ai/adjust") return await aiAdjust(req, env);
      if (m === "GET" && path === "/") return new Response("Lane 4 Worker is running.", { headers: { "Content-Type": "text/plain" } });
    } catch (e) { return json(env, { error: "server error" }, 500); }
    return json(env, { error: "not found" }, 404);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(sendDue(env)); },
};
