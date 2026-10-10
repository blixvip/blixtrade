// The trade journal (server/journal.js) and the list mini charts' shape rules (server/spark.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RADAR_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
const J = await import("../server/journal.js");
const C = await import("../server/candles.js");
const { holdFlat, candlePts, downsample } = await import("../server/spark.js");
const { db } = await import("../server/db.js");

// ---------- building chain data ----------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Buffer.from(out);
}
const pad32 = (b) => Buffer.concat([Buffer.alloc(32 - b.length), b]);
const MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump", OTHER = "6UGNg119LV6YjSCQ5K6Z6jsLLLetpMJ1vPdhiU8qpump";
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
// A pump.fun TradeEvent: mint, sol, tokens, buy, user, timestamp, virtual sol, virtual tokens, real sol, real tokens.
function tradeEvent({ mint = MINT, sol = 1e9, tokens = 1e12, buy = true, vSol = 30e9, vTok = 1000e12 } = {}) {
  return Buffer.concat([Buffer.from("bddb7fd34ee661ee", "hex"), pad32(b58decode(mint)), u64(sol), u64(tokens), Buffer.from([buy ? 1 : 0]),
    Buffer.alloc(32, 7), u64(1_700_000_000), u64(vSol), u64(vTok), u64(1e9), u64(500e12)]);
}
const log = (buf) => `Program data: ${buf.toString("base64")}`;
let sigN = 0;
const sig = () => `sig${++sigN}`.padEnd(88, "x");

// ---------- decoding ----------
test("decodes every trade event in a transaction, in order, and none from a failed one", () => {
  const logs = ["Program log: Instruction: Buy", log(tradeEvent({ sol: 1e9 })), "Program log: noise", log(tradeEvent({ mint: OTHER, sol: 2e9, buy: false })), log(Buffer.from("0000000000000000aa", "hex"))];
  const ev = J.eventsFromLogs(logs);
  assert.equal(ev.length, 2);
  assert.deepEqual(ev.map((e) => [e.mint, e.sol, e.buy]), [[MINT, 1, true], [OTHER, 2, false]]);
  assert.equal(ev[0].mcSol, (30 / 1e9) * 1e9);            // vSol / vTok tokens, 1B supply
  assert.deepEqual(J.eventsFromLogs(logs, { InstructionError: [0, "Custom"] }), []);
});

// ---------- identity and deduplication ----------
test("a trade has one row however many feeds deliver it; identical swaps in one transaction stay separate", () => {
  const s = sig(), t = Date.now();
  const x = { mint: MINT, sig: s, venue: J.VENUE.curve, sol: 1, tokens: 1000, buy: true, mcUsd: 5000, usd: 150, slot: 1, t };
  J.record(x); J.record(x);                                // two identical swaps in the same transaction
  J.flush();
  assert.equal(J.trades(MINT, t - 1).length, 2);
  // The same transaction read back from the chain (keys counted the same way) adds nothing.
  const k0 = J.tradeKey(s, MINT, 0), k1 = J.tradeKey(s, MINT, 1);
  assert.notEqual(k0, k1);
  const ins = db.prepare("INSERT OR IGNORE INTO j_trades (mid, t, k, slot, mc, usd, buy, venue, st, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)");
  assert.equal(Number(ins.run(J.midOf(MINT), t + 900, k0, 1, 5000, 150, 1, 1).changes), 0);   // a later time, same trade
  assert.equal(J.trades(MINT, t - 1).length, 2);
});

// ---------- candles: live and replayed are the same ----------
test("candles built live and candles rebuilt from the journal are identical", () => {
  const live = "LiveCandLes111111111111111111111111111pump", base = Date.now() - 60_000;
  const steps = [[0, 1000, 10, true], [200, 1100, 5, true], [900, 900, 7, false], [1500, 950, 3, true], [1501, 990, 1, true], [4200, 800, 9, false], [4300, 1200, 4, true]];
  for (const [dt, mc, usd, buy] of steps) {
    C.addTrade(live, mc, usd, buy, base + dt);
    J.record({ mint: live, sig: sig(), venue: J.VENUE.curve, sol: usd / 150, tokens: 1, buy, mcUsd: mc, usd, t: base + dt });
  }
  const fromLive = C.series(live, 0), statsLive = C.windowStats(live, 0);
  C.setBook(live, J.buckets(J.trades(live, base - 1)));
  assert.deepEqual(C.series(live, 0), fromLive);
  assert.deepEqual(C.windowStats(live, 0), statsLive);
  assert.equal(statsLive.buys + statsLive.sells, steps.length);
});

// ---------- confirmation ----------
test("confirmed trades are marked; failed and never-landed ones are removed and their coin rebuilt", async () => {
  const coin = "ConfirmCoin11111111111111111111111111pump", t = Date.now() - 200_000;
  const [a, b, c, d] = [sig(), sig(), sig(), sig()];
  for (const s of [a, b, c, d]) J.record({ mint: coin, sig: s, venue: J.VENUE.curve, sol: 1, tokens: 1, buy: true, mcUsd: 4000, usd: 150, t });
  J.flush();
  const revised = [];
  J.onRevised((m) => revised.push(m));
  // a confirmed, b failed, c not known long after (abandoned block), d not known yet but young? (all old here)
  const status = (sigs) => sigs.map((s) => (s === a ? { err: null, confirmationStatus: "confirmed" } : s === b ? { err: { InstructionError: [0, "x"] }, confirmationStatus: "confirmed" } : s === d ? { err: null, confirmationStatus: "processed" } : null));
  // 95 s on: past DROP_MS but inside the node's status cache, so a null answer means it never landed.
  const asked = await J.confirmSweep(status, Date.now() + 95_000);
  assert.ok(asked >= 4);
  const rows = J.trades(coin, t - 1);
  assert.equal(rows.length, 2);                            // a (confirmed) and d (still processed)
  assert.deepEqual(rows.map((r) => r.st).sort(), [0, 1]);
  assert.ok(revised.includes(coin));
});

test("a signature too old for the status cache is kept as unverified, not deleted (a sweep running late)", async () => {
  const coin = "StaleCoin1111111111111111111111111111pump", t = Date.now() - 200_000;
  const e = sig();
  J.record({ mint: coin, sig: e, venue: J.VENUE.curve, sol: 1, tokens: 1, buy: true, mcUsd: 4000, usd: 150, t });
  J.flush();
  const before = J.stats.unverified;
  await J.confirmSweep(() => [null], Date.now() + 120_000);   // 2 min on: the cache no longer knows it
  assert.equal(J.trades(coin, t - 1).length, 1);
  assert.ok(J.stats.unverified >= before + 1);   // (the earlier test's still-processed one ages out here too)
});

// ---------- gaps and repair ----------
test("an outage is a gap until the coin is read back in full; read-back adds only what was missed", async () => {
  const coin = MINT, t0 = Date.now() - 50_000, t1 = Date.now() - 20_000;
  J.noteSol(150, t0 - 120_000);
  const id = J.gapStart("pump", t0, "test"); J.gapEnd("pump", t1);
  assert.deepEqual(J.gapsFor(coin, t0 - 1000).at(-1), [t0, t1]);
  // The chain holds two transactions inside the gap: one the live feed already had, one it missed.
  const heard = sig(), missed = sig(), bt = Math.floor((t0 + 10_000) / 1000);
  J.record({ mint: coin, sig: heard, venue: J.VENUE.curve, sol: 1, tokens: 1e6, buy: true, mcUsd: 4500, usd: 150, t: t0 + 9000 });
  J.flush();
  const before = J.trades(coin, t0).length;
  const call = async (method, params) => {
    if (method === "getSignaturesForAddress") return [{ signature: missed, blockTime: bt + 1, err: null }, { signature: heard, blockTime: bt, err: null }, { signature: "old".padEnd(88, "x"), blockTime: bt - 1000, err: null }];
    if (method === "getTransaction") return { slot: 9, blockTime: params[0] === heard ? bt : bt + 1, meta: { err: null, logMessages: [log(tradeEvent({ mint: coin, sol: 1e9, tokens: 1e12 }))] } };
  };
  const r = await J.repairMint(coin, t0, t1, { call });
  assert.equal(r.full, true);
  assert.equal(r.n, 1);                                     // the heard one was already there
  assert.equal(J.trades(coin, t0).length, before + 1);
  J.markRepaired(id, coin, r.n, r.full);
  assert.equal(J.gapsFor(coin, t0 - 1000).some(([a]) => a === t0), false);
  assert.ok(J.gapsFor(OTHER, t0 - 1000).some(([a]) => a === t0));   // another coin's gap is not repaired
});

test("old trades are pruned after a day", async () => {
  const coin = "PruneCoin1111111111111111111111111111pump";
  J.record({ mint: coin, sig: sig(), venue: J.VENUE.curve, sol: 1, tokens: 1, buy: true, mcUsd: 1, usd: 1, t: Date.now() - J.KEEP_MS - 5000 });
  J.record({ mint: coin, sig: sig(), venue: J.VENUE.curve, sol: 1, tokens: 1, buy: true, mcUsd: 1, usd: 1, t: Date.now() });
  J.flush();
  await J.prune();
  assert.equal(J.trades(coin, 0).length, 1);
});

// ---------- mini chart shape ----------
test("a mini chart holds flat through a silence and steps, never ramps", () => {
  const pts = holdFlat([[0, 100], [60_000, 100], [3_600_000, 200]], 60_000);
  assert.deepEqual(pts, [[0, 100], [60_000, 100], [3_600_000, 100], [3_600_000, 200]]);
  assert.deepEqual(holdFlat([[0, 100], [500, 120]], 1000), [[0, 100], [500, 120]]);   // within resolution: as is
});

test("a candle is drawn through its open, low/high in order, and close at its end", () => {
  assert.deepEqual(candlePts([{ time: 0, open: 10, high: 15, low: 8, close: 12 }], 60, 1e9), [[0, 10], [20_000, 8], [40_000, 15], [60_000, 12]]);
  assert.deepEqual(candlePts([{ time: 0, open: 10, high: 15, low: 8, close: 9 }], 60, 1e9).map((p) => p[1]), [10, 15, 8, 9]);
  assert.equal(candlePts([{ time: 0, open: 1, high: 1, low: 1, close: 1 }], 60, 30_000).at(-1)[0], 30_000);   // still filling: ends now
});

test("downsampling keeps every spike and the order of a hold and its step", () => {
  const pts = [[0, 100]];
  for (let i = 1; i < 1000; i++) pts.push([i * 1000, 100 + (i === 500 ? 900 : i % 3)]);
  pts.push([999_500, 100], [999_500, 40]);                  // hold, then step down, same time
  const out = downsample(pts, 0, 1_000_000, 40);
  assert.ok(out.length <= 40 * 4);
  assert.equal(Math.max(...out.map((p) => p[1])), 1000);
  assert.equal(out.at(-1)[1], 40);                          // the step down is the last thing drawn
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] >= out[i - 1][0]);   // never out of time order
});

test("read-back of a transaction with several swaps adds only the missing ones, keyed by their place", async () => {
  const coin = "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR", t0 = Date.now() - 40_000, t1 = Date.now() - 30_000, s = sig(), bt = Math.floor((t0 + 5000) / 1000);
  J.noteSol(150, t0 - 120_000);
  // Live heard the coin's first swap of the transaction only (the second was lost in the outage).
  J.record({ mint: coin, sig: s, venue: J.VENUE.curve, sol: 1, tokens: 1e6, buy: true, mcUsd: 4500, usd: 150, t: t0 + 5000 });
  J.flush();
  // The live copy is found by signature alone, so the transaction is not fetched again...
  let fetched = 0;
  const call = async (method) => {
    if (method === "getSignaturesForAddress") return [{ signature: s, blockTime: bt, err: null }];
    fetched++;
    return { slot: 1, blockTime: bt, meta: { err: null, logMessages: [log(tradeEvent({ mint: OTHER })), log(tradeEvent({ mint: coin, sol: 1e9 })), log(tradeEvent({ mint: coin, sol: 3e9, buy: false }))] } };
  };
  const r = await J.repairMint(coin, t0, t1, { call });
  assert.equal(fetched, 0);
  assert.equal(r.n, 0);
  // ...and when nothing was heard, both of the coin's swaps are added, the other coin's ignored.
  const coin2 = "Es9vMFrajDsTVEb4f3xFeKbSkqvn9rk8Y3Y7xMhRzTsH", s2 = sig();
  const call2 = async (method) => method === "getSignaturesForAddress" ? [{ signature: s2, blockTime: bt, err: null }]
    : { slot: 1, blockTime: bt, meta: { err: null, logMessages: [log(tradeEvent({ mint: OTHER })), log(tradeEvent({ mint: coin2, sol: 1e9 })), log(tradeEvent({ mint: coin2, sol: 3e9, buy: false }))] } };
  const r2 = await J.repairMint(coin2, t0, t1, { call: call2 });
  assert.equal(r2.n, 2);
  assert.deepEqual(J.trades(coin2, 0).map((x) => x.buy), [1, 0]);
  assert.equal((await J.repairMint(coin2, t0, t1, { call: call2 })).n, 0);   // a second read-back adds nothing
});

test("a gap left open by a stopped run is closed at its last heartbeat; overlapping gaps read as one", () => {
  const coin = "So11111111111111111111111111111111111111112", t = Date.now() - 600_000;
  db.prepare("INSERT INTO j_gaps (feed, t0, t1, why) VALUES ('pump', ?, NULL, 'killed mid-outage')").run(t);
  J.closeDangling(t + 5000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM j_gaps WHERE t1 IS NULL").get().n, 0);
  J.gapStart("radar", t + 3000, "restart"); J.gapEnd("radar", t + 9000);
  const mine = J.gapsFor(coin, t - 1000, t + 20_000).filter(([a]) => a >= t);
  assert.deepEqual(mine, [[t, t + 9000]]);
  assert.ok(J.unrepaired().length >= 1);
});
