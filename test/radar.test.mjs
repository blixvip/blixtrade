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

test("pick rule: needs demand, a sane size, and an AI that does not say avoid", async () => {
  const { pickGate } = await import("../server/brain.js");
  const P = { pickMinScore: 40, pickMinTraction: 60, pickMinPwin: 25, pickMinMcap: 15000, pickMaxMcap: 250000 };
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
  const P = { pickMinScore: 40, pickMinTraction: 60, pickMinPwin: 25, pickMinMcap: 15000, pickMaxMcap: 250000, earlyMinTraders: 25, earlyMinPwin: 20 };
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
