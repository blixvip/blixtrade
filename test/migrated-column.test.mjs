// A coin that migrates leaves Final Stretch for Migrated the instant pump.fun's migration event lands, aged from
// that instant (not from DexScreener's idea of the pool's creation, not from its launch), active (never culled
// over the cap for having no hour of volume yet) and unquarantined (a $30 first reading of a $69K pool is not a crash).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RADAR_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "radar-migrated-"));
const { db } = await import("../server/db.js");
const S = await import("../server/settings.js");
const E = await import("../server/engine.js");
const L = await import("../server/livetrades.js");
const P = await import("../server/pulse.js");

const row = (mint) => db.prepare("SELECT * FROM tokens WHERE mint = ?").get(mint);
const mintOf = (n) => `M${String(n).padStart(43, "x")}`;
const POOL = "P".padEnd(44, "p");
L.feed.solUsd = 200;

test("the migration event marks an untracked coin bonded, active, exactly timed, named from the launch feed", () => {
  const mint = mintOf(1), at = Date.now() - 1000;
  E.launchIndex.set(mint, { mint, symbol: "ABC", name: "Abc coin", seen: at - 600_000, creator: "C".padEnd(44, "c") });
  L.live.set(mint, { mint, mc: 345, first: at - 600_000, buys: 1, sells: 0, vol: 1, traders: new Set(), hist: [] });
  E.bondedOnChain(mint, POOL, at, true);
  const t = row(mint);
  assert.ok(t, "adopted");
  assert.equal(t.graduated, 1);
  assert.equal(t.status, "active");
  assert.equal(t.symbol, "ABC");
  assert.equal(t.pair, POOL);
  assert.equal(t.dex, "pumpswap");
  assert.equal(t.migrated_at, at);
  assert.equal(t.pair_created, at);
  assert.equal(t.mcap, 345 * 200);
});

test("a pool trade after the event changes nothing; a pool trade without the event marks the coin from now", () => {
  const mint = mintOf(1), t0 = row(mint);
  E.bondedOnChain(mint, POOL, Date.now(), false);
  assert.deepEqual(row(mint), t0);
  // Heard launching lately: its pool trade marks it bonded from now.
  const m2 = mintOf(2), before = Date.now();
  E.launchIndex.set(m2, { mint: m2, symbol: "NEW", name: "New", seen: before - 300_000 });
  E.bondedOnChain(m2, POOL, undefined, false);
  const t = row(m2);
  assert.equal(t.graduated, 1);
  assert.equal(t.status, "active");
  assert.equal(t.migrated_at, null);
  assert.ok(t.pair_created >= before);
  // Never heard of at all (an old coin whose pool traded): bonded, but not dated from now and never "migrated".
  const m3 = mintOf(41);
  E.bondedOnChain(m3, POOL, undefined, false);
  const t3 = row(m3);
  assert.equal(t3.graduated, 1);
  assert.equal(t3.status, "active");
  assert.equal(t3.migrated_at, null);
  assert.equal(t3.pair_created, 0, "dated by DexScreener's pool age on the next scan, not by this trade");
});

test("a dead, quarantined coin that migrates is active and clean again, timed from the migration", () => {
  const mint = mintOf(3), at = Date.now() - 2000;
  db.prepare("INSERT INTO tokens (mint, symbol, name, description, source, first_seen, links, updated, status, quarantine, mcap, dex, pair_created) VALUES (?, 'OLD', 'Old', '', 'pump-triage', ?, '[]', 0, 'dead', 'implausible market cap', 30.67, 'pumpfun', ?)").run(mint, at - 3_600_000, at - 120_000);
  E.bondedOnChain(mint, POOL, at, true);
  const t = row(mint);
  assert.equal(t.status, "active");
  assert.equal(t.quarantine, null);
  assert.equal(t.graduated, 1);
  assert.equal(t.migrated_at, at);
  assert.equal(t.pair_created, at, "its age restarts at the migration, not its curve listing");
  assert.equal(t.dex, "pumpswap");
});

test("a coin bonded long ago is not re-timed by a stray event", () => {
  const mint = mintOf(4), old = Date.now() - 3_600_000;
  db.prepare("INSERT INTO tokens (mint, symbol, name, description, source, first_seen, links, updated, status, graduated, pair, pair_created, mcap) VALUES (?, 'OLD2', 'Old2', '', 'pump-triage', ?, '[]', 0, 'active', 1, ?, ?, 50000)").run(mint, old, POOL, old);
  E.bondedOnChain(mint, POOL, Date.now(), true);
  assert.equal(row(mint).pair_created, old);
  assert.equal(row(mint).migrated_at, null);
});

test("DexScreener's first reading of a minutes-old pool never moves the clock back or quarantines the coin", () => {
  const mint = mintOf(1), at = row(mint).migrated_at;
  const pair = (marketCap, pairCreatedAt, liq = 17000) => ({ pairAddress: POOL, dexId: "pumpswap", pairCreatedAt, priceUsd: String(marketCap / 1e9), marketCap, fdv: marketCap,
    liquidity: { usd: liq }, baseToken: { symbol: "ABC", name: "Abc coin" }, quoteToken: { symbol: "SOL" }, volume: {}, txns: {}, priceChange: {} });
  E.applyPair(mint, pair(30.67, at - 100_000, 66));   // not indexed yet ($30, $66 of liquidity): dropped
  let t = row(mint);
  assert.equal(t.mcap, 345 * 200);
  assert.equal(t.quarantine, null);
  assert.equal(t.pair_created, at);
  db.prepare("UPDATE tokens SET quarantine = 'implausible market cap' WHERE mint = ?").run(mint);   // left by the old rule
  E.applyPair(mint, pair(1, at - 100_000, 0.97));   // $1 / $0.97: dropped, and the stale quarantine is lifted
  t = row(mint);
  assert.equal(t.quarantine, null);
  assert.equal(t.mcap, 345 * 200);
  E.applyPair(mint, pair(52000, at - 100_000));   // a real reading: priced, still timed from the migration
  t = row(mint);
  assert.equal(t.mcap, 52000);
  assert.equal(t.pair_created, at);
  assert.equal(t.migrated_at, at);
});

test("the cap cull never retires a coin that just bonded or was just seen", () => {
  const was = S.settings.maxTracked;
  S.settings.maxTracked = 1;
  try {
    const old = mintOf(5);
    db.prepare("INSERT INTO tokens (mint, symbol, name, description, source, first_seen, links, updated, status, mcap, vol_h1, score) VALUES (?, 'DULL', 'Dull', '', 'pump-triage', ?, '[]', 0, 'active', 100000, 50000, 90)").run(old, Date.now() - 5 * 3_600_000);
    E.cull();
    assert.equal(row(mintOf(1)).status, "active", "bonded seconds ago, no volume read yet");
    assert.equal(row(mintOf(2)).status, "active", "first seen seconds ago");
    assert.equal(row(mintOf(3)).status, "active");
    assert.equal(row(old).status, "dead", "the cap still works on an old coin");
  } finally { S.settings.maxTracked = was; }
});

test("the Pulse lists the coin in Migrated at a second old and never in Final Stretch", () => {
  const mint = mintOf(1);
  const d = P.pulseData();
  const m = d.migrated.find((r) => r.mint === mint);
  assert.ok(m, "in Migrated");
  assert.ok(m.age < 15_000 && m.age >= 0, `aged from the migration: ${m.age}`);
  assert.equal(m.graduated, true);
  assert.equal(m.migrating, null);
  assert.equal(m.symbol, "ABC");
  assert.ok(!d.stretch.some((r) => r.mint === mint), "not in Final Stretch");
  assert.ok(d.migrated.every((r) => r.graduated && r.migrating === null));
});

test("a coin the table does not know but the live feed saw bond is not a Final Stretch row", async () => {
  const mint = mintOf(6);
  E.launchIndex.set(mint, { mint, symbol: "GONE", name: "Gone", seen: Date.now() - 300_000 });
  L.live.set(mint, { mint, mc: 400, first: Date.now() - 300_000, buys: 30, sells: 2, vol: 50, traders: new Set(), hist: [], progress: 0.97, last: Date.now(), pool: true, completeAt: Date.now() - 3000, migratedAt: Date.now() - 1000 });
  await new Promise((r) => setTimeout(r, 1600));   // the board is cached 1.5 s
  const d = P.pulseData();
  assert.ok(!d.stretch.some((r) => r.mint === mint), "bonded on the live feed: not a Final Stretch row");
});
