// The AI's read of what is running (running.js), made where an AI is available: the owner's PC has a Claude login
// (ai.js); the server has none, and Grok's credits run out. Every 2 minutes the coins with money moving right now
// (running.js runningFamilies: one line per coin, copies folded in) and Blix's own theme grouping go to Claude, which groups them
// into the stories traders are actually playing and names each in a trader's words. The answer is used here
// (runningAiIn) and handed to the server (POST <settings.fomoRelayTo>/api/running/ai, as the owner, the same way
// fomorelay.js hands it Fomo), which uses it while it is under 8 minutes old and its own themes otherwise.
import crypto from "node:crypto";
import { settings } from "./settings.js";
import { ask, claudeStatus, extractJson } from "./ai.js";
import { runningFamilies, runningAiIn, themeGroups } from "./running.js";
import { logEvent } from "./db.js";

const EVERY_MS = 2 * 60_000;
export const runningAiStats = { on: false, runs: 0, lastOk: 0, lastError: null, stories: 0, sent: 0, lastSent: 0, sendError: null };
const target = () => String(settings.fomoRelayTo || "").trim().replace(/\/+$/, "");

const SYSTEM = `You read Solana memecoin markets like a sharp trader. You are given every coin with real money moving in the last hour, one line each (copies of the same name are folded into one line), and Blix's own first grouping of them by theme.
Your job: the narratives traders are actually playing right now. Start from Blix's grouping, then fix it: merge groups that are really one story (all coins named after social media apps are ONE story, not one per app), split groups that are two stories, move coins that sit in the wrong group, and add stories Blix's themes missed (an event, a person, a joke several coins share). Leave out coins that fit no shared story.
Rules: every narrative has at least 2 different coins; a coin appears in at most one narrative; only use facts in the lines (names, descriptions, moves); never invent news.
Name each narrative in 2 to 5 words the way a trader says it ("Social app coins", "pump.fun feature coins", "Streamer coins"). "why": one plain sentence on what ties the coins together and how hard they are running, citing the leading coins' moves. No hype, no advice.
Answer with JSON only: {"narratives":[{"name":"...","why":"...","coins":[line numbers]}]}, strongest first (money moving and how many coins carry it), at most 10.`;

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round((n || 0) / 1e3)}K`);
const pct = (n) => (n == null ? "?" : `${n >= 0 ? "+" : ""}${Math.round(n)}%`);

// Off unless settings.runningAi is true (the owner turned the AI read off on 2026-10-08: Blix's own themes only).
// Switched off, the server is told once to drop the last read it was given.
let cleared = false;
async function run() {
  if (settings.runningAi !== true) {
    runningAiStats.on = false;
    runningAiIn({ stories: [] });
    if (!cleared) { cleared = true; await send({ stories: [] }); }
    return;
  }
  cleared = false;
  runningAiStats.on = claudeStatus().ready;
  if (!runningAiStats.on) return;
  const fams = runningFamilies().slice(0, 90);
  if (fams.length < 4) return;
  const lines = fams.map((f, i) => {
    const c = f.lead, age = Math.max(0, Math.round((Date.now() - (f.youngest || c.born || Date.now())) / 60_000));
    const desc = String(c.description || "").replace(/\s+/g, " ").slice(0, 90);
    return `${i + 1}. $${c.symbol} "${c.name}"${f.copies > 1 ? ` (${f.copies} coins with this name)` : ""} · mc ${money(c.mcap)} · vol 1h ${money(f.vol)} · 1h ${pct(c.chg_h1)} · 5m ${pct(c.chg_m5)} · newest ${age < 120 ? `${age}m` : `${Math.round(age / 60)}h`} old${desc ? ` · "${desc}"` : ""}`;
  });
  runningAiStats.runs++;
  try {
    const draft = themeGroups(fams).map(([name, idx]) => `${name}: ${idx.map((i) => i + 1).join(", ")}`).join("\n");
    // The stronger model: the quick one split one story into several and filed coins under the wrong one (2026-10-08).
    const r = await ask(SYSTEM, `Coins:\n${lines.join("\n")}\n\nBlix's first grouping (theme: line numbers):\n${draft || "(none)"}`, 1800);
    const j = extractJson(r.text);
    const stories = (j?.narratives || []).map((n) => ({ name: n.name, why: n.why, mints: (n.coins || []).map((k) => fams[Number(k) - 1]?.lead.mint).filter(Boolean) })).filter((s) => s.name && s.mints.length >= 2);
    if (!stories.length) throw new Error("the answer had no narratives");
    const body = { model: r.model, stories };
    runningAiIn(body);
    runningAiStats.lastOk = Date.now(); runningAiStats.stories = stories.length; runningAiStats.lastError = null;
    await send(body);
  } catch (e) {
    if (runningAiStats.lastError !== e.message) logEvent("error", `Running narratives (AI read): ${e.message}`);
    runningAiStats.lastError = e.message;
  }
}

// The server's gate takes the owner's cookie signed with the memberKey both sides hold (as fomorelay.js does).
function ownerCookie() {
  const t = String(Date.now()), email = "pc-relay@blix";
  const sig = crypto.createHmac("sha256", settings.memberKey).update(`${email}.${t}.cookie.owner`).digest("hex");
  return `blix_m=${Buffer.from(email, "utf8").toString("base64url")}.${t}.1.${sig}`;
}
async function send(body) {
  if (!/^https:\/\//.test(target()) || String(settings.memberKey || "").length < 32) return;
  try {
    const r = await fetch(`${target()}/api/running/ai`, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", origin: "https://blixvip.com", cookie: ownerCookie() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`${r.status} ${j.error || ""}`.trim());
    runningAiStats.sent++; runningAiStats.lastSent = Date.now(); runningAiStats.sendError = null;
  } catch (e) { runningAiStats.sendError = e.message; }
}

// Not for a copy on its own data folder (the tests).
if (!process.env.RADAR_DATA) {
  setTimeout(run, 5_000).unref();
  setInterval(run, EVERY_MS).unref();
}
