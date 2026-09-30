// AI write-ups (market briefs, single-coin takes) via Claude, using this PC's Claude Code login.
// Same approach as Buzzroll: direct Messages API call with the OAuth token, no separate API key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODEL = "claude-sonnet-5-5";
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

function token() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8"));
    const o = c.claudeAiOauth;
    if (!o?.accessToken) return { error: "No Claude login found on this PC." };
    if (o.expiresAt && o.expiresAt < Date.now()) return { error: "Claude login expired. Open Claude Code once to refresh it." };
    return { token: o.accessToken };
  } catch {
    return { error: "No Claude login found on this PC." };
  }
}

export async function ask(system, prompt, maxTokens = 1400) {
  const t = token();
  if (t.error) throw new Error(t.error);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${t.token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: "text", text: IDENTITY }, { type: "text", text: system }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `Claude API ${r.status}`);
  return { text: body.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(), model: MODEL };
}

const BRIEF_SYSTEM = `You write short market briefs for a memecoin scanner's owner. You get live data from the scanner.
Write in plain, punchy English. No hype, no emojis, no financial advice disclaimers beyond one short closing line.
Use exactly these markdown sections:
## The tape  (2-3 sentences: overall activity, launch pace, risk mood)
## Narratives heating up  (3-5 bullets: theme — why, with 1-2 example tickers)
## Coins to watch  (3-6 bullets: $TICKER — mcap, what it's doing, the main risk)
## Red flags  (1-3 bullets: dumps, rugs, crowded trades)
Only mention tickers that appear in the data. Numbers must come from the data.`;

export async function writeBrief(data) {
  return ask(BRIEF_SYSTEM, `Scanner data (JSON):\n${JSON.stringify(data)}`);
}

const COIN_SYSTEM = `You explain a single memecoin to its scanner's owner in under 170 words: what the meme is,
how it is trading right now, what the safety check found, and the one thing to watch. Plain English, no hype, no emojis.
End with one short line on risk. Only use facts from the data.`;

export async function explainCoin(data) {
  return ask(COIN_SYSTEM, `Coin data (JSON):\n${JSON.stringify(data)}`, 500);
}
