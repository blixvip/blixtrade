// Triage: rank every new pump.fun coin from the start so the slop never reaches the expensive models.
//   1. Instant rules score the moment a coin is created (dev history, copycat ticker, socials, metadata).
//   2. A fast LLM (Groq when a key is set, else Grok's fast model) labels batches of new coins in ~1-2s:
//      slop / meh / maybe / promising, with a short reason.
//   3. Coins labelled maybe+ (or that pick up real live trading) are escalated to the research desk,
//      where Grok searches X and grades them properly.
// Every label is checked against what the coin did next (live ATH within the hour) so we can see
// whether the triage actually separates slop from runners.
import { db, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { recentLaunches, devLaunches, launchLog, adoptLaunch } from "./engine.js";
import { getMeta } from "./pulse.js";
import { liveStats } from "./livetrades.js";
import { askFast, fastReady as groqReady } from "./fast.js";
import { askGrok, grokInstalled, grokBlocked } from "./grok.js";
import { ask, claudeStatus, FAST_MODEL } from "./ai.js";

// Which model can label launches right now: Groq, else Grok, else Claude Haiku on this PC's Claude login.
const llmFor = () => {
  if (!settings.triageOn) return null;
  if (groqReady() && settings.triageProvider !== "grok") return "groq";
  if (grokInstalled() && !grokBlocked() && settings.triageProvider !== "groq" && settings.fastProvider !== "claude") return "grok";
  return settings.claudeFast && claudeStatus().ready ? "claude" : null;
};

db.exec(`CREATE TABLE IF NOT EXISTS triage (
  mint TEXT PRIMARY KEY, t INTEGER, symbol TEXT, name TEXT, rules INTEGER, score INTEGER, label TEXT, why TEXT, model TEXT, ms INTEGER,
  mc0 REAL, ath REAL, escalated INTEGER DEFAULT 0, checked INTEGER
)`);
db.exec("CREATE INDEX IF NOT EXISTS triage_t ON triage(t)");

const now = () => Date.now();
const MIN = 60_000;
const mem = new Map();          // mint -> { rules, score, label, why, model, src }
const LABELS = ["slop", "meh", "maybe", "promising"];
export const triageStats = { batches: 0, coins: 0, lastMs: null, provider: null, lastError: null, escalated: 0 };
let enqueueFn = null;

// ---------- 1. instant rules ----------
const vowelless = (s) => s.length >= 5 && !/[aeiouy]/i.test(s);
function rulesScore(l, m) {
  let s = 40;
  const why = [];
  const dev = devLaunches.get(l.creator) || 1;
  if (dev >= 10) { s -= 30; why.push(`dev launched ${dev} coins in 6h`); } else if (dev >= 4) { s -= 15; why.push(`dev ×${dev}`); }
  const sym = String(l.symbol || "").toLowerCase();
  const sameTicker = sym ? launchLog.filter((x) => x.t > now() - 60 * MIN && String(x.symbol || "").toLowerCase() === sym).length : 0;
  if (sameTicker >= 5) { s -= 18; why.push(`${sameTicker} same-ticker launches this hour`); } else if (sameTicker >= 2) { s -= 6; }
  if (m?.twitter) { s += /\/status\//.test(m.twitter) ? 14 : 9; why.push(/\/status\//.test(m.twitter) ? "built on a tweet" : "has X"); }
  if (m?.website) s += 5;
  if (m?.telegram) s += 3;
  if (!m?.twitter && !m?.website && !m?.telegram && m && !m.failed) { s -= 8; why.push("no socials"); }
  if (m?.description && m.description.length > 30) s += 4; else if (m && !m.failed) s -= 4;
  if (m && !m.image && !m.failed) { s -= 10; why.push("no image"); }
  if (vowelless(sym) || /^[a-z]{1,2}\d{3,}$/i.test(sym)) { s -= 8; why.push("gibberish ticker"); }
  const dv = Number(l.devSol || 0);
  if (dv >= 0.5 && dv <= 4) s += 4; else if (dv > 15) { s -= 6; why.push(`dev bought ${dv.toFixed(0)} SOL`); }
  return { score: Math.max(0, Math.min(100, Math.round(s))), why: why.slice(0, 2).join(", ") };
}
const labelFor = (s) => s >= 70 ? "promising" : s >= 50 ? "maybe" : s >= 30 ? "meh" : "slop";

export function triageFor(mint) { return mem.get(mint) || null; }

// ---------- 2. fast LLM, batched ----------
const SYSTEM = `You triage brand-new Solana memecoins seconds after launch on pump.fun, for a trader who only wants to look at the few that could run.
For EACH coin give a 0-100 score and a label: "slop" (low-effort, copycat, gibberish, cash-grab, no meme), "meh" (generic, nothing special),
"maybe" (a real meme/joke/reference that could catch attention), "promising" (strong, timely, funny or tied to a live story/person/trend, with effort behind it).
Most launches are slop. Be harsh and fast. Judge the name, ticker, description and socials. A link to a specific tweet or a live news reference is a plus.
Reply with ONLY JSON: {"r":[{"i":<index>,"s":<0-100>,"l":"slop|meh|maybe|promising","w":"reason, max 8 words"}]}`;

// Small batches, two in flight: the model's output speed is the limit, so short answers come back fastest.
let inflight = 0;
async function batch() {
  if (inflight >= 2 || !settings.triageOn) return;
  const llm = llmFor(), useGroq = llm === "groq";
  if (!llm) return;
  // Wait ~6s after creation so metadata (description, socials) has loaded.
  const size = llm === "grok" ? 8 : 25;
  const pending = recentLaunches.filter((l) => !mem.get(l.mint)?.model && !mem.get(l.mint)?.inflight && now() - l.seen > 5000 && now() - l.seen < 10 * MIN).slice(-size);
  if (!pending.length) return;
  if (pending.length < 3 && now() - pending[0].seen < 12_000) return;   // let a small batch fill up
  // On the Claude login every call counts against the subscription: one call at a time, fuller batches.
  if (llm === "claude" && (inflight >= 1 || (pending.length < 15 && now() - pending[0].seen < 25_000))) return;
  inflight++;
  for (const l of pending) mem.set(l.mint, { ...(mem.get(l.mint) || {}), inflight: true });
  const items = pending.map((l, i) => {
    const m = getMeta(l.mint) || {};
    return { i, ticker: l.symbol, name: l.name, desc: (m.description || "").slice(0, 160) || undefined, x: m.twitter || undefined, web: m.website || undefined, tg: m.telegram ? "yes" : undefined, devSol: +(+l.devSol || 0).toFixed(2), devLaunches6h: devLaunches.get(l.creator) || 1 };
  });
  const prompt = `Coins (JSON):\n${JSON.stringify(items)}`;
  const t0 = now();
  try {
    const r = useGroq
      ? await askFast(SYSTEM, prompt, 1600, { models: [settings.triageModel, "openai/gpt-oss-20b", "llama-3.1-8b-instant"] })
      : llm === "grok" ? await askGrok(SYSTEM, prompt, { model: settings.triageGrokModel, search: false, maxTokens: 900, timeout: 30_000 })
      : await ask(SYSTEM, prompt, 1600, { model: FAST_MODEL });
    const out = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || "{}");
    const ms = now() - t0;
    for (const x of out.r || []) {
      const l = pending[x.i];
      if (!l) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(x.s) || 0)));
      const label = LABELS.includes(x.l) ? x.l : labelFor(score);
      const prev = mem.get(l.mint) || {};
      mem.set(l.mint, { ...prev, inflight: false, score, label, why: String(x.w || "").slice(0, 80), model: r.model, src: "llm" });
      const ls = liveStats(l.mint);
      db.prepare(`INSERT INTO triage (mint, t, symbol, name, rules, score, label, why, model, ms, mc0) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mint) DO UPDATE SET score = excluded.score, label = excluded.label, why = excluded.why, model = excluded.model, ms = excluded.ms`)
        .run(l.mint, now(), l.symbol == null ? null : String(l.symbol), l.name == null ? null : String(l.name), prev.rules ?? null, score, label, x.w ? String(x.w).slice(0, 80) : null, r.model, ms, ls?.mc || null);
    }
    triageStats.batches++; triageStats.coins += (out.r || []).length; triageStats.lastMs = ms; triageStats.provider = llm; triageStats.lastError = null;
  } catch (e) {
    triageStats.lastError = e.message;
    if (e.blocked) triageStats.provider = "rules";
    // Don't retry the same coins forever: mark them so the next batch moves on.
    for (const l of pending) if (now() - l.seen > 3 * MIN) mem.set(l.mint, { ...(mem.get(l.mint) || {}), model: "failed" });
  } finally {
    inflight--;
    for (const l of pending) { const m = mem.get(l.mint); if (m?.inflight) m.inflight = false; }
  }
}

// ---------- 3. escalate to the research desk ----------
function escalate() {
  for (const l of recentLaunches) {
    const t = mem.get(l.mint);
    if (!t || t.escalated) continue;
    const ls = liveStats(l.mint);
    // While a model is labelling launches, the instant rules alone do not send a coin for a full read:
    // they pass anything with an X link. The rules only decide if the model has not answered in 45 seconds.
    const strong = ["maybe", "promising"].includes(t.label) && t.score >= settings.triageEscalate && (t.model || !llmFor() || now() - l.seen > 45_000);
    // Traction overrides a harsh label: real buyers showing up means it's worth a proper look.
    // Real, different buyers in the first seconds matter more than size: 20 traders with more buying than selling is enough.
    const traction = ls && ls.traders >= 20 && ls.buys > ls.sells && (t.label !== "slop" || ls.traders >= 40);
    if (!strong && !traction) continue;
    t.escalated = true;
    triageStats.escalated++;
    db.prepare("UPDATE triage SET escalated = 1 WHERE mint = ?").run(l.mint);
    adoptLaunch(l).then(() => enqueueFn?.(l.mint, "new", 2e11 + t.score * 1e6));
  }
}

// Score each label against what the coin actually did in its first hour (live ATH vs market cap at triage).
function checkOutcomes() {
  for (const r of db.prepare("SELECT mint, mc0 FROM triage WHERE t > ? AND t < ? AND checked IS NULL").all(now() - 2 * 60 * MIN, now() - 60 * MIN)) {
    const ls = liveStats(r.mint);
    db.prepare("UPDATE triage SET ath = ?, checked = 1 WHERE mint = ?").run(ls?.ath ?? r.mc0, r.mint);
  }
  for (const r of db.prepare("SELECT mint FROM triage WHERE t > ? AND checked IS NULL").all(now() - 60 * MIN)) {
    const ls = liveStats(r.mint);
    if (ls) db.prepare("UPDATE triage SET ath = MAX(COALESCE(ath, 0), ?) WHERE mint = ?").run(ls.ath, r.mint);
  }
}

export function triageRecord() {
  return db.prepare(`SELECT label, COUNT(*) n, AVG(CASE WHEN mc0 > 0 AND ath > 0 THEN ath / mc0 END) avgPeak,
    SUM(CASE WHEN ath >= 30000 THEN 1 ELSE 0 END) hit30k, SUM(CASE WHEN ath >= 100000 THEN 1 ELSE 0 END) hit100k, SUM(escalated) escalated
    FROM triage WHERE t > ? AND checked = 1 GROUP BY label`).all(now() - 24 * 60 * MIN);
}

// Rules score on every launch as soon as it's seen (and again once its metadata has loaded).
function rulesPass() {
  for (const l of recentLaunches) {
    const m = getMeta(l.mint);
    const cur = mem.get(l.mint);
    if (cur && (cur.model || cur.metaSeen)) continue;
    const { score, why } = rulesScore(l, m && !m.pending ? m : null);
    mem.set(l.mint, { ...(cur || {}), rules: score, score: cur?.model ? cur.score : score, label: cur?.model ? cur.label : labelFor(score), why: cur?.model ? cur.why : why, src: cur?.model ? "llm" : "rules", metaSeen: Boolean(m && !m.pending) });
  }
  if (mem.size > 5000) for (const k of [...mem.keys()].slice(0, 2000)) mem.delete(k);
}

export function startTriage(enqueue) {
  enqueueFn = enqueue;
  setInterval(rulesPass, 1000);
  setInterval(() => batch().catch(() => {}), 2000);
  setInterval(escalate, 1000);
  setInterval(checkOutcomes, 60_000);
}
