import test from "node:test";
import assert from "node:assert/strict";
import { createPriceSanity } from "../server/price-sanity.js";

test("a live cap 8x off DexScreener for four checks is a suspect, shown at DexScreener's figure, cleared when they agree", () => {
  const s = createPriceSanity();
  let now = 1_000_000;
  const row = (liveUsd, dexUsd) => [{ mint: "A", liveUsd, dexUsd, dexT: now }];
  for (let i = 0; i < 3; i++) { s.check(row(2_000_000, 4_000), now); now += 30_000; }
  assert.equal(s.suspect("A"), null, "not before the fourth check");
  const st = s.check(row(2_000_000, 4_000), now);
  assert.equal(st.suspects, 1);
  assert.equal(s.suspect("A").dex, 4_000);
  assert.ok(st.examples[0].ratio > 400);
  now += 30_000;
  s.check(row(4_100, 4_000), now);
  assert.equal(s.suspect("A"), null, "a fresh agreeing comparison clears it");
});

test("a real move DexScreener catches up on, a stale DexScreener figure, and a small gap are not suspects", () => {
  const s = createPriceSanity();
  let now = 1_000_000;
  s.check([{ mint: "B", liveUsd: 50_000, dexUsd: 4_000, dexT: now }], now); now += 30_000;
  s.check([{ mint: "B", liveUsd: 50_000, dexUsd: 4_000, dexT: now }], now); now += 30_000;
  s.check([{ mint: "B", liveUsd: 50_000, dexUsd: 48_000, dexT: now }], now);   // DexScreener caught up
  now += 30_000;
  for (let i = 0; i < 4; i++) { s.check([{ mint: "B", liveUsd: 50_000, dexUsd: 4_000, dexT: now - 10 * 60_000 }, { mint: "C", liveUsd: 10_000, dexUsd: 4_000, dexT: now }], now); now += 30_000; }
  assert.equal(s.suspect("B"), null, "stale DexScreener figures are not compared");
  assert.equal(s.suspect("C"), null, "2.5x is a move, not a bug");
  assert.equal(s.stats.compared, 1);
});

test("a live cap far below DexScreener (drained pool, dust on a dead coin) is never a suspect", () => {
  const s = createPriceSanity();
  let now = 1_000_000;
  for (let i = 0; i < 5; i++) { s.check([{ mint: "E", liveUsd: 500, dexUsd: 80_000, dexT: now }, { mint: "F", liveUsd: 2, dexUsd: 793, dexT: now }], now); now += 30_000; }
  assert.equal(s.suspect("E"), null);
  assert.equal(s.suspect("F"), null);
  assert.equal(s.stats.compared, 1, "dust is not even compared");
});

test("a verdict lapses when DexScreener stops pricing the coin", () => {
  const s = createPriceSanity({ keepMs: 60_000 });
  let now = 1_000_000;
  for (let i = 0; i < 4; i++) { s.check([{ mint: "D", liveUsd: 1e6, dexUsd: 1e3, dexT: now }], now); now += 30_000; }
  assert.ok(s.suspect("D"));
  s.check([], now + 61_000);
  assert.equal(s.suspect("D"), null);
});
