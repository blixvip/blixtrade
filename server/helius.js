// Helius credits: how much of the month's allowance each key has used and when it resets, read from Helius's
// own Admin API (admin-api.helius.xyz, 5 requests/s) every ten minutes, so the Health page can say "62% left,
// resets Nov 1" instead of only counting bytes, and so heliuskeys.js rests a key before Helius cuts it off.
// The usage endpoint needs the project's ID next to the key (settings.heliusProjectId / heliusProjectId2);
// the key alone is refused with "Invalid project id".
import { settings } from "./settings.js";
import * as health from "./health.js";
import { keyUrls, markMonth, keyStatus } from "./heliuskeys.js";

const EVERY_MS = 10 * 60_000;
const byUrl = new Map();        // ws url -> { fetchedAt, error, usage }

const keyOf = (u) => (String(u || "").match(/api-key=([^&\s]+)/i) || [])[1] || "";
// The keys to read: the chart keys in order, else the RPC URL when it is a Helius one (the Vault's PC).
function slots() {
  const out = [];
  const urls = keyUrls();
  if (urls[0]) out.push({ url: urls[0], key: keyOf(urls[0]), projectId: String(settings.heliusProjectId || "").trim(), index: 1 });
  if (urls[1]) out.push({ url: urls[1], key: keyOf(urls[1]), projectId: String(settings.heliusProjectId2 || "").trim(), index: 2 });
  if (!out.length && /helius/i.test(String(settings.rpcUrl || ""))) out.push({ url: String(settings.rpcUrl).trim(), key: keyOf(settings.rpcUrl), projectId: String(settings.heliusProjectId || "").trim(), index: 1 });
  return out.filter((s) => s.key);
}

async function readUsage(slot) {
  const st = byUrl.get(slot.url) || { fetchedAt: 0, error: null, usage: null };
  byUrl.set(slot.url, st);
  if (!slot.projectId) { st.error = null; return st; }
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15_000);
    const r = await fetch(`https://admin-api.helius.xyz/v0/admin/projects/${encodeURIComponent(slot.projectId)}/usage`, { headers: { "X-Api-Key": slot.key, accept: "application/json" }, signal: ac.signal }).finally(() => clearTimeout(t));
    const body = await r.text();
    if (!r.ok) { let msg = body.slice(0, 160); try { msg = JSON.parse(body).message || msg; } catch {} throw new Error(`${r.status} ${msg}`); }
    const j = JSON.parse(body);
    const limit = +j.subscriptionDetails?.creditsLimit || (+j.creditsUsed || 0) + (+j.creditsRemaining || 0);
    const used = +j.creditsUsed || 0, remaining = j.creditsRemaining != null ? +j.creditsRemaining : Math.max(0, limit - used);
    const cycle = j.creditCycle || j.subscriptionDetails?.billingCycle || {};
    // Cycle dates are plain days (UTC); the reset is the start of the end day.
    const resetAt = cycle.end ? Date.parse(`${String(cycle.end).slice(0, 10)}T00:00:00Z`) : null;
    const pctUsed = limit ? Math.round((used / limit) * 1000) / 10 : null;
    st.usage = { used, remaining, limit, pctUsed, plan: j.subscriptionDetails?.plan || "", cycleStart: cycle.start || null, cycleEnd: cycle.end || null, resetAt: Number.isFinite(resetAt) ? resetAt : null, prepaidRemaining: +j.prepaidCreditsRemaining || 0, byService: j.credits || null };
    st.fetchedAt = Date.now(); st.error = null;
    if (pctUsed != null) markMonth(slot.url, pctUsed, st.usage.resetAt, st.usage);
    health.ok("helius");
  } catch (e) {
    st.error = String(e?.message || e).slice(0, 200);
    health.fail("helius", e);
  }
  return st;
}

export async function refreshHelius() {
  for (const slot of slots()) await readUsage(slot);
}

// One entry per key, in order: what Helius says about its month plus what the stream counted today.
export function heliusStatus() {
  return slots().map((slot) => {
    const st = byUrl.get(slot.url) || { fetchedAt: 0, error: null, usage: null };
    return { index: slot.index, projectId: slot.projectId, fetchedAt: st.fetchedAt, error: st.error, usage: st.usage ? { ...st.usage } : null, key: keyStatus(slot.url) };
  });
}

let timer = null;
export function startHelius() {
  if (timer) return;
  refreshHelius();
  timer = setInterval(refreshHelius, EVERY_MS);
  timer.unref?.();
}
