// Data-quality rules shared by the whole radar: which price readings can be trusted, what counts as a
// memecoin, whether a coin passes safety, and which links are safe to open. Pure functions, no I/O.

const parse = (s, d = null) => { if (s && typeof s === "object") return s; try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- liquidity ----------
// Bonding-curve launchpads: DexScreener reports no pool liquidity for them because the curve itself is
// the market. Everywhere else, a pool with almost nothing in it means the coin cannot really be sold.
export const CURVE_DEX = new Set(["pumpfun", "meteoradbc", "bags", "launchlab", "moonshot", "boop", "heaven"]);
export const onCurve = (t) => CURVE_DEX.has(t?.dex);
export const illiquid = (t, floor = 1000) => Boolean(t?.pair) && !onCurve(t) && (t.liquidity || 0) < floor;

// Is one market reading believable? Returns null when it is, else a short reason.
// An emptied pool keeps quoting a "price" that nobody can trade at (one coin showed $3 trillion on $13 of
// liquidity), so those readings must never feed peaks, multiples or returns.
export function readingProblem({ dex, liquidity, mcap }, floor = 1000) {
  if (!(mcap > 0)) return null;
  // No traded coin is worth a few cents in total, or more than the largest companies on earth: a feed glitch.
  if (mcap > 2e11 || mcap < 100) return "implausible market cap";
  if (CURVE_DEX.has(dex)) return null;
  const liq = liquidity || 0;
  if (liq < floor) return `pool has only $${liq < 10 ? liq.toFixed(2) : Math.round(liq).toLocaleString()} of liquidity`;
  if (mcap / liq > 2000) return "market cap is not backed by the pool";
  return null;
}

// Can a holder actually get out at the quoted price right now?
export function exitState(t, floor = 1000) {
  if (!t) return { ok: false, why: "unknown coin" };
  if (!t.pair || !t.price) return { ok: false, why: "no market found" };
  if (t.quarantine) return { ok: false, why: t.quarantine };
  if (illiquid(t, floor)) return { ok: false, why: `only $${Math.round(t.liquidity || 0).toLocaleString()} of liquidity` };
  return { ok: true, why: null };
}

// ---------- what kind of asset is this ----------
const MAJOR_MINTS = new Set([
  "So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrajDsTVEb4f3xFeKbSkqvn9rk8Y3Y7xMhRzTsH",
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
]);
const STABLE = /^(usdc|usdt|usds|usde|pyusd|dai|fdusd|usd1|eurc|usdg)$/i;
const WRAPPED = /\((wormhole|portal|allbridge|axelar)\)|^wrapped\s|^coinbase wrapped|\bbridged\b|^(weth|wbtc|wbnb|cbbtc|tbtc|zbtc|jitosol|msol|bsol|jlp)$/i;
const TOKENIZED = /\bxstock\b|\btokenized\b|\bondo\b.*\b(stock|treasur)|\b(stock|share)s?\s+token\b/i;

// meme | stable | wrapped | tokenized | major. Only memes get signals, narratives and research.
export function classifyAsset(t) {
  if (t.class_user) return t.class_user;
  const sym = String(t.symbol || ""), name = String(t.name || "");
  if (STABLE.test(sym)) return "stable";
  if (TOKENIZED.test(name) || /^[A-Z]{1,5}x$/.test(sym) && /xstock/i.test(name)) return "tokenized";
  if (WRAPPED.test(name) || WRAPPED.test(sym)) return "wrapped";
  if (MAJOR_MINTS.has(t.mint)) return "major";
  // Nothing launched as a memecoin on a curve is worth billions with deep pools on day one.
  const launchpad = /(pump|bonk|bags)$/i.test(t.mint || "") || /^pump/.test(t.source || "");
  if (!launchpad && (t.mcap || 0) >= 1e9 && (t.liquidity || 0) >= 1e6) return "major";
  return "meme";
}
export const ASSET_LABEL = { meme: "Memecoin", stable: "Stablecoin", wrapped: "Wrapped asset", tokenized: "Tokenized stock/asset", major: "Major token" };

// ---------- safety ----------
// One policy for every actionable signal. ok = passes; unknown = not checked yet (never treated as a pass).
export function safetyVerdict(t, { minSafety = 60, minExitLiq = 1000, devCount = 0 } = {}) {
  const reasons = [];
  if (!t) return { ok: false, unknown: true, reasons: ["unknown coin"] };
  const s = parse(t.safety);
  if (t.status === "dead") reasons.push("the coin is dead (no real trading left)");
  if (t.quarantine) reasons.push(`price data is unreliable: ${t.quarantine}`);
  else if (illiquid(t, minExitLiq)) reasons.push(`only $${Math.round(t.liquidity || 0).toLocaleString()} of liquidity, effectively unsellable`);
  if (t.asset_class && t.asset_class !== "meme") reasons.push(`not a memecoin (${ASSET_LABEL[t.asset_class] || t.asset_class})`);
  if (!s) reasons.push("safety has not been checked yet");
  else {
    if (s.rugged) reasons.push("RugCheck marks it as rugged");
    const danger = (s.risks || []).filter((r) => r.level === "danger").map((r) => r.name);
    if (s.danger > 0) reasons.push(`${s.danger} danger risk${s.danger > 1 ? "s" : ""}${danger.length ? `: ${danger.slice(0, 3).join(", ")}` : ""}`);
    if ((t.safety_score ?? 0) < minSafety) reasons.push(`safety ${t.safety_score ?? 0}/100, below your minimum of ${minSafety}`);
  }
  if (devCount >= 4) reasons.push(`the dev launched ${devCount} coins in 6 hours`);
  return { ok: reasons.length === 0, unknown: !s, reasons };
}

// ---------- links ----------
// Token metadata is written by whoever launched the coin. Only plain web links are allowed through;
// javascript:, data:, file: and anything unparseable is dropped.
export function safeUrl(u) {
  if (typeof u !== "string") return null;
  let s = u.trim();
  if (!s || s.length > 600) return null;
  if (/^(www\.|t\.me\/|x\.com\/|twitter\.com\/)/i.test(s)) s = `https://${s}`;
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".") || url.username || url.password) return null;
  return url.href;
}
// For links the radar itself fetches (a coin's website, its metadata file): a launcher must not be able
// to point the radar at this PC or the home network.
export function publicUrl(u) {
  const s = safeUrl(u);
  if (!s) return null;
  const h = new URL(s).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(local|internal|lan|home|localhost)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(":")) return null;
  return s;
}
const SOCIAL_HOSTS = {
  twitter: /(^|\.)(x|twitter)\.com$/i, telegram: /(^|\.)(t\.me|telegram\.me|telegram\.org)$/i, discord: /(^|\.)(discord\.gg|discord\.com)$/i,
  tiktok: /(^|\.)tiktok\.com$/i, instagram: /(^|\.)instagram\.com$/i, youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
};
// [{type,url}] with unsafe links removed. A link that claims to be a social but points elsewhere is
// relabelled as an ordinary (untrusted) website.
export function cleanLinks(list) {
  const out = [], seen = new Set();
  for (const l of Array.isArray(list) ? list : []) {
    const url = safeUrl(l?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let type = String(l.type || "website").toLowerCase().replace(/[^a-z]/g, "") || "website";
    if (type === "x") type = "twitter";
    const host = new URL(url).hostname;
    const real = Object.keys(SOCIAL_HOSTS).find((k) => SOCIAL_HOSTS[k].test(host));
    if (real) type = real; else if (SOCIAL_HOSTS[type]) type = "website";
    out.push({ type, url });
    if (out.length >= 8) break;
  }
  return out;
}

// ---------- honest statistics ----------
export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// Mean with every value capped at `cap`x, so one 90x cannot carry a hundred losers.
export const cappedMean = (xs, cap = 5) => mean(xs.map((x) => Math.min(x, cap)));
export const quantile = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

// Summary of a list of signal rows ({p1h, peak, t, illiq, mint}). Counts come with their denominators.
export function summarize(list, now = Date.now()) {
  const HOUR = 3600e3;
  const priced = list.filter((r) => r.price > 0);
  const eligible = priced.filter((r) => r.p1h != null);
  const pending = priced.filter((r) => r.p1h == null && now - r.t < HOUR).length;
  const x1 = eligible.map((r) => r.p1h);
  const peaks = priced.filter((r) => r.peak != null).map((r) => r.peak);
  const n = (f) => eligible.filter(f).length;
  return {
    events: list.length, tokens: new Set(list.map((r) => r.mint)).size,
    eligible1h: eligible.length, pending1h: pending, unavailable1h: list.length - eligible.length - pending,
    up20: n((r) => r.p1h >= 1.2), down50: n((r) => r.p1h <= 0.5), unsellable1h: n((r) => r.illiq),
    median1h: median(x1), mean1h: mean(x1), cappedMean1h: cappedMean(x1), worst1h: x1.length ? Math.min(...x1) : null, best1h: x1.length ? Math.max(...x1) : null,
    p25_1h: quantile(x1, 0.25), p75_1h: quantile(x1, 0.75),
    peaks: peaks.length, twoX: peaks.filter((p) => p >= 2).length, medianPeak: median(peaks),
  };
}
// One row per coin: its first alert only. Ten alerts on one coin are one pick, not ten.
export const firstPerToken = (list) => { const seen = new Map(); for (const r of [...list].sort((a, b) => a.t - b.t)) if (!seen.has(r.mint)) seen.set(r.mint, r); return [...seen.values()]; };

// ---------- traction ----------
// How much real demand a coin shows right now, 0-100. This is the radar's main ranking.
// The weights were fitted on 2026-10-01 against 251 first reads, each replayed through the exit rule
// (half sold at 2x, 35% trailing stop, out at -40%): coins scoring under 40 won 7-9% of the time and
// returned about 0.75x; coins at 65+ won 50% and returned about 1.2x. The AI's narrative grade showed no
// such link. It is a small sample: brain.evidence() re-measures the bands on live results every 5 minutes
// and the Today tab shows them, so a formula that stops working is visible.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const usd = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
export function traction(f = {}) {
  let s = 35;
  const up = [], down = [];
  const add = (n, text) => { s += n; if (text) (n > 0 ? up : down).push(text); };
  if (isNum(f.vol5m)) { if (f.vol5m >= 20000) add(18, `${usd(f.vol5m)} traded in the last 5 minutes`); else if (f.vol5m >= 2600) add(6); else add(-14, "almost nothing traded in the last 5 minutes"); }
  if (isNum(f.traders)) { if (f.traders >= 40) add(10, `${f.traders} different traders`); else if (f.traders >= 9) add(4); else add(-8, `only ${f.traders} traders so far`); }
  if (isNum(f.chg1m)) { if (f.chg1m > 0) add(7, "rising over the last minute"); else if (f.chg1m < 0) add(-8, "falling over the last minute"); }
  if (isNum(f.chg5m)) { if (f.chg5m > 0) add(4); else add(-5, "flat or down over 5 minutes"); }
  if (isNum(f.chg1h)) { if (f.chg1h > 130) add(-5, `already up ${Math.round(f.chg1h)}% this hour`); else if (f.chg1h >= -2) add(10, "holding or climbing this hour without having run away"); else add(-9, `down ${Math.round(-f.chg1h)}% this hour`); }
  if (isNum(f.mcap) && f.mcap > 0) { if (f.mcap > 250000) add(-16, `market cap ${usd(f.mcap)}: the early move is over`); else if (f.mcap >= 60000) add(10, `market cap ${usd(f.mcap)}, the range that has paid best`); else if (f.mcap >= 17000) add(2); else add(-10, `market cap only ${usd(f.mcap)}: most coins this small go nowhere`); }
  if (f.stage === "near") add(5, "about to bond"); else if (f.stage === "new") add(-4);
  if (isNum(f.holders) && f.holders >= 60 && f.holders <= 400) add(5, `${f.holders} holders, still early`);
  if (isNum(f.offAth) && f.offAth < 0.6) add(-8, `${Math.round((1 - f.offAth) * 100)}% below its high`);
  return { score: Math.max(0, Math.min(100, Math.round(s))), up, down };
}
// The same score from the research bundle gathered for a read.
export function tractionOfSources(d) {
  if (!d?.market) return null;
  const L = d.liveTrading || {}, M = d.market, mcap = L.mcapUsd || M.mcap || 0;
  const ath = L.athUsd && L.mcapUsd ? L.mcapUsd / L.athUsd : M.peakMcap && M.mcap ? M.mcap / M.peakMcap : undefined;
  return traction({ stage: d.stage, mcap, vol5m: M.vol5m, traders: L.uniqueTraders, chg1m: L.change1mPct ?? undefined, chg5m: M.chg5m ?? undefined, chg1h: M.chg1h ?? undefined,
    holders: d.holders?.total ?? undefined, offAth: isNum(ath) ? Math.min(1, ath) : undefined });
}
