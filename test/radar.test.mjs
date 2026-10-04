// Checks for the rules the radar's honesty depends on. Runs against a throwaway data folder:
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RADAR_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "radar-test-"));
const Q = await import("../server/quality.js");
const { extractJson, briefProblem } = await import("../server/ai.js");
const S = await import("../server/settings.js");
const { db } = await import("../server/db.js");
const { parse } = await import("../server/research.js");
const N = await import("../server/notify.js");
const E = await import("../server/engine.js");

const RUGCHECK_OK = JSON.stringify({ danger: 0, rugged: false, risks: [] });
const coin = (o = {}) => ({ mint: "So1pump", pair: "p", dex: "pumpswap", liquidity: 40000, mcap: 300000, price: 0.0003, status: "active", safety: RUGCHECK_OK, safety_score: 82, asset_class: "meme", ...o });

test("a reading from an emptied pool is never trusted", () => {
  assert.match(Q.readingProblem({ dex: "pumpswap", liquidity: 13.1, mcap: 3_139_300_791_928 }), /implausible|liquidity/);
  assert.match(Q.readingProblem({ dex: "pumpswap", liquidity: 0.01, mcap: 993_634 }), /only \$0\.01/);
  assert.match(Q.readingProblem({ dex: "raydium", liquidity: 59_542, mcap: 2_560_693_459 }), /not backed/);
  assert.equal(Q.readingProblem({ dex: "pumpswap", liquidity: 21_000, mcap: 64_000 }), null);
  assert.match(Q.readingProblem({ dex: "meteoradbc", liquidity: 0, mcap: 0.3 }), /implausible/, "a 30-cent market cap is a feed glitch, not a 100% dump");
});

test("a coin still on its bonding curve has no pool and is not flagged for it", () => {
  assert.equal(Q.readingProblem({ dex: "pumpfun", liquidity: 0, mcap: 30_000 }), null);
  assert.equal(Q.illiquid({ pair: "p", dex: "pumpfun", liquidity: 0 }), false);
  assert.equal(Q.illiquid({ pair: "p", dex: "pumpswap", liquidity: 0 }), true);
  assert.equal(Q.exitState(coin({ dex: "pumpfun", liquidity: 0 })).ok, true);
  assert.equal(Q.exitState(coin({ liquidity: 0.01 })).ok, false);
  assert.equal(Q.exitState(coin({ quarantine: "no longer listed on any DEX" })).ok, false);
});

test("stablecoins, wrapped assets and tokenized stocks are not memecoins", () => {
  assert.equal(Q.classifyAsset({ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin" }), "stable");
  assert.equal(Q.classifyAsset({ mint: "x", symbol: "AAPLx", name: "Apple xStock" }), "tokenized");
  assert.equal(Q.classifyAsset({ mint: "x", symbol: "WETH", name: "Wrapped Ether (Wormhole)" }), "wrapped");
  assert.equal(Q.classifyAsset({ mint: "x", symbol: "NEAR", name: "NEAR", mcap: 6.2e9, liquidity: 1.7e6, source: "gecko" }), "major");
  assert.equal(Q.classifyAsset({ mint: "abcpump", symbol: "APPLE", name: "Apple cat", mcap: 80_000, liquidity: 20_000 }), "meme");
  assert.equal(Q.classifyAsset({ mint: "x", symbol: "USDC", name: "USD Coin", class_user: "meme" }), "meme", "your correction wins");
});

test("the safety policy fails unsafe, dead, unsellable and unchecked coins, and says why", () => {
  assert.equal(Q.safetyVerdict(coin()).ok, true);
  const low = Q.safetyVerdict(coin({ safety_score: 18 }));
  assert.equal(low.ok, false);
  assert.match(low.reasons.join(), /18\/100, below your minimum of 60/);
  assert.match(Q.safetyVerdict(coin({ status: "dead" })).reasons.join(), /dead/);
  assert.match(Q.safetyVerdict(coin({ liquidity: 0 })).reasons.join(), /unsellable/);
  assert.match(Q.safetyVerdict(coin({ safety: JSON.stringify({ danger: 1, risks: [{ level: "danger", name: "Large Amount of LP Unlocked" }] }) })).reasons.join(), /LP Unlocked/);
  const unknown = Q.safetyVerdict(coin({ safety: null, safety_score: null }));
  assert.equal(unknown.ok, false, "not checked is never a pass");
  assert.equal(unknown.unknown, true);
  assert.match(Q.safetyVerdict(coin(), { devCount: 6 }).reasons.join(), /6 coins/);
  assert.equal(Q.safetyVerdict(coin({ asset_class: "stable" })).ok, false);
});

test("only plain web links survive; scripts, data links and local addresses do not", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "file:///C:/x", "vbscript:x", "ftp://x.y/z", "", null, "not a url", "https://user:pass@evil.com"]) assert.equal(Q.safeUrl(bad), null, String(bad));
  assert.equal(Q.safeUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(Q.safeUrl("x.com/someone"), "https://x.com/someone");
  for (const local of ["http://127.0.0.1:4420/api/settings", "http://localhost/x", "http://192.168.1.1/", "http://router.local/", "http://[::1]/"]) assert.equal(Q.publicUrl(local), null, local);
  assert.equal(Q.publicUrl("https://coin-site.xyz/"), "https://coin-site.xyz/");
  const links = Q.cleanLinks([{ type: "twitter", url: "https://evil.example/phish" }, { type: "website", url: "javascript:alert(1)" }, { type: "x", url: "https://x.com/real" }]);
  assert.deepEqual(links, [{ type: "website", url: "https://evil.example/phish" }, { type: "twitter", url: "https://x.com/real" }], "a fake social link is shown as an ordinary site; a script link is dropped");
});

test("track-record numbers come with denominators and are not carried by one outlier", () => {
  const now = Date.now(), H = 3600e3;
  const rows = [
    { mint: "A", t: now - 5 * H, price: 1, p1h: 92, peak: 92 }, { mint: "A", t: now - 4.9 * H, price: 1, p1h: 92, peak: 92 }, { mint: "A", t: now - 4.8 * H, price: 1, p1h: 88, peak: 88 },
    { mint: "B", t: now - 5 * H, price: 1, p1h: 0.4, peak: 1.1 }, { mint: "C", t: now - 5 * H, price: 1, p1h: 0, peak: 1, illiq: 1 }, { mint: "D", t: now - 5 * H, price: 1, p1h: 0.9, peak: 1.3 },
    { mint: "E", t: now - 0.2 * H, price: 1, p1h: null, peak: 1 }, { mint: "F", t: now - 5 * H, price: null, p1h: null, peak: null },
  ];
  const ev = Q.summarize(rows, now);
  assert.deepEqual([ev.events, ev.tokens, ev.eligible1h, ev.pending1h, ev.unavailable1h], [8, 6, 6, 1, 1]);
  assert.ok(ev.mean1h > 40, "the plain average is dominated by repeats of one coin");
  const per = Q.summarize(Q.firstPerToken(rows), now);
  assert.equal(per.eligible1h, 4, "each coin once");
  assert.equal(per.median1h, 0.65);
  assert.equal(per.down50, 2);
  assert.equal(per.unsellable1h, 1);
  assert.ok(per.cappedMean1h < 2, "capped average ignores the 92x");
});

test("JSON is pulled out of chatty or doubled model answers", () => {
  assert.deepEqual(extractJson('Sure! {"grade":"B","note":"a } inside a string"} trailing {"x":1}'), { grade: "B", note: "a } inside a string" });
  assert.throws(() => extractJson('{"grade":"B","verdict":"cut o'), /cut off/);
  assert.throws(() => extractJson("no json here"), /no JSON/);
});

test("off-scale grades are folded onto the scale and fake links are stripped", () => {
  assert.equal(parse('{"grade":"D+","score":31}').grade, "D");
  assert.equal(parse('{"grade":" d- ","score":12}').grade, "D");
  assert.equal(parse('{"grade":"E","score":3}').grade, "F");
  assert.throws(() => parse('{"grade":"Great","score":90}'), /unusable grade/);
  const r = parse(JSON.stringify({ grade: "B", score: 250, evidence: [{ claim: "viral post", source: "javascript:alert(1)" }, { claim: "news", source: "https://news.example/a" }], xBuzz: { posts: [{ handle: "a", url: "https://evil.example/x" }, { handle: "b", url: "https://x.com/b/status/1" }] } }));
  assert.equal(r.score, 100);
  assert.deepEqual(r.evidence.map((e) => e.url), [null, "https://news.example/a"]);
  assert.deepEqual(r.xBuzz.posts.map((p) => p.url), [null, "https://x.com/b/status/1"]);
});

test("a brief that stops early is recognised as incomplete", () => {
  assert.match(briefProblem("## The tape\nThe radar has seen 1,264 launches in 281 minutes"), /missing sections/);
  assert.match(briefProblem(`## The tape\n${"x".repeat(300)}\n## Narratives heating up\n- a\n## Coins to watch\n- b\n## Red flags\n- Smart money is piling`), /mid-sentence/);
  assert.equal(briefProblem(`## The tape\n${"Busy tape. ".repeat(40)}\n## Narratives heating up\n- AI: hot.\n## Coins to watch\n- $A: fine.\n## Red flags\n- Dumps everywhere.`), null);
});

test("secrets are never sent to the page, and a blank field does not wipe a saved one", () => {
  S.saveSettings({ discordWebhook: "https://discord.com/api/webhooks/123/SECRETTOKEN", telegramToken: "999:abcdef", minSafety: "70" });
  const pub = S.publicSettings();
  assert.equal(pub.settings.discordWebhook, "");
  assert.deepEqual(pub.secrets.discordWebhook, { set: true, hint: "…OKEN" });
  assert.ok(!JSON.stringify(pub).includes("SECRETTOKEN"));
  S.saveSettings({ discordWebhook: "", minSafety: 65 });
  assert.equal(S.settings.discordWebhook, "https://discord.com/api/webhooks/123/SECRETTOKEN", "blank means keep");
  assert.equal(S.settings.minSafety, 65);
  const trial = S.withOverrides({ telegramChat: "42" });
  assert.equal(trial.telegramChat, "42");
  assert.equal(S.settings.telegramChat, "", "testing saves nothing");
  S.saveSettings({}, { clear: ["discordWebhook", "telegramToken"] });
  assert.equal(S.settings.discordWebhook, "");
});

test("alert rules: unscreened coins, mutes, always-alert and the per-coin cooldown", () => {
  S.saveSettings({ alertCooldownMin: 10, quietStart: "", quietEnd: "", pushUnscreened: false, minSafety: 60 });
  const sig = (o = {}) => ({ id: 1, mint: "MintA", kind: "momentum", safe: 1, ...o });
  assert.equal(N.decide(sig()).push, true);
  assert.equal(N.decide(sig({ kind: "wallet:Wal1", safe: 0 })).push, false, "a wallet buy of a coin that failed safety is not pushed");
  assert.match(N.decide(sig({ kind: "wallet:Wal1", safe: 0 })).why, /did not pass safety/);
  N.rules.set("coin", "MintA", "mute");
  assert.equal(N.decide(sig()).push, false);
  N.rules.set("coin", "MintA", "always");
  assert.equal(N.decide(sig({ safe: 0 })).push, true, "a coin you chose to watch always alerts");
  N.rules.clear("coin", "MintA");
  N.rules.set("wallet", "Wal1", "mute");
  assert.equal(N.decide(sig({ kind: "wallet:Wal1" })).push, false);
  // A push for this coin two minutes ago puts the next ordinary alert inside the cooldown; a warning still goes out.
  db.prepare("INSERT INTO signals (id, mint, kind, t, title, pushed) VALUES (50, 'MintB', 'launch', ?, 'x', 1)").run(Date.now() - 120_000);
  assert.match(N.decide(sig({ id: 51, mint: "MintB" })).why, /grouped/);
  assert.equal(N.decide(sig({ id: 52, mint: "MintB", kind: "liq-pulled" })).push, true);
});

test("an alert raised without passing safety is stored as unscreened, with the reason", () => {
  db.prepare("INSERT INTO tokens (mint, symbol, status, pair, dex, liquidity, price, mcap) VALUES ('MintC', 'MEME', 'dead', 'p', 'pumpswap', 0, 0.001, 1000)").run();
  const v = E.verdict(db.prepare("SELECT * FROM tokens WHERE mint = 'MintC'").get());
  assert.equal(v.ok, false);
  E.raise({ mint: "MintC", score: 0, price: 0.001, mcap: 1000 }, "wallet:Wal9", "Wal9 bought $MEME", "x", 0, { safe: false, why: v.reasons.join("; ") });
  const row = db.prepare("SELECT safe, why_unsafe FROM signals WHERE mint = 'MintC'").get();
  assert.equal(row.safe, 0);
  assert.match(row.why_unsafe, /dead/);
});

test("outcomes and winners are rebuilt from sellable readings only", () => {
  const t0 = Date.now() - 3 * 3600e3, M = 60_000;
  db.prepare("INSERT INTO tokens (mint, symbol, status, pair, dex, liquidity, price, mcap, peak_mcap, graduated, source) VALUES ('RugPump', 'BRYCE', 'dead', 'p', 'pumpswap', 0.01, 0.00099, 993634, 993634, 1, 'gecko')").run();
  const snap = db.prepare("INSERT INTO snapshots (mint, t, price, mcap, liquidity, vol_m5) VALUES ('RugPump', ?, ?, ?, ?, 0)");
  snap.run(t0, 0.00001077, 10770, 6800);                  // real market at the alert
  snap.run(t0 + 10 * M, 0.000012, 12000, 7000);           // +11%: the true peak
  snap.run(t0 + 20 * M, 0.00099, 993634, 0.01);           // pool emptied: "92x" on one cent of liquidity
  snap.run(t0 + 70 * M, 0.00099, 993634, 0.01);
  db.prepare("INSERT INTO signals (id, mint, kind, t, title, price, mcap, p1h, peak) VALUES (900, 'RugPump', 'smart', ?, 'x', 0.00001077, 10770, 92.2, 92.2)").run(t0);
  E.rebuildFromSnapshots();
  const s = db.prepare("SELECT p15, p1h, peak, illiq FROM signals WHERE id = 900").get();
  assert.ok(Math.abs(s.peak - 1.114) < 0.01, `peak is the real +11%, not 92x (got ${s.peak})`);
  assert.equal(s.p1h, 0, "after an hour the coin could not be sold: 0x");
  assert.equal(s.illiq, 1);
  const tok = db.prepare("SELECT peak_mcap, quarantine FROM tokens WHERE mint = 'RugPump'").get();
  assert.equal(tok.peak_mcap, 12000);
  assert.match(tok.quarantine, /\$0\.01/);
});

test("entry rule: enters a steady coin, waits on a falling or run-away one", async () => {
  const { entryBlock } = await import("../server/brain.js");
  const P = { entryChasePct: 50, entryFallPct: 5, entryOffHighPct: 60 };
  const base = { mcap: 40000, ref: 40000, ath: 45000, d15: 1, chg: 4, buys15: 5, sells15: 3, watchedMs: 5000 };
  assert.equal(entryBlock(base, P), null);
  assert.match(entryBlock({ ...base, watchedMs: 1000 }, P), /first seconds/);
  assert.match(entryBlock({ ...base, d15: -9 }, P), /falling/);
  assert.match(entryBlock({ ...base, mcap: 70000 }, P), /pullback/);
  assert.match(entryBlock({ ...base, ath: 200000 }, P), /below its high/);
  assert.match(entryBlock({ ...base, buys15: 2, sells15: 9 }, P), /sellers/);
});

test("traction: real demand scores high, a dead or run-away coin scores low", () => {
  const hot = Q.traction({ stage: "near", mcap: 90000, vol5m: 45000, traders: 120, chg1m: 6, chg5m: 12, chg1h: 60, holders: 200, offAth: 0.95 });
  const dead = Q.traction({ stage: "new", mcap: 4000, vol5m: 300, traders: 4, chg1m: -3, chg5m: -10, chg1h: -40, offAth: 0.4 });
  const late = Q.traction({ stage: "bonded", mcap: 900000, vol5m: 45000, chg5m: 5, chg1h: 400 });
  assert.ok(hot.score >= 80 && hot.up.length >= 4);
  assert.ok(dead.score <= 10 && dead.down.length >= 4);
  assert.ok(late.score < 60);
  assert.equal(Q.tractionOfSources({}), null);
});

test("pick rule by default: live demand or the launch model decides, the AI's call does not", async () => {
  const { pickGate } = await import("../server/brain.js");
  const P = { pickMinTraction: 65, pickMinMcap: 15000, pickMaxMcap: 250000 };
  const r = (o) => ({ score: 20, traction: 70, trade: { action: "watch", pWin: 30 }, ...o });
  assert.equal(pickGate(r(), 80000, P), null);
  assert.equal(pickGate(r({ trade: { action: "avoid", pWin: 2 } }), 80000, P), null, "an AI avoid no longer blocks a coin with real demand");
  assert.match(pickGate(r({ traction: 50, trade: { action: "buy", pWin: 90 } }), 80000, P), /traction/, "an AI buy no longer passes a coin without demand");
  assert.match(pickGate(r(), 5000, P), /below/);
  assert.match(pickGate(r(), 900000, P), /above/);
  assert.match(pickGate(r({ traction: null }), 80000, P), /no live demand/);
  assert.equal(pickGate(r({ traction: 5, early: { strong: true } }), 4000, P), null, "the launch model's top tenth is a pick at any size");
});

test("pick rule with the AI switched back in: needs demand, a sane size, and an AI that does not say avoid", async () => {
  const { pickGate } = await import("../server/brain.js");
  const P = { aiInGate: true, pickMinScore: 40, pickMinTraction: 60, pickMinPwin: 25, pickMinMcap: 15000, pickMaxMcap: 250000 };
  const r = (o) => ({ score: 20, traction: 70, trade: { action: "watch", pWin: 30 }, ...o });
  assert.equal(pickGate(r(), 80000, P), null);
  assert.match(pickGate(r({ trade: { action: "avoid", pWin: 60 } }), 80000, P), /avoid/);
  assert.match(pickGate(r({ traction: 45 }), 80000, P), /traction/);
  assert.match(pickGate(r(), 5000, P), /below/);
  assert.match(pickGate(r(), 900000, P), /above/);
  assert.match(pickGate(r({ trade: { action: "watch", pWin: 10 } }), 80000, P), /chance/);
  assert.equal(pickGate(r({ trade: { action: "buy", pWin: 10 } }), 80000, P), null);
  // a great narrative with no demand is not a pick
  assert.match(pickGate(r({ score: 90, traction: 20 }), 80000, P), /traction/);
  // the trade call is cleaned up on the way in
  assert.equal(parse('{"grade":"C","score":30,"trade":{"action":"BUY ","pWin":"140"}}').trade.pWin, 100);
  assert.equal(parse('{"grade":"C","score":30,"trade":{"action":"maybe"}}').trade.action, null);
});

test("launch model: learns a real pattern and ranks unseen coins by it", async () => {
  const { fit, predict } = await import("../server/early.js");
  // winners have many traders (feature 0); feature 1 is noise
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const X = [], y = [];
  for (let i = 0; i < 400; i++) { const traders = rnd() * 5, noise = rnd(); X.push([traders, noise]); y.push(rnd() < (traders > 3.5 ? 0.6 : 0.05) ? 1 : 0); }
  const m = fit(X, y);
  assert.ok(m.w[0] > 0.5 && Math.abs(m.w[1]) < m.w[0] / 2);
  assert.ok(predict(m, [4.8, 0.5]) > 3 * predict(m, [0.5, 0.5]));
});

test("a quick restart keeps live numbers and launch recordings; a long stop starts fresh", async () => {
  const L = await import("../server/livetrades.js");
  const E = await import("../server/early.js");
  const dir = process.env.RADAR_DATA, t = Date.now();
  const coin = { mint: "KeepMint", first: t - 90e3, mc0: 30, ath: 55, mc: 50, buys: 9, sells: 2, vol: 4, traders: ["a", "b", "c"], hist: [], last: t - 5e3, progress: 0.2, side: "b" };
  const rec = { t0: t - 90e3, l: { mint: "KeepMint", symbol: "KEEP" }, mc0: 30, big: 0, maxBuy: 1, next: 2, prev: null, lastMc: 50,
    cps: [{ cp: 30, entry: 40, hi: 55, res: null, fill: null, feat: {}, p: null }] };
  const write = (age) => {
    fs.writeFileSync(path.join(dir, "live-state.json"), JSON.stringify({ t: t - age, solUsd: 200, coins: [coin] }));
    fs.writeFileSync(path.join(dir, "early-state.json"), JSON.stringify({ t: t - age, recs: [["KeepMint", rec], ["GoneMint", rec]], launches: [rec.l], sent: [] }));
  };
  const ins = db.prepare("INSERT OR REPLACE INTO early (mint, cp, t, symbol, entry, feat) VALUES (?, ?, ?, 'K', 40, '{}')");
  // stopped for 10 minutes: nothing is carried over
  write(10 * 60e3);
  L.loadState();
  assert.equal(L.live.has("KeepMint"), false);
  assert.equal(E.resume(), 0);
  // back within seconds: the coin's numbers and its open recording carry on
  write(4e3);
  ins.run("KeepMint", 30, t - 60e3); ins.run("KeepMint", 60, t - 30e3);   // the 60s checkpoint was written after the last save
  L.loadState();
  assert.equal(L.live.get("KeepMint").traders.size, 3);
  assert.equal(L.feed.solUsd, 200);
  assert.equal(E.resume(), 1);                                             // GoneMint has no live numbers, so it is not resumed
  assert.deepEqual(db.prepare("SELECT cp FROM early WHERE mint = 'KeepMint'").all().map((r) => r.cp), [30]);
  L.live.delete("KeepMint");
  db.prepare("DELETE FROM early WHERE mint = 'KeepMint'").run();
});

test("the same SQL is compiled once and reused", async () => {
  const { dbStats } = await import("../server/db.js");
  const a = db.prepare("SELECT 41 + ? v"), before = dbStats.compiled;
  assert.equal(db.prepare("SELECT 41 + ? v"), a);
  assert.equal(db.prepare("SELECT 41 + ? v").get(1).v, 42);
  assert.equal(dbStats.compiled, before);
});

test("early rule and launch model end to end", async () => {
  const { pickGate, earlyPick } = await import("../server/brain.js");
  const E = await import("../server/early.js");
  const P = { aiInGate: true, pickMinScore: 40, pickMinTraction: 60, pickMinPwin: 25, pickMinMcap: 15000, pickMaxMcap: 250000, earlyMinTraders: 25, earlyMinPwin: 20 };
  const fresh = (o) => ({ score: 50, traction: 30, stage: "new", trade: { action: "watch", pWin: 25 }, live: { traders: 40, buys: 30, sells: 12 }, ...o });
  assert.equal(pickGate(fresh(), 6000, P), null);                                              // small, new, real buyers, AI would trade it
  assert.match(pickGate(fresh({ live: { traders: 8, buys: 30, sells: 12 } }), 6000, P), /traction/);   // too few wallets
  assert.match(pickGate(fresh({ live: { traders: 40, buys: 10, sells: 30 } }), 6000, P), /traction/);  // being sold
  assert.match(pickGate(fresh({ trade: { action: "avoid", pWin: 60 } }), 6000, P), /avoid/);
  assert.equal(pickGate(fresh({ traction: 5, live: null, early: { strong: true } }), 4000, P), null);  // the launch model's top tenth
  // the model trains on matured launches, is judged on unseen ones, and only then scores
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ins = db.prepare("INSERT INTO early (mint, cp, t, symbol, entry, feat, p, res, fill, maxm, endm, done_t) VALUES (?, 60, ?, ?, 40, ?, NULL, ?, ?, 2, 1, ?)");
  const t0 = Date.now() - 20 * 3600e3;
  for (let i = 0; i < 500; i++) {
    const tr = rnd() * 5, win = rnd() < (tr > 3.5 ? 0.6 : 0.06);
    const feat = Object.fromEntries(E.FEATURES.map((k) => [k, rnd()])); feat.traders = tr;
    ins.run(`m${i}`, t0 + i * 60e3, "T", JSON.stringify(feat), win ? "win" : "loss", win ? 2 : 0.5, t0 + i * 60e3);
  }
  const m = E.trainNow().get(60);
  assert.equal(m.status, "working", JSON.stringify({ test: m.test, n: m.n, wins: m.wins, drivers: m.drivers }));
  assert.ok(m.test.top25.winPct > m.test.all.winPct * 1.5 && m.thr5 > m.thr10);
  assert.equal(E.trainNow().get(30).status, "learning");
  // an early signal goes on the entry watch once, labelled as such
  assert.equal(earlyPick({ mint: "EarlyMintX", symbol: "EARLY" }, { p: 0.62, cp: 60 }), true);
  assert.equal(earlyPick({ mint: "EarlyMintX", symbol: "EARLY" }, { p: 0.62, cp: 60 }), false);
  assert.equal(JSON.parse(db.prepare("SELECT r FROM entry_watch WHERE mint = ?").get("EarlyMintX").r).early, true);
});

test("risk guard: a run of losing exits pauses new picks", async () => {
  const { riskGuard } = await import("../server/brain.js");
  const S = await import("../server/settings.js");
  assert.equal(riskGuard(), null);
  const t = Date.now();
  const ins = db.prepare("INSERT INTO outcomes (kind, ref, mint, t0, mcap0, peak_mcap, last_mcap, last_t, exit_mult, exit_t, symbol) VALUES ('pick', ?, ?, ?, 10000, 10000, 5000, ?, 0.55, ?, 'L')");
  for (let i = 0; i < S.settings.guardLosses; i++) ins.run(`guard${i}:x`, `guard${i}`, t - 60e3 * (i + 2), t, t - 1000 * (i + 1));
  await new Promise((r) => setTimeout(r, 5100));   // the guard re-checks every five seconds
  const g = riskGuard();
  assert.match(g.why, /losing exits in a row/);
  assert.ok(g.until > t);
  db.prepare("DELETE FROM outcomes WHERE ref LIKE 'guard%'").run();
});

test("exit rules on a tape: targets fill at their level, stops fill where the price actually was", async () => {
  const R = await import("../server/rules.js");
  const bars = (ms) => ms.map((m, i) => [i * 10, 10000 * m]);
  const cost = R.costOf(3);
  // runs to 2.4x then gives it back: half out at 2x, the rest on the trail
  const run = R.simExit(bars([1, 1.4, 2.4, 2.0, 1.5, 1.2]), 0);
  assert.equal(run.why, "take-profit, then trail");
  assert.ok(Math.abs(run.x - (0.5 * 2 + 0.5 * 1.5) * cost) < 1e-9);
  // gaps straight through a -40% stop: the fill is the 0.3 it printed, not the 0.6 the rule names
  const gap = R.simExit(bars([1, 0.95, 0.3, 0.2]), 0);
  assert.equal(gap.why, "stop");
  assert.ok(Math.abs(gap.x - 0.3 * cost) < 1e-9);
  // no stop, but out after 3 minutes if it has gone nowhere
  const flat = R.simExit(bars([1, ...Array(20).fill(0.9)]), 0, { stopPct: 0, flatMin: 3, flatX: 1 });
  assert.equal(flat.why, "flat");
  assert.equal(flat.secs, 180);
  // a tape that ends with the position still open sells at the last price
  assert.equal(R.simExit(bars([1, 1.1, 1.2]), 0).why, "end of tape");
  // an order is filled on the first bar after the decision, never on one already past
  assert.equal(R.entryBar(bars([1, 1, 1, 1]), 12, 1), 2);
  assert.equal(R.entryBar(bars([1, 1]), 500), -1);
  // walk-forward: on coins that all double then die, selling everything at the target beats trailing half
  const entries = Array.from({ length: 40 }, () => ({ bars: bars([1, 1.6, 2.1, 0.4, 0.1]), i0: 0 }));
  const wf = R.walkForward(entries);
  assert.ok(wf.best.test.avg > wf.base.test.avg && wf.best.test.n === 12);
});

test("tapes: bars are saved in chunks and read back as one record", async () => {
  const T = await import("../server/tape.js");
  db.prepare("INSERT INTO tape (mint, t, t0, bars) VALUES ('TapeMint', 1, 1000, ?)").run(JSON.stringify([[0, 10000, 3, 1, 4], [2, 12000, 5, 1, 6]]));
  db.prepare("INSERT INTO tape (mint, t, t0, bars) VALUES ('TapeMint', 2, 1000, ?)").run(JSON.stringify([[5, 9000, 5, 4, 7]]));
  // a later recording of the same coin (after it bonded) started its own clock 60 seconds in
  db.prepare("INSERT INTO tape (mint, t, t0, bars) VALUES ('TapeMint', 3, 61000, ?)").run(JSON.stringify([[1, 20000, null, null, null]]));
  const tp = T.readTape("TapeMint");
  assert.equal(tp.t0, 1000);
  assert.deepEqual(tp.bars.map((b) => b[0]), [0, 2, 5, 61]);
  assert.equal(T.readTape("NoSuchMint"), null);
});

test("narrative bursts: several launchers on one word or one post, with real buyers behind them", async () => {
  const C = await import("../server/clusters.js");
  assert.deepEqual([...C.textKeys({ symbol: "$BLOBBY", name: "Blobby the official VS Code pet" })].sort(), ["w:blobby", "w:code", "w:pet"]);
  assert.deepEqual([...C.linkKeys({ twitter: "https://x.com/code/status/1234567890?s=20", website: "https://www.blobby.dev/" })].sort(), ["d:blobby.dev", "x:1234567890"]);
  assert.deepEqual([...C.linkKeys({ twitter: "https://x.com/BlobbyPet", website: "https://x.com/home" })], ["h:blobbypet"]);
  assert.deepEqual([...C.linkKeys({ website: "javascript:alert(1)" })], []);
  const t = Date.now(), MIN = 60e3;
  const member = (i, mins, dev) => ({ mint: `m${i}`, symbol: "BLOBBY", name: "Blobby", creator: dev, t: t - mins * MIN });
  const stats = (rows) => (mint) => rows[mint] && { traders: { size: rows[mint][0] }, buys: rows[mint][1], sells: rows[mint][2], vol: 3, mc: 60, mc0: 30, ath: 90 };
  const five = [member(1, 8, "a"), member(2, 6, "b"), member(3, 4, "c"), member(4, 2, "d"), member(5, 1, "e")];
  // five launchers in ten minutes on a word that never appeared before, one coin with 45 real buyers
  const hot = C.measure("w:blobby", five.map((m) => m.t), five, t, stats({ m1: [45, 60, 20], m3: [6, 5, 2] }));
  assert.equal(hot.forming, true);
  assert.equal(hot.lead.mint, "m1");
  assert.ok(hot.lift > 10 && hot.devs === 5 && hot.traders === 51);
  // the same burst with nobody buying is launch spam: recorded, never looked up
  const spam = C.measure("w:blobby", five.map((m) => m.t), five, t, stats({ m1: [4, 3, 1] }));
  assert.ok(spam.burst && !spam.money && !spam.forming);
  // one person launching five copies is not a narrative
  const farm = five.map((m) => ({ ...m, creator: "same" }));
  assert.equal(C.measure("w:blobby", farm.map((m) => m.t), farm, t, stats({ m1: [45, 60, 20] })).forming, false);
  // a word that shows up all day (a dog coin every few minutes) is not a burst at the same count
  const always = Array.from({ length: 70 }, (_, i) => t - (170 - i * 2.4) * MIN);
  assert.equal(C.measure("w:dog", [...always, ...five.map((m) => m.t)].sort((a, b) => a - b), five, t, stats({ m1: [45, 60, 20] })).burst, false);
  // three launches linking the same post are enough
  const three = five.slice(2);
  assert.equal(C.measure("x:1234567890", three.map((m) => m.t), three, t, stats({ m3: [41, 50, 9] })).forming, true);
});

test("one story is one narrative row, however many times it is found", async () => {
  const C = await import("../server/clusters.js");
  await import("../server/brain.js");
  const a = C.upsertNarrative({ name: "Blobby VS Code pet", stage: "early", thesis: "first", keywords: ["blobby", "vscode", "pet"], confidence: 55, source: "cluster", clusterKey: "w:blobby", detectMs: 21000 });
  assert.equal(a.updated, false);
  // the scout finds the same story under a slightly different name an hour later
  const b = C.upsertNarrative({ name: "VS Code's Blobby", stage: "running", thesis: "second", keywords: ["blobby", "pet", "code"], confidence: 70, source: "scout" });
  assert.deepEqual([b.id, b.updated], [a.id, true]);
  const row = db.prepare("SELECT * FROM narrative_calls WHERE id = ?").get(a.id);
  assert.deepEqual([row.stage, row.confidence, row.seen, row.source, row.detect_ms], ["running", 70, 2, "cluster", 21000]);
  assert.equal(C.upsertNarrative({ name: "Something else entirely", stage: "early", keywords: ["moose", "troy"], confidence: 40 }).updated, false);
});

test("Grok budget: each job stops at its share of the day, narrative work last", async () => {
  const G = await import("../server/grok.js");
  const S = await import("../server/settings.js");
  const was = S.settings.grokDailyBudget;
  S.settings.grokDailyBudget = 2;
  for (const lane of ["narrative", "scout", "deep", "quick"]) assert.equal(G.grokOver(lane), null);
  // a searched scout that cost $1.30 (the API reports cost in ticks, ten billion to the dollar)
  assert.equal(G.record("scout", "grok-4.7", 9000, { cost_in_usd_ticks: 1.3e10, total_tokens: 9000, num_server_side_tools_used: 3 }), 1.3);
  assert.equal(db.prepare("SELECT cost FROM ai_spend WHERE lane = 'scout'").get().cost, 1.3);
  assert.match(G.grokOver("scout"), /scout calls stop at \$1\.20/);
  assert.equal(G.grokOver("narrative"), null, "narrative cards may still use what is left");
  assert.equal(G.grokOver("quick"), null, "quick calls have spent nothing of their own share");
  G.record("quick", "grok-4-fast-non-reasoning", 1000, { cost_in_usd_ticks: 0.5e10 });
  assert.match(G.grokOver("quick"), /quick reads have used \$0\.50/);
  G.record("narrative", "grok-4.7", 7000, { cost_in_usd_ticks: 0.3e10 });
  assert.match(G.grokOver("narrative"), /daily budget of \$2\.00 is spent/);
  assert.equal(G.grokOver("bench"), null, "the benchmark is never held back");
  assert.equal(G.grokSpend().lanes.scout.calls, 1);
  S.settings.grokDailyBudget = 0;
  assert.equal(G.grokOver("quick"), null, "a budget of 0 means no limit");
  S.settings.grokDailyBudget = was;
});

test("holder ledger: dev, snipers, bundle and top 10 come from the trade feed alone", async () => {
  const H = await import("../server/holders.js");
  const mint = "HOLDMINT";
  E.launchIndex.set(mint, { mint, creator: "DEV", seen: Date.now() });
  const s = { progress: 0 };
  const trade = (user, tokens, buy, slot) => { s.progress = Math.max(0, Math.min(1, s.progress + (buy ? tokens : -tokens) / 793_100_000)); H._onTrade(mint, s, 1, buy, { user, tokens, slot }); };
  trade("DEV", 50e6, true, 100);        // the curve's first trade, from zero sold: the ledger is complete from here
  trade("B1", 20e6, true, 100);         // same block as the first trade: a bundle
  trade("S1", 10e6, true, 101);         // next block: a sniper
  trade("S2", 5e6, true, 102);          // two blocks later: still a sniper
  trade("N1", 8e6, true, 110);          // an ordinary buyer
  let h = H.holdersFor(mint);
  assert.deepEqual([h.genesis, h.partial, h.holders, h.top10], [true, false, 5, 9.3]);
  assert.deepEqual([h.dev.pct, h.dev.sold, h.top[0].tag], [5, null, "dev"]);
  assert.deepEqual([h.bundle.n, h.bundle.pct, h.snipers.n, h.snipers.pct], [1, 2, 2, 1.5]);
  trade("DEV", 49.5e6, false, 120);     // the dev dumps 99% of what it held
  trade("S1", 10e6, false, 121);        // one sniper out
  h = H.holdersFor(mint);
  assert.deepEqual([h.dev.sold, h.snipers.sold, h.holders], ["all", 1, 4]);
  assert.equal(H.liveHolders(mint)[3], 2, "the live push carries dev-sold as 2");
  assert.equal(H.rowHolders(mint).ds, "all");
  // A coin whose first trade the radar missed: holders are partial, and no sniper or bundle figure is claimed.
  H._onTrade("LATEMINT", { progress: 0.4 }, 1, true, { user: "X", tokens: 1e6, slot: 5 });
  const late = H.holdersFor("LATEMINT");
  assert.deepEqual([late.partial, late.genesis, late.snipers, late.bundle, late.holders], [true, false, null, null, 1]);
});

test("paper desk: sizes parse, a buy needs a live price, and sells book 3% each way", async () => {
  const P = await import("../server/paper.js");
  S.settings.quickSizes = "1, 0.25,0.1, bad, 0.25";
  assert.deepEqual(P.sizes(), [0.1, 0.25, 1]);
  S.settings.quickSizes = ["0.1", "0.5"];
  assert.deepEqual(P.sizes(), [0.1, 0.5]);
  assert.throws(() => P.open("So11111111111111111111111111111111111111112", 0.5), /No live price/);
  assert.throws(() => P.open("nope", 0.5), /not a Solana address/);
  assert.throws(() => P.open("So11111111111111111111111111111111111111112", 0), /between 0 and 1000/);
  // A position entered at $50k and sold at $100k: 2x less 3% each way = 1.88x on each half.
  db.prepare("INSERT INTO paper (mint, symbol, t, sol, usd, mcap0, src, peak, low, last, last_t) VALUES ('M', 'M', ?, 1, 100, 50000, 'live', 50000, 50000, 50000, ?)").run(Date.now(), Date.now());
  const id = db.prepare("SELECT id FROM paper WHERE mint = 'M'").get().id;
  const half = P.sell(id, 50, { why: "test", mcap: 100000 });
  assert.deepEqual([half.status, half.usd, half.sol], ["open", 50, 0.5]);
  assert.equal(P.sell(id, 100, { why: "test", mcap: 100000 }).status, "closed");
  const closed = db.prepare("SELECT pnl FROM paper WHERE mint = 'M' AND status = 'closed'").all();
  assert.equal(closed.length, 2);
  const mult = 2 * (0.97 / 1.03);
  for (const c of closed) assert.ok(Math.abs(c.pnl - 50 * (mult - 1)) < 1e-6, `pnl ${c.pnl}`);
  const d = P.desk();
  assert.deepEqual([d.summary.allN, d.summary.open, Math.round(d.summary.allPnl)], [2, 0, 88]);
  assert.throws(() => P.sell(id, 100, { mcap: 1 }), /No open paper position/);
});

test("paper desk: trade-panel fills use the real curve quote (fee + price impact), round trip loses both", async () => {
  const P = await import("../server/paper.js");
  const L = await import("../server/livetrades.js");
  const mint = "QuoteTest" + "1".repeat(31) + "pump";
  // A fresh pump.fun curve: 30 SOL / 1.073B virtual, 1.25% fee.
  L.live.set(mint, { mint, mc: 28, progress: 0, vSol: 30, vTok: 1_073_000_000, feeBps: 125, resT: Date.now(), last: Date.now(), buys: 0, sells: 0, traders: new Set(), hist: [] });
  L.feed.connected = true; L.feed.lastMsg = Date.now(); L.feed.solUsd = 100; L.feed.solKnown = true;
  const pos = await P.openQuoted(mint, 1);
  // 1 SOL gross -> 1/1.0125 net into the curve -> tokens = vTok - k/(vSol + net)
  const net = 1 / 1.0125, tokens = 1_073_000_000 - (30 * 1_073_000_000) / (30 + net);
  assert.ok(Math.abs(pos.tokens - tokens) < 1e-3, `tokens ${pos.tokens} vs ${tokens}`);
  assert.equal(pos.fill.src, "curve");
  assert.ok(pos.fill.impactPct > 3 && pos.fill.impactPct < 5, `impact ${pos.fill.impactPct}`);
  // Selling right back (the reserves did not move: our paper buy is not on chain) returns less than 1 SOL.
  const sold = await P.sellQuoted(pos.id, 100);
  assert.equal(sold.status, "closed");
  // Only the fee both ways: 1 / 1.0125 into the curve, back out less 1.25%.
  assert.ok(Math.abs(sold.exit_sol - (1 / 1.0125) * 0.9875) < 1e-9, `exit ${sold.exit_sol}`);
  assert.ok(Math.abs(sold.pnl - (sold.exit_sol - 1) * 100) < 1e-6);
  L.live.delete(mint);
});

test("quotes use the current Jupiter host and the token's actual decimals", async (t) => {
  const { quote } = await import("../server/quote.js");
  const L = await import("../server/livetrades.js");
  const mint = "JupTest" + "1".repeat(33);
  L.feed.solKnown = true; L.feed.solUsd = 100;
  t.mock.method(globalThis, "fetch", async (input) => {
    const u = new URL(input);
    assert.equal(u.hostname, "api.jup.ag");
    if (u.pathname === "/price/v3") return Response.json({ [mint]: { decimals: 9, usdPrice: 2 } });
    assert.equal(u.searchParams.get("amount"), "100000000");
    return Response.json({ outAmount: "5000000000", otherAmountThreshold: "4850000000", priceImpactPct: "0.01", routePlan: [] });
  });
  const q = await quote(mint, "buy", 0.1);
  assert.equal(q.outTokens, 5);
  assert.equal(q.minOut, 4.85);
});

test("quotes reject unknown decimals rather than inventing token amounts", async (t) => {
  const { quote } = await import("../server/quote.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(quote("UnknownTest" + "1".repeat(30), "buy", 0.1), /decimals|precision/i);
});

test("Jupiter rate limits are reported as rate limits, not a missing route", async (t) => {
  const { quote } = await import("../server/quote.js");
  const mint = "RateTest" + "1".repeat(32);
  t.mock.method(globalThis, "fetch", async (input) => new URL(input).pathname === "/price/v3"
    ? Response.json({ [mint]: { decimals: 6, usdPrice: 1 } })
    : new Response("Rate limit exceeded", { status: 429 }));
  await assert.rejects(quote(mint, "buy", 0.1), (e) => e.status === 429 && /rate limit/i.test(e.message));
});

test("quotes reject infinite amounts before contacting a provider", async (t) => {
  const { quote } = await import("../server/quote.js");
  t.mock.method(globalThis, "fetch", async () => { assert.fail("invalid sizes must not reach the provider"); });
  await assert.rejects(quote("FiniteTest" + "1".repeat(30), "buy", Infinity), (e) => e.status === 400);
});

test("simultaneous paper sells cannot spend the same position twice", async () => {
  const P = await import("../server/paper.js");
  const L = await import("../server/livetrades.js");
  const mint = "RaceTest" + "1".repeat(32);
  L.live.set(mint, { mint, mc: 28, progress: 0, vSol: 30, vTok: 1_073_000_000, feeBps: 125, resT: Date.now(), last: Date.now(), buys: 0, sells: 0, traders: new Set(), hist: [] });
  L.feed.connected = true; L.feed.lastMsg = Date.now(); L.feed.solUsd = 100; L.feed.solKnown = true;
  try {
    const pos = await P.openQuoted(mint, 1);
    const result = await Promise.allSettled([P.sellQuoted(pos.id, 50), P.sellQuoted(pos.id, 50)]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(result.find((r) => r.status === "rejected").reason.status, 409);
    const rows = P.positionsFor(mint);
    assert.equal(rows.filter((p) => p.status === "closed").length, 1);
    assert.equal(rows.find((p) => p.status === "open").sol, 0.5);
    assert.equal(rows.reduce((s, p) => s + p.sol, 0), 1);
  } finally { L.live.delete(mint); }
});

test("Jupiter requests share pacing, coalesce duplicates and honor cooldown", async () => {
  const { createJupiterClient } = await import("../server/jupiter.js");
  let time = 1000, limited = false;
  const calls = [];
  const get = createJupiterClient({ clock: () => time, sleep: async (ms) => { time += ms; }, key: () => "",
    request: async (url) => { calls.push({ url, time }); return limited ? new Response("limit", { status: 429, headers: { "retry-after": "5" } }) : Response.json({ price: 10 }); },
  });
  const [a, b] = await Promise.all([get("/price/v3?ids=A", { cacheMs: 30000 }), get("/price/v3?ids=A", { cacheMs: 30000 })]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  await get("/price/v3?ids=A", { cacheMs: 30000 });
  assert.equal(calls.length, 1, "fresh prices are reused");
  await get("/swap/v1/quote?amount=1");
  assert.ok(calls[1].time - calls[0].time >= 2000);
  limited = true;
  await assert.rejects(get("/swap/v1/quote?amount=2"), (e) => e.status === 429);
  const count = calls.length;
  await assert.rejects(get("/swap/v1/quote?amount=3"), (e) => e.status === 429);
  assert.equal(calls.length, count, "cooldown prevents another upstream request");
  time += 5000; limited = false;
  assert.deepEqual(await get("/swap/v1/quote?amount=3"), { price: 10 });
});

test("Jupiter API keys remain secret and are sent only to the Jupiter API", async () => {
  const { createJupiterClient } = await import("../server/jupiter.js");
  S.saveSettings({ jupiterKey: "test-jupiter-key" });
  assert.equal(S.publicSettings().settings.jupiterKey, "");
  assert.equal(S.publicSettings().secrets.jupiterKey.set, true);
  S.saveSettings({ jupiterKey: "" });
  assert.equal(S.settings.jupiterKey, "test-jupiter-key");
  const get = createJupiterClient({ request: async (url, opts) => {
    assert.equal(new URL(url).origin, "https://api.jup.ag");
    assert.equal(opts.headers["x-api-key"], "test-jupiter-key");
    return Response.json({ ok: true });
  } });
  await get("/price/v3?ids=A");
  S.saveSettings({}, { clear: ["jupiterKey"] });
  assert.equal(S.settings.jupiterKey, "");
});

test("legacy paper sell previews include dollar conversion and reject stale prices", async () => {
  const P = await import("../server/paper.js");
  const L = await import("../server/livetrades.js");
  L.feed.solKnown = true; L.feed.solUsd = 120;
  const mint = "PreviewTest" + "1".repeat(29), now = Date.now();
  db.prepare("INSERT INTO tokens (mint, mcap, price_t, updated) VALUES (?, 50000, ?, ?)").run(mint, now, now);
  const p = P.open(mint, 1);
  const q = await P.previewSell(p.id, 50);
  assert.equal(q.solUsd, 120);
  assert.equal(q.solIn, 0.5);
  assert.ok(q.outSol > 0 && q.outSol < 0.5);
  db.prepare("UPDATE tokens SET price_t = 1, updated = 1 WHERE mint = ?").run(mint);
  await assert.rejects(P.previewSell(p.id), (e) => e.status === 409);
});

test("startup history lookup uses a coin index instead of scanning every prior grade", () => {
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM outcomes WHERE kind = 'grade' AND mint = ?").all("StartupMint");
  assert.ok(plan.some((step) => /SEARCH.*mint=\?/.test(step.detail)), JSON.stringify(plan));
});

test("a coin without a Jupiter route does not mark the provider offline", async () => {
  const { createJupiterClient } = await import("../server/jupiter.js");
  const health = await import("../server/health.js");
  const before = health.part("jupiter");
  const get = createJupiterClient({ request: async () => Response.json({ error: "No routes found" }, { status: 400 }) });
  await assert.rejects(get("/swap/v1/quote?amount=1"), (e) => e.status === 409);
  assert.equal(health.part("jupiter").fail, before.fail);
  assert.equal(health.part("jupiter").ok, before.ok + 1);
});

test("unquotable paper positions back off instead of exhausting the quote allowance", async () => {
  const P = await import("../server/paper.js");
  const mint = "RetryTest" + "1".repeat(31);
  db.prepare("INSERT INTO paper (mint, sol, usd, tokens, status) VALUES (?, 1, 100, 1000, 'open')").run(mint);
  let calls = 0;
  const unavailable = async (m) => { if (m === mint) calls++; throw Object.assign(new Error("No routes found"), { status: 409 }); };
  await P.refreshExitQuotes(unavailable);
  await P.refreshExitQuotes(unavailable);
  assert.equal(calls, 1);
});

test("paper totals include the complete history and disclose unavailable valuations", async () => {
  const P = await import("../server/paper.js");
  const insert = db.prepare("INSERT INTO paper (mint, status, exit_t, pnl, sol, usd) VALUES ('SummaryTest', 'closed', ?, 2, 1, 100)");
  for (let i = 0; i < 65; i++) insert.run(Date.now() - i);
  const d = P.desk(), today = new Date(); today.setHours(0, 0, 0, 0);
  assert.equal(d.closed.length, 60, "the displayed history stays bounded");
  assert.equal(d.summary.allPnl, db.prepare("SELECT SUM(pnl) n FROM paper WHERE status = 'closed'").get().n);
  assert.equal(d.summary.todayN, db.prepare("SELECT COUNT(*) n FROM paper WHERE status = 'closed' AND exit_t >= ?").get(today.getTime()).n);
  assert.equal(d.summary.openUnpriced, d.open.filter(p => p.stale || p.pnl == null).length);
  if (d.summary.openUnpriced) assert.equal(d.summary.openPnl, null, "a missing valuation is not zero profit");
});

test("RPC stream recovers from a stalled handshake and a missing close event", async (t) => {
  const { startRpcStream } = await import("../server/rpc-stream.js");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sockets = [], states = [];
  class Socket { constructor() { this.readyState = 0; sockets.push(this); } close() {} send() {} }
  const stop = startRpcStream({ url: () => "wss://rpc.example", request: {}, WebSocketImpl: Socket, onStatus: s => states.push(s) });
  t.mock.timers.tick(10_000); t.mock.timers.tick(3000);
  assert.equal(sockets.length, 2, "a handshake cannot hang forever");
  sockets[1].onerror(); t.mock.timers.tick(3000);
  assert.equal(sockets.length, 3, "recovery must not depend on close firing");
  stop(); t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 3, "stopping cancels pending reconnects");
  assert.ok(states.some(s => s.error));
});

test("RPC stream requires subscription acknowledgement and rejects provider errors", async (t) => {
  const { startRpcStream } = await import("../server/rpc-stream.js");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sockets = [], states = [], events = [];
  class Socket { constructor() { sockets.push(this); } close() {} send() {} }
  const stop = startRpcStream({ url: () => "wss://rpc.example", request: {}, WebSocketImpl: Socket, onStatus: s => states.push(s), onEvent: d => events.push(d) });
  sockets[0].onopen();
  assert.equal(states.at(-1).connected, false);
  sockets[0].onmessage({ data: JSON.stringify({ id: 1, error: { code: -32005, message: "rate limited" } }) });
  assert.equal(states.at(-1).connected, false);
  t.mock.timers.tick(3000);
  sockets[1].onopen();
  sockets[1].onmessage({ data: JSON.stringify({ id: 1, result: 42 }) });
  assert.equal(states.at(-1).connected, true);
  sockets[1].onmessage({ data: JSON.stringify({ method: "logsNotification", params: { result: {} } }) });
  assert.equal(events.length, 1);
  stop();
});

test("old price history thins to each 5 minutes' high and low and leaves the last day alone", async () => {
  const { thinSnapshots, meta } = await import("../server/db.js");
  const now = Date.now(), old = Math.floor((now - 30 * 3600e3) / 300_000) * 300_000;
  db.exec("DELETE FROM snapshots");
  meta.set("snap_thin_t", 0);
  const ins = db.prepare("INSERT INTO snapshots (mint, t, price, mcap, liquidity, vol_m5, ok) VALUES (?, ?, 1, ?, 1, 1, 1)");
  [50, 90, 20, 70, 60].forEach((mc, i) => ins.run("ThinA", old + i * 30_000, mc));     // one 5-minute bucket, a day and more old
  [5, 6].forEach((mc, i) => ins.run("ThinB", old + i * 30_000, mc));
  [1, 2, 3].forEach((mc, i) => ins.run("ThinA", now - 3600e3 + i * 30_000, mc));        // an hour old: untouched
  assert.equal(thinSnapshots(now), 3);
  assert.deepEqual(db.prepare("SELECT mcap FROM snapshots WHERE mint = 'ThinA' AND t < ? ORDER BY mcap").all(now - 864e5).map((r) => r.mcap), [20, 90]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM snapshots WHERE mint = 'ThinB'").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM snapshots WHERE t > ?", ).get(now - 2 * 3600e3).n, 3);
  assert.equal(thinSnapshots(now), 0, "already thinned up to a day ago");
  db.exec("DELETE FROM snapshots");
});
