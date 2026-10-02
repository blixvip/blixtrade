// Pushes signals and briefs to Discord (webhook) and Telegram (bot), when configured in Settings.
// Every push goes through the alert rules first (mutes, quiet hours, per-coin cooldown, unscreened
// coins), and every decision is written to the delivery log so it can be checked afterwards.
import { settings } from "./settings.js";
import { db } from "./db.js";
import { fomoLink } from "./fomo.js";
import * as health from "./health.js";

const COLORS = { launch: 0x22c55e, graduated: 0xa855f7, momentum: 0xf59e0b, volume: 0x38bdf8, dump: 0xef4444, brief: 0xe2e8f0, wallet: 0x2dd4bf, smart: 0xfacc15, "dev-sold": 0xef4444, rugged: 0xef4444, "liq-pulled": 0xef4444, research: 0x5cc8ff, buy: 0x39ff88, fomo: 0xff5a5f };
const fmt$ = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;

const kindOf = (k) => k.startsWith("mcap-") ? "milestone" : k.startsWith("wallet:") ? "wallet" : k;
const wants = (kind, s = settings) => s.notifyKinds.includes(kind) || s.notifyKinds.includes(kindOf(kind));
const WARNINGS = new Set(["dump", "dev-sold", "rugged", "liq-pulled"]);

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
}

const log = (channel, sig, ok, error = null) => db.prepare("INSERT INTO deliveries (t, channel, kind, mint, title, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
  .run(Date.now(), channel, sig.kind ? kindOf(sig.kind) : "brief", sig.mint || null, String(sig.title || "").slice(0, 160), ok, error && String(error).slice(0, 200));

// ---------- rules ----------
export const rules = {
  list: () => db.prepare("SELECT * FROM alert_rules ORDER BY created DESC").all(),
  set(scope, target, effect, note = "") {
    if (!["coin", "wallet", "kind"].includes(scope) || !["mute", "always"].includes(effect) || !target) throw Object.assign(new Error("Unknown rule"), { status: 400 });
    db.prepare(`INSERT INTO alert_rules (scope, target, effect, note, created) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, target) DO UPDATE SET effect = excluded.effect, note = excluded.note, created = excluded.created`).run(scope, String(target), effect, String(note || "").slice(0, 80), Date.now());
  },
  remove: (id) => db.prepare("DELETE FROM alert_rules WHERE id = ?").run(Number(id)),
  clear: (scope, target) => db.prepare("DELETE FROM alert_rules WHERE scope = ? AND target = ?").run(scope, String(target)),
  for(sig) {
    const get = (scope, target) => target && db.prepare("SELECT effect FROM alert_rules WHERE scope = ? AND target = ?").get(scope, target)?.effect;
    const wallet = sig.kind?.startsWith("wallet:") ? sig.kind.slice(7) : null;
    return { coin: get("coin", sig.mint), wallet: get("wallet", wallet), kind: get("kind", kindOf(sig.kind || "")) };
  },
};

function inQuietHours(d = new Date()) {
  const m = (s) => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim()); return x ? +x[1] * 60 + +x[2] : null; };
  const a = m(settings.quietStart), b = m(settings.quietEnd);
  if (a == null || b == null || a === b) return false;
  const now = d.getHours() * 60 + d.getMinutes();
  return a < b ? now >= a && now < b : now >= a || now < b;   // a window that wraps past midnight
}

// Should this alert be pushed? Returns { push, why }. Used for Discord/Telegram and for the browser's
// desktop notifications, so both follow the same rules.
export function decide(sig) {
  const r = rules.for(sig);
  if (r.coin === "mute") return { push: false, why: "you muted this coin" };
  if (r.wallet === "mute") return { push: false, why: "you muted this wallet" };
  if (r.kind === "mute") return { push: false, why: "you muted this alert type" };
  const always = r.coin === "always" || r.wallet === "always";
  if (!always && !wants(sig.kind)) return { push: false, why: "this alert type is switched off" };
  if (!always && sig.safe === 0 && !settings.pushUnscreened) return { push: false, why: "the coin did not pass safety (unscreened wallet activity)" };
  if (!always && inQuietHours() && !WARNINGS.has(kindOf(sig.kind)) && kindOf(sig.kind) !== "buy") return { push: false, why: "quiet hours" };
  // One push per coin per cooldown; warnings and buy calls always go through.
  const cool = Math.max(0, settings.alertCooldownMin) * 60_000;
  if (cool && !WARNINGS.has(kindOf(sig.kind)) && kindOf(sig.kind) !== "buy") {
    const last = db.prepare("SELECT t FROM signals WHERE mint = ? AND pushed = 1 AND id != ? ORDER BY t DESC LIMIT 1").get(sig.mint, sig.id ?? -1);
    if (last && Date.now() - last.t < cool) return { push: false, why: `another alert for this coin went out ${Math.round((Date.now() - last.t) / 60_000)}m ago (grouped)` };
  }
  return { push: true, why: null };
}

const channels = (s = settings) => ({ discord: Boolean(s.discordWebhook), telegram: Boolean(s.telegramToken && s.telegramChat) });

export async function notifySignal(sig) {
  const d = decide(sig);
  sig.push = d.push;
  if (!d.push) { if (wants(sig.kind) || sig.safe === 0) log("held", sig, null, d.why); return d; }
  db.prepare("UPDATE signals SET pushed = 1 WHERE id = ?").run(sig.id);
  const t = sig.token || {};
  const dex = `https://dexscreener.com/solana/${t.pair || t.mint}`;
  const safety = sig.safe === 0 ? "NOT SCREENED" : t.safety_score != null ? `${t.safety_score}/100` : "unchecked";
  // Alerts held back by the cooldown since this coin's last push are summarised on this one.
  const prev = db.prepare("SELECT t FROM signals WHERE mint = ? AND pushed = 1 AND id != ? ORDER BY t DESC LIMIT 1").get(sig.mint, sig.id);
  const held = db.prepare("SELECT COUNT(*) n FROM signals WHERE mint = ? AND hidden = 0 AND pushed = 0 AND id != ? AND t > ?").get(sig.mint, sig.id, Math.max(prev?.t || 0, Date.now() - 6 * 3600e3)).n;
  const more = held ? `\n(+${held} more alert${held > 1 ? "s" : ""} on this coin since the last one)` : "";
  const on = channels();
  const jobs = [];
  if (on.discord) {
    jobs.push(["discord", post(settings.discordWebhook, {
      username: "Blix",
      embeds: [{
        title: sig.title, url: dex, description: sig.detail + more,
        color: COLORS[kindOf(sig.kind)] ?? 0x94a3b8,
        thumbnail: t.image ? { url: t.image } : undefined,
        fields: [
          { name: "Score", value: `${sig.score}/100`, inline: true },
          { name: "Safety", value: safety, inline: true },
          { name: "Mcap", value: fmt$(t.mcap), inline: true },
          { name: "Trade", value: `[Buy on Fomo](${fomoLink(t.mint)}) · [Chart](${dex})` },
          { name: "Mint", value: `\`${t.mint}\`` },
        ],
        timestamp: new Date(sig.t).toISOString(),
      }],
    })]);
  }
  if (on.telegram) {
    const text = `*${sig.title}*\n${sig.detail}${more}\nScore ${sig.score}/100 · Safety ${safety} · ${fmt$(t.mcap)}\n[Buy on Fomo](${fomoLink(t.mint)}) · [Chart](${dex}) · \`${t.mint}\``;
    jobs.push(["telegram", post(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, { chat_id: settings.telegramChat, text, parse_mode: "Markdown", disable_web_page_preview: true })]);
  }
  await deliver(jobs, sig);
  return d;
}

async function deliver(jobs, sig) {
  const res = await Promise.allSettled(jobs.map(([, p]) => p));
  res.forEach((r, i) => {
    const ch = jobs[i][0];
    // Never keep a webhook URL or bot token in the log.
    const err = r.status === "rejected" ? String(r.reason?.message || r.reason).replace(/bot\d+:[\w-]+/g, "bot…").replace(/webhooks\/\S+/g, "webhooks/…") : null;
    r.status === "fulfilled" ? health.ok(ch) : health.fail(ch, err);
    log(ch, sig, r.status === "fulfilled" ? 1 : 0, err);
  });
  if (sig.id && res.some((r) => r.status === "fulfilled")) db.prepare("UPDATE signals SET notified = 1 WHERE id = ?").run(sig.id);
  return res;
}

export async function notifyBrief(body) {
  if (!wants("brief") || inQuietHours()) return;
  const short = body.length > 3900 ? body.slice(0, 3890) + "…" : body;
  const on = channels(), jobs = [];
  if (on.discord) jobs.push(["discord", post(settings.discordWebhook, { username: "Blix", embeds: [{ title: "Market brief", description: short, color: COLORS.brief }] })]);
  if (on.telegram) jobs.push(["telegram", post(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, { chat_id: settings.telegramChat, text: `Market brief\n\n${short}` })]);
  if (jobs.length) await deliver(jobs, { title: "Market brief" });
}

// Sends a test to the destinations as typed in the form (s = saved settings with the unsaved edits on top).
export async function testNotify(s = settings) {
  const on = channels(s), jobs = [];
  if (on.discord) jobs.push(["discord", post(s.discordWebhook, { username: "Blix", content: "Blix is connected." })]);
  if (on.telegram) jobs.push(["telegram", post(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, { chat_id: s.telegramChat, text: "Blix is connected." })]);
  if (!jobs.length) return { errors: [s.telegramToken && !s.telegramChat ? "Add the Telegram chat ID too." : "Add a Discord webhook or a Telegram bot first."], sent: [] };
  const res = await deliver(jobs, { title: "Test message", kind: "test" });
  return { errors: res.map((r, i) => r.status === "rejected" ? `${jobs[i][0]}: ${r.reason.message.replace(/bot\d+:[\w-]+/g, "bot…")}` : null).filter(Boolean), sent: res.map((r, i) => r.status === "fulfilled" ? jobs[i][0] : null).filter(Boolean) };
}

// Where alerts can go, whether each destination is set up, and how its recent deliveries went.
export function destinations() {
  const on = channels();
  const last = (ch, ok) => db.prepare("SELECT t, error, title FROM deliveries WHERE channel = ? AND ok = ? ORDER BY t DESC LIMIT 1").get(ch, ok) || null;
  const day = Date.now() - 864e5;
  const count = (ch, ok) => db.prepare("SELECT COUNT(*) n FROM deliveries WHERE channel = ? AND ok = ? AND t > ?").get(ch, ok, day).n;
  const one = (ch) => ({ configured: on[ch], lastOk: last(ch, 1), lastFail: last(ch, 0), sent24h: count(ch, 1), failed24h: count(ch, 0) });
  return {
    discord: one("discord"), telegram: one("telegram"),
    held24h: db.prepare("SELECT COUNT(*) n FROM deliveries WHERE channel = 'held' AND t > ?").get(day).n,
    quiet: { start: settings.quietStart, end: settings.quietEnd, active: inQuietHours() },
    any: on.discord || on.telegram,
  };
}
export const deliveries = (limit = 60) => db.prepare("SELECT * FROM deliveries ORDER BY id DESC LIMIT ?").all(limit);
