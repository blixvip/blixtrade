// Shared Helius project accounting. No credentials are persisted or included in errors.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA } from './db.js';
import { settings } from './settings.js';
import { createBudget, dailyAllowance, pacedAllowance, rpcCredits } from './metric-budget.js';

const clean = v => String(v || '').trim();
// Memoised: it ran on every stream message (new URL() each time was ~1 s a minute of the main thread, 2026-10-11).
const keyMemo = new Map();
const key = u => {
  let k = keyMemo.get(u);
  if (k === undefined) { try { k = new URL(u).searchParams.get('api-key') || u.replace(/^ws/i, 'http'); } catch { k = u; } if (keyMemo.size > 200) keyMemo.clear(); keyMemo.set(u, k); }
  return k;
};
const hash = v => crypto.createHash('sha256').update(v).digest('hex').slice(0, 24);
const day = () => new Date().toISOString().slice(0, 10);
const FILE = path.join(DATA, 'chartstream-usage.json');
export const keyUrls = () => [...new Map([clean(settings.chartWsUrl), clean(settings.chartWsUrl2)].filter(Boolean).map(u => [key(u), u])).values()];
const configured = () => [...new Set([...keyUrls(), ...[settings.rpcUrl, settings.rpcWsUrl].filter(u => /helius/i.test(u || '')).map(clean)])];
function project(url) {
  const k = key(url), first = clean(settings.chartWsUrl), second = clean(settings.chartWsUrl2);
  const id = k === key(first) ? clean(settings.heliusProjectId) : k === key(second) ? clean(settings.heliusProjectId2) : clean(settings.heliusProjectId);
  // Until project ownership is known, keys conservatively share one allowance.
  return hash(id ? `project:${id}` : 'unverified-project');
}
const state = new Map();
const identities = new Map();
const migrations = new Set();
export const budgetBytes = () => Math.max(0, Number(settings.chartDailyMB ?? 1400)) * 1e6;
export const budgetCredits = () => Math.floor(budgetBytes() / 50_000);
const creditsOf = s => s.bytes / 50_000 + s.callCredits;
function st(url) {
  const id = project(url);
  let s = state.get(id);
  const alias = hash(key(url)), previous = identities.get(alias);
  const migration = `${previous}:${id}`;
  if (previous && previous !== id && state.has(previous) && !migrations.has(migration)) {
    migrations.add(migration);
    const old = state.get(previous);
    if (!s) { s = { ...old, budget: null, priorities: old.budget?.status().byPriority || old.priorities }; state.set(id, s); }
    else if (s !== old) { s.bytes += old.bytes; s.calls += old.calls; s.callCredits += old.callCredits; s.budget = null; }
  }
  identities.set(alias, id);
  if (!s) { s = { day: day(), bytes: 0, calls: 0, callCredits: 0, byMethod: {}, monthPct: null, monthUntil: 0, denied: 0, coolingUntil: 0 }; state.set(id, s); }
  if (s.day !== day()) { s.day = day(); s.bytes = 0; s.calls = 0; s.callCredits = 0; s.byMethod = {}; s.spentAtRead = 0; s.budget = null; s.priorities = {}; s.monthDaily = undefined; }
  return s;
}
export function dayBudget(url) {
  const s = st(url);
  return Math.min(s.monthDaily ?? Infinity, dailyAllowance({ configured: budgetCredits(), remaining: s.remaining, limit: s.limit, resetAt: s.monthUntil, spent: s.spentAtRead || 0 }));
}
const paced = url => pacedAllowance({ daily: dayBudget(url) });
function budget(url) {
  const s = st(url);
  return s.budget ||= createBudget({ allowance: () => paced(url), spent: creditsOf(s), byPriority: s.priorities, rate: 8 });
}
export const dayUsed = url => creditsOf(st(url)) + (st(url).budget?.status().reserved || 0) >= paced(url);
// An expired reset date alone is not evidence that credits have reset.
export const monthUsed = url => { const s = st(url); return s.monthPct != null && s.monthPct >= 97; };
export const keyFree = url => Boolean(url) && !dayUsed(url) && !monthUsed(url) && st(url).coolingUntil <= Date.now();
export const activeUrl = () => keyUrls().find(keyFree) || '';
// The open charts' price streams (chartstream.js: the trade, side and fast sockets) are measured by what price itself
// has spent against the allowance earned so far, not by everything spent: background metric streams overspent the
// early-day allowance and shut the charts' streams for hours, leaving open charts on polls 5-15 s behind (2026-10-12,
// 03:38 UTC; key 2 had 826K credits left for the month). Price still never spends past what has been earned, metrics
// are held to a quarter at admission, and each day's allowance comes from what is left of the month (dayBudget).
const priceUsed = s => (s.budget?.status().byPriority?.price ?? s.priorities?.price ?? 0);
export const priceDayUsed = url => { const s = st(url); return priceUsed(s) + (s.budget?.status().reserved || 0) >= paced(url); };
export const priceKeyFree = url => Boolean(url) && !priceDayUsed(url) && !monthUsed(url) && st(url).coolingUntil <= Date.now();
export const priceUrl = () => keyUrls().find(priceKeyFree) || '';
export const allPriceSpent = () => anyKey() && !priceUrl();
export const keyIndex = url => keyUrls().findIndex(u => key(u) === key(url)) + 1;
export const anyKey = () => keyUrls().length > 0;
export const allSpent = () => anyKey() && !activeUrl();
export function noteBytes(url, bytes, priority = 'price') {
  if (!url || !Number.isFinite(bytes) || bytes <= 0) return;
  const s = st(url), b = budget(url); s.bytes += bytes; b.note(bytes / 50_000, priority);
}
const wsOf = url => configured().find(u => key(u) === key(String(url))) || '';
export const priceStreamAllowed = url => {
  const u = wsOf(url);
  return u ? keyFree(u) : Boolean(url) && !/^wss?:\/\/[^/]*helius(?:-rpc)?\.(?:com|xyz)\b/i.test(url);
};
export function notePriceBytes(url, bytes) { const u = wsOf(url); if (u) noteBytes(u, bytes); }
export const rpcStreamAllowed = url => {
  const u = wsOf(url); if (!u) return Boolean(url) && !/^wss?:\/\/[^/]*helius(?:-rpc)?\.(?:com|xyz)\b/i.test(url);
  const status = budget(u).status(), cap = paced(u), usage = status.byPriority;
  return keyFree(u) && status.spent + status.reserved < cap * .8 && usage.metrics + usage.history < cap * .25;
};
export function noteRpcBytes(url, bytes) { const u = wsOf(url); if (u) noteBytes(u, bytes, 'metrics'); }
export function noteCall(url, method) {
  const u = wsOf(url); if (!u) return;
  const s = st(u), cost = rpcCredits(method);
  s.calls++; s.callCredits += cost; s.budget?.note(cost); s.byMethod[method] = (s.byMethod[method] || 0) + 1;
}
export function markMonth(url, pct, resetAt, usage = {}) {
  const s = st(url), limit = Number(usage.limit) || Number(settings.heliusMonthCredits) || 1_000_000;
  if (resetAt > s.monthUntil && s.monthUntil > 0) s.monthDaily = undefined;
  s.monthPct = pct; s.monthUntil = Number.isFinite(resetAt) ? resetAt : Date.now() + 864e5;
  s.limit = limit; s.remaining = Number.isFinite(usage.remaining) ? usage.remaining : limit * (1 - pct / 100);
  s.spentAtRead = creditsOf(s); s.reportedAt = Date.now();
  s.monthDaily = Math.min(s.monthDaily ?? Infinity, dailyAllowance({ configured: budgetCredits(), remaining: s.remaining, limit: s.limit, resetAt: s.monthUntil, spent: s.spentAtRead }));
  saveUsage();
}
export function keyStatus(url) {
  const s = st(url);
  const cap = dayBudget(url), t = Date.now(), start = Math.floor(t / 864e5) * 864e5, resetAt = start + 864e5;
  const reserved = s.budget?.status().reserved || 0, spent = creditsOf(s) + reserved;
  const earnedAt = cap > 0 && spent + 1 < cap * .9 ? start + Math.ceil((spent + 1) / (cap * .9) * (864e5 + 300_000)) - 300_000 : resetAt;
  // Monthly exhaustion needs a fresh provider report; never promise a reset from a date alone.
  const nextResumeAt = monthUsed(url) ? null : Math.max(t, s.coolingUntil, dayUsed(url) ? earnedAt : t);
  return { index: keyIndex(url), project: project(url), bytesToday: s.bytes, callsToday: s.calls, creditsToday: Math.ceil(creditsOf(s)), dayBudget: Math.floor(cap), allowedNow: Math.floor(paced(url)), dayUsed: dayUsed(url), monthPct: s.monthPct, monthUsed: monthUsed(url), active: activeUrl() === url, byMethod: s.byMethod, denied: s.denied, coolingUntil: s.coolingUntil, reserved, byPriority: s.budget?.status().byPriority || {}, resetAt, nextResumeAt, sustainablePerHour: cap * .9 / (24 + 5 / 60), reserveCredits: cap * .1 };
}
export const bytesToday = () => [...new Map(configured().map(u => [project(u), st(u)])).values()].reduce((n, s) => n + s.bytes, 0);
function denied() { const e = new Error('Helius request deferred: shared project budget or rate limit'); e.code = 'HELIUS_BUDGET'; return e; }
const priorityOf = method => /^(getTransactionsForAddress|getTransaction|getSignaturesForAddress|getBlock)$/.test(method) ? 'history' : /^(getAccountInfo|getMultipleAccounts|getTokenSupply|sendTransaction|simulateTransaction|getLatestBlockhash)$/.test(method) ? 'price' : 'metrics';
export async function heliusFetch(input, init) {
  const target = input instanceof Request ? input.url : String(input), url = wsOf(target);
  if (!url) {
    if (/^https?:\/\/[^/]*helius(?:-rpc)?\.(?:com|xyz)\b/i.test(target)) throw new Error('Unregistered Helius endpoint: request not admitted');
    return globalThis.fetch(input, init);
  }
  let rows;
  try { const body = JSON.parse(init?.body ?? (input instanceof Request ? await input.clone().text() : '')); rows = Array.isArray(body) ? body : [body]; } catch { throw new Error('Helius RPC requires a metered JSON request'); }
  if (!rows.length || rows.some(x => !x || typeof x.method !== 'string')) throw new Error('Invalid Helius RPC request');
  const s = st(url);
  if (!keyFree(url)) { s.denied++; throw denied(); }
  const reservations = [];
  for (const row of rows) {
    const cost = rpcCredits(row.method, row.params), ticket = budget(url).reserve({ cost, priority: priorityOf(row.method) });
    if (!ticket) { for (const r of reservations) r.ticket.cancel(); s.denied++; throw denied(); }
    reservations.push({ row, cost, ticket });
  }
  const settle = results => {
    for (const { row, cost, ticket } of reservations) {
      const answer = results?.find(x => x?.id === row.id);
      const actual = answer ? rpcCredits(row.method, row.params, answer.result, { failed: Boolean(answer.error) }) : cost;
      ticket.settle(actual); s.calls++; s.callCredits += actual; s.byMethod[row.method] = (s.byMethod[row.method] || 0) + 1;
    }
    saveUsage();
  };
  // Persist the reservation before dispatch: a crash may overcount, but cannot erase a billed request.
  if (!saveUsage()) { for (const r of reservations) r.ticket.cancel(); throw new Error('Helius request deferred: usage ledger unavailable'); }
  let response;
  try { response = await globalThis.fetch(input, init); }
  catch { settle(); const e = new Error('Helius transport failed; reserved credits retained'); e.code = 'HELIUS_TRANSPORT'; throw e; }
  if (response.status === 429) {
    const header = response.headers.get('retry-after'), retry = header == null ? NaN : Number(header);
    const wait = Number.isFinite(retry) ? retry * 1000 : Date.parse(header || '') - Date.now();
    s.coolingUntil = Date.now() + Math.max(1000, Number.isFinite(wait) ? wait : 5000);
  }
  let results;
  try { const answer = await response.clone().json(); results = Array.isArray(answer) ? answer : [answer]; } catch {}
  settle(results);
  return response;
}
let loaded = false;
export function loadUsage() {
  if (loaded) return; loaded = true;
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (data.projects) {
      for (const [id, v] of Object.entries(data.projects)) state.set(id, { ...v, budget: null });
      for (const [alias, id] of Object.entries(data.identities || {})) identities.set(alias, id);
      // Migrate v2 ledgers predating persisted aliases conservatively; unknown keys shared this pot.
      const unverified = hash('unverified-project');
      for (const u of configured()) {
        const alias = hash(key(u));
        if (!identities.has(alias) && state.has(unverified)) identities.set(alias, unverified);
        st(u);
      }
    } else if (data.day === day()) {
      const restored = new Set();
      for (const u of keyUrls()) { const tag = u.slice(-8); if (restored.has(tag)) continue; restored.add(tag); const v = data.keys?.[tag]; const s = st(u); if (typeof v === 'number') s.bytes += v; else if (v) { s.bytes += +v.bytes || 0; s.calls += +v.calls || 0; s.callCredits += +v.callCredits || 0; Object.assign(s.byMethod, v.byMethod); } }
      if (!data.keys && data.bytes && keyUrls()[0]) st(keyUrls()[0]).bytes = +data.bytes || 0;
    }
  } catch {}
}
let saved = '';
export function saveUsage() {
  const projects = Object.fromEntries(configured().map(u => { const s = st(u), { budget: b, ...rest } = s; const bs = b?.status(); const priorities = bs ? Object.fromEntries(Object.entries(bs.byPriority).map(([k, v]) => [k, v + bs.pending[k]])) : s.priorities; return [project(u), { ...rest, priorities, callCredits: s.callCredits + (bs?.reserved || 0) }]; }));
  const text = JSON.stringify({ version: 2, day: day(), projects, identities: Object.fromEntries(identities) });
  if (text === saved) return true;
  try { fs.writeFileSync(FILE + '.tmp', text); fs.renameSync(FILE + '.tmp', FILE); saved = text; return true; } catch { return false; }
}
loadUsage();
