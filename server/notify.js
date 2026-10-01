// Pushes signals and briefs to Discord (webhook) and Telegram (bot), when configured in Settings.
import { settings } from "./settings.js";
import { db } from "./db.js";
import { fomoLink } from "./fomo.js";

const COLORS = { launch: 0x22c55e, graduated: 0xa855f7, momentum: 0xf59e0b, volume: 0x38bdf8, dump: 0xef4444, brief: 0xe2e8f0, wallet: 0x2dd4bf, smart: 0xfacc15, "dev-sold": 0xef4444, rugged: 0xef4444, research: 0x5cc8ff, buy: 0x39ff88, fomo: 0xff5a5f };
const fmt$ = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;

const kindOf = (k) => k.startsWith("mcap-") ? "milestone" : k.startsWith("wallet:") ? "wallet" : k;
const wants = (kind) => settings.notifyKinds.includes(kind) || settings.notifyKinds.includes(kindOf(kind));

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
}

export async function notifySignal(sig) {
  if (!wants(sig.kind)) return;
  const t = sig.token || {};
  const dex = `https://dexscreener.com/solana/${t.pair || t.mint}`;
  const safety = t.safety_score != null ? `${t.safety_score}/100` : "unchecked";
  const jobs = [];
  if (settings.discordWebhook) {
    jobs.push(post(settings.discordWebhook, {
      username: "Meme Radar",
      embeds: [{
        title: sig.title, url: dex, description: sig.detail,
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
    }));
  }
  if (settings.telegramToken && settings.telegramChat) {
    const text = `*${sig.title}*\n${sig.detail}\nScore ${sig.score}/100 · Safety ${safety} · ${fmt$(t.mcap)}\n[Buy on Fomo](${fomoLink(t.mint)}) · [Chart](${dex}) · \`${t.mint}\``;
    jobs.push(post(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, { chat_id: settings.telegramChat, text, parse_mode: "Markdown", disable_web_page_preview: true }));
  }
  if (!jobs.length) return;
  const res = await Promise.allSettled(jobs);
  if (res.some((r) => r.status === "fulfilled")) db.prepare("UPDATE signals SET notified = 1 WHERE id = ?").run(sig.id);
}

export async function notifyBrief(body) {
  if (!wants("brief")) return;
  const short = body.length > 3900 ? body.slice(0, 3890) + "…" : body;
  const jobs = [];
  if (settings.discordWebhook) jobs.push(post(settings.discordWebhook, { username: "Meme Radar", embeds: [{ title: "Market brief", description: short, color: COLORS.brief }] }));
  if (settings.telegramToken && settings.telegramChat) jobs.push(post(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, { chat_id: settings.telegramChat, text: `Market brief\n\n${short}` }));
  await Promise.allSettled(jobs);
}

export async function testNotify() {
  const errors = [];
  if (settings.discordWebhook) await post(settings.discordWebhook, { username: "Meme Radar", content: "Meme Radar is connected." }).catch((e) => errors.push(e.message));
  if (settings.telegramToken && settings.telegramChat) await post(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, { chat_id: settings.telegramChat, text: "Meme Radar is connected." }).catch((e) => errors.push(e.message));
  if (!settings.discordWebhook && !settings.telegramToken) errors.push("Add a Discord webhook or Telegram bot first.");
  return errors;
}
