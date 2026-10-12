// The wallet tracker (server/wtrack.js): a member's list, Axiom's import format, export, and reading a transfer
// out of a transaction. Runs on a throwaway data folder (RADAR_DATA), never the real one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RADAR_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "blix-wtrack-"));
process.env.BLIX_MARKET_FEEDS = "0";
const wt = await import("../server/wtrack.js");
const { db } = await import("../server/db.js");

const A = "4p7SeR6361WJ4T4icgsYTnzAUzfA5NwM4CwYD9kMBjuK";
const B = "BTmCme13XXrD3VLxXFChL9VnmicJ5PjkVUpAsjrooEYh";
const C = "9VQ3dtwAxUAxNPdD86ExhC1XsL1hiUcqEvzS4sAhUU1A";
const MINT = "GTNHLKQWKZHaHpd6PjfMgfFZUDEuCviwXMwYbCcepump";

test("a member's list: add, name, emoji, colour, group; edit; the chain reader follows it; remove lets it go", () => {
  const w = wt.add("alice@example.com", { address: A, name: "  Bot   whale ", emoji: "🐋", color: "blue", grp: 2 });
  assert.equal(w.name, "Bot whale");
  assert.equal(w.emoji, "🐋");
  assert.equal(w.color, "blue");
  assert.equal(w.grp, 2);
  assert.equal(w.alerts, 1);
  // Followed by wallets.js as source "tracker" so its stream and poll cover it.
  assert.equal(db.prepare("SELECT source FROM wallets WHERE address = ?").get(A).source, "tracker");
  assert.deepEqual(wt.trackedBy(A), new Set(["alice@example.com"]));
  // A nameless wallet shows its short address; an unknown colour or group falls back.
  const n = wt.add("alice@example.com", { address: B, color: "chartreuse", grp: 9 });
  assert.equal(n.name, "BTmC…oEYh");
  assert.equal(n.color, null);
  assert.equal(n.grp, 1);
  // Edits.
  const e = wt.update("alice@example.com", A, { name: "Whale", alerts: false, grp: 3 });
  assert.equal(e.name, "Whale");
  assert.equal(e.alerts, 0);
  assert.equal(e.grp, 3);
  assert.throws(() => wt.update("bob@example.com", A, { name: "x" }), /Not on your list/);
  assert.throws(() => wt.add("alice@example.com", { address: "not-a-wallet" }), /Solana wallet/);
  // Two members tracking one wallet: it is read once, and stays followed until the last one drops it.
  wt.add("bob@example.com", { address: A });
  assert.equal(wt.trackedBy(A).size, 2);
  wt.remove("alice@example.com", A);
  assert.ok(db.prepare("SELECT 1 FROM wallets WHERE address = ?").get(A));
  wt.remove("bob@example.com", A);
  assert.equal(db.prepare("SELECT 1 FROM wallets WHERE address = ?").get(A), undefined);
  assert.equal(wt.trackedBy(A), null);
  assert.deepEqual(wt.list("alice@example.com").map((x) => x.address), [B]);
  assert.deepEqual(wt.list("bob@example.com"), []);
});

test("a wallet the owner already follows is not dropped when a member stops tracking it", () => {
  db.prepare("INSERT OR REPLACE INTO wallets (address, label, source, watching, added) VALUES (?, ?, 'you', 1, ?)").run(C, "mine", Date.now());
  wt.add("carol@example.com", { address: C });
  assert.equal(db.prepare("SELECT source FROM wallets WHERE address = ?").get(C).source, "you");
  wt.remove("carol@example.com", C);
  assert.equal(db.prepare("SELECT source FROM wallets WHERE address = ?").get(C).source, "you");
});

test("import takes Axiom's export and plain address lines; export gives Axiom's shape back", () => {
  const r = wt.importText("dave@example.com", JSON.stringify([
    { trackedWalletAddress: A, name: "From Axiom", emoji: "🐸", groups: ["P2"] },
    { trackedWalletAddress: "bad", name: "skipped" },
    { address: B, label: "Alt keys" },
  ]));
  assert.deepEqual(r, { added: 2, skipped: 1 });
  const lines = wt.importText("dave@example.com", `${C} Sniper one\n${A}\nnot a line\n`);
  assert.deepEqual(lines, { added: 2, skipped: 0 });   // A again: an edit, not a second row
  const list = wt.list("dave@example.com");
  assert.equal(list.length, 3);
  assert.equal(list.find((w) => w.address === A).name, "From Axiom");
  assert.equal(list.find((w) => w.address === A).grp, 2);
  assert.equal(list.find((w) => w.address === C).name, "Sniper one");
  assert.throws(() => wt.importText("dave@example.com", "nothing here"), /No wallet addresses/);
  assert.throws(() => wt.importText("dave@example.com", "   "), /Nothing to import/);
  const out = wt.exportList("dave@example.com");
  // Rows added in the same millisecond share an `added` time, so the order is compared as a set.
  assert.deepEqual(out.map((w) => w.trackedWalletAddress).sort(), [A, B, C].sort());
  const a = out.find((w) => w.trackedWalletAddress === A);
  assert.deepEqual(a.groups, ["P2"]);
  assert.equal(a.emoji, "🐸");
});

test("the list is capped and the trades the chain reader already read seed the feed", () => {
  // What wallets.js already read for a wallet shows the moment it is tracked (src "history").
  db.prepare("INSERT OR IGNORE INTO wallet_trades (sig, wallet, mint, side, tokens, sol, usd, t, payer) VALUES (?, ?, ?, 'buy', 1000, 0.5, 60, ?, NULL)").run("sig1", C, MINT, Date.now() - 60_000);
  wt.add("erin@example.com", { address: C, name: "Seeded" });
  const o = wt.overview("erin@example.com");
  assert.equal(o.feed.length, 1);
  assert.equal(o.feed[0].src, "history");
  assert.equal(o.feed[0].name, "Seeded");
  assert.equal(o.feed[0].side, "buy");
  assert.equal(o.max, 200);
  // Only erin's rows: another member's overview is empty.
  assert.equal(wt.overview("frank@example.com").feed.length, 0);
  assert.equal(wt.feedSince("erin@example.com", o.feed[0].id).rows.length, 0);
  assert.equal(wt.feedSince("erin@example.com", 0).rows.length, 1);
});

test("a transfer is read from a transaction that was not a swap", () => {
  const W = A, OTHER = B;
  const keys = (list) => list.map((pubkey, i) => ({ pubkey, signer: i === 0, writable: true }));
  // 2 SOL out, fee paid by the wallet.
  const solOut = { blockTime: 1_700_000_000, meta: { err: null, fee: 5000, preBalances: [5e9, 1e9, 1], postBalances: [3e9 - 5000, 3e9, 1], preTokenBalances: [], postTokenBalances: [] },
    transaction: { message: { accountKeys: keys([W, OTHER, "11111111111111111111111111111111"]) } } };
  assert.deepEqual(wt.parseTransfer(solOut, W), { dir: "out", mint: null, amount: 2, other: OTHER, t: 1_700_000_000_000 });
  // 1,000 tokens in from OTHER, SOL untouched (just rent/fees under a cent).
  const bal = (owner, amount) => ({ mint: MINT, owner, uiTokenAmount: { amount: String(amount), decimals: 6 } });
  const tokIn = { blockTime: 1_700_000_100, meta: { err: null, fee: 5000, preBalances: [1e9, 1e9], postBalances: [1e9 - 5000, 1e9],
    preTokenBalances: [bal(W, 0), bal(OTHER, 5_000_000_000)], postTokenBalances: [bal(W, 1_000_000_000), bal(OTHER, 4_000_000_000)] },
    transaction: { message: { accountKeys: keys([W, OTHER]) } } };
  assert.deepEqual(wt.parseTransfer(tokIn, W), { dir: "in", mint: MINT, amount: 1000, other: OTHER, t: 1_700_000_100_000 });
  // Dust, a failed transaction, or a wallet that is not in the transaction: nothing.
  assert.equal(wt.parseTransfer({ ...solOut, meta: { ...solOut.meta, postBalances: [5e9 - 5000 - 1000, 1e9 + 1000, 1] } }, W), null);
  assert.equal(wt.parseTransfer({ ...solOut, meta: { ...solOut.meta, err: { x: 1 } } }, W), null);
  assert.equal(wt.parseTransfer(solOut, C), null);
});

test.after(() => { wt.stop(); try { db.close(); } catch {} try { fs.rmSync(process.env.RADAR_DATA, { recursive: true, force: true }); } catch {} });

// ---------- the fast lane and the confirmation sweep ----------
const wl = await import("../server/wallets.js");

test("fast lane: a transaction read at once, retried while the node has it only at processed, handed to the public reader when the key will not", async () => {
  const waits = [];
  const wait = async (ms) => { waits.push(ms); };
  // Confirmed on the third try.
  let calls = 0;
  const got = [];
  await wl.fastRead(A, "sig-a", { fetchTx: async () => (++calls >= 3 ? { blockTime: 1 } : null), wait, fallback: () => got.push("fallback"), read: (addr, sig, tx) => got.push(["read", addr, sig, tx.blockTime]) });
  assert.deepEqual(got, [["read", A, "sig-a", 1]]);
  assert.deepEqual(waits, [250, 500]);
  // Never confirmed in time: the public reader gets it.
  got.length = 0; waits.length = 0;
  await wl.fastRead(A, "sig-b", { fetchTx: async () => null, retries: [10, 20], wait, fallback: (addr, sig, e) => got.push(["fallback", sig, e.message]), read: () => got.push("read") });
  assert.deepEqual(got, [["fallback", "sig-b", "not confirmed in time"]]);
  assert.deepEqual(waits, [10, 20]);
  // The key refuses (budget spent, transport down): straight to the public reader, no retries.
  got.length = 0; waits.length = 0;
  await wl.fastRead(A, "sig-c", { fetchTx: async () => { throw Object.assign(new Error("Helius request deferred"), { code: "HELIUS_BUDGET" }); }, wait, fallback: (addr, sig, e) => got.push(["fallback", sig, e.code]), read: () => got.push("read") });
  assert.deepEqual(got, [["fallback", "sig-c", "HELIUS_BUDGET"]]);
  assert.deepEqual(waits, []);
});

test("the fast lane covers the wallets members track and the owner's own, not the auto-followed ones", () => {
  for (const who of ["dave@example.com", "hank@example.com"]) try { wt.remove(who, A); } catch {}   // earlier tests left it on their lists
  db.prepare("DELETE FROM wallets").run();
  db.prepare("INSERT INTO wallets (address, source, watching, added, last_trade) VALUES (?, 'smart', 1, 1, 9)").run(A);
  db.prepare("INSERT INTO wallets (address, source, watching, added, last_trade) VALUES (?, 'you', 1, 1, 5)").run(B);
  wt.add("gina@example.com", { address: C });
  assert.deepEqual(wl.fastWallets(), [B, C]);
  // A member tracks a wallet the radar already followed as smart money: it keeps that source, and still joins the lane.
  wt.add("gina@example.com", { address: A });
  assert.equal(db.prepare("SELECT source FROM wallets WHERE address = ?").get(A).source, "smart");
  assert.deepEqual(wl.fastWallets(), [A, B, C]);
  wt.remove("gina@example.com", A); wt.remove("gina@example.com", C);
  db.prepare("DELETE FROM wallets").run();
});

test("confirmation sweep: a feed row whose transaction never landed is deleted and the member hears wtdrop", async () => {
  const t = Date.now() - 30_000;
  const ins = db.prepare("INSERT INTO wt_feed (wallet, sig, mint, side, sol, usd, tokens, mc_usd, t, src) VALUES (?, ?, ?, 'buy', 1, 100, 10, NULL, ?, ?)");
  const landed = Number(ins.run(A, "sig-landed", MINT, t, "pool").lastInsertRowid);
  const failed = Number(ins.run(A, "sig-failed", MINT, t, "curve").lastInsertRowid);
  const unknownOld = Number(ins.run(A, "sig-unknown-old", MINT, t - 70_000, "pool").lastInsertRowid);
  const unknownNew = Number(ins.run(A, "sig-unknown-new", MINT, t, "pool").lastInsertRowid);
  const chainRead = Number(ins.run(A, "sig-chain", MINT, t, "chain").lastInsertRowid);   // read from a confirmed transaction: never checked
  const heard = [];
  wt.start((who, event, data) => heard.push([who, event, data.id]));
  wt.add("hank@example.com", { address: A });
  const r = await wt.confirmSweep(async (sigs) => sigs.map((s) => s === "sig-landed" ? { confirmationStatus: "confirmed", err: null } : s === "sig-failed" ? { confirmationStatus: "confirmed", err: { x: 1 } } : null));
  assert.equal(r.checked, 4);
  assert.equal(r.dropped, 2);
  const left = db.prepare("SELECT id FROM wt_feed WHERE id IN (?, ?, ?, ?, ?)").all(landed, failed, unknownOld, unknownNew, chainRead).map((x) => x.id).sort();
  assert.deepEqual(left, [landed, unknownNew, chainRead].sort());
  // Every member tracking the wallet hears it (dave tracks it too, from the import test above).
  assert.deepEqual(heard.filter(([who, e]) => e === "wtdrop" && who === "hank@example.com").map(([, , id]) => id).sort(), [failed, unknownOld].sort());
  assert.ok(heard.some(([who, e, id]) => who === "dave@example.com" && e === "wtdrop" && id === failed));
  // Asked again: the landed row is remembered, the young unknown one is still waited for.
  const again = await wt.confirmSweep(async (sigs) => sigs.map(() => null));
  assert.equal(again.checked, 1);
  assert.equal(again.dropped, 0);
});
