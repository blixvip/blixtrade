// tradeapi.js: keys belong to members and are shown once; the key routes need a live key and forward to the
// wallet service with the member as trader and their inviter as referrer; pacing refuses a flood; the member
// rules (access.js) let a member manage keys and nothing else under /api/v1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTradeApi, LIMITS } from "../server/tradeapi.js";
import { memberMay, visitorMay } from "../server/access.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blix-tradeapi-"));
const calls = [];
const vault = async (p, body) => { calls.push({ p, body }); if (p === "/local/send") return { signature: "5".repeat(64), status: "confirmed", sol: 0.1, feeSol: 0.001, side: "buy", mint: body.mint || "m", wallet: "w", slot: 1, landedMs: 900, route: "curve" }; if (p.startsWith("/local/tx/")) return { signature: p.slice(10), status: "confirmed" }; return { ok: true, echo: body }; };
let t = 1_000_000;
const api = createTradeApi({ dataDir: dir, vault, refOf: (e) => (e === "invited@example.com" ? "friend@example.com" : null), now: () => t, log: () => {} });

function call(method, p, { email = null, headers = {}, body } = {}) {
  return new Promise((ok) => {
    const req = Object.assign(new (require_events())(), { method, headers: { host: "127.0.0.1:4421", ...headers } });
    const res = { writeHead(status, h) { this.status = status; this.headers = h; }, end(b) { ok({ status: this.status, body: JSON.parse(b || "{}") }); } };
    api.handle(req, res, new URL(`http://x${p}`), { email }).then((handled) => { if (!handled) ok({ status: 0, body: {} }); });
    if (body !== undefined) { req.emit("data", JSON.stringify(body)); }
    req.emit("end");
  });
}
function require_events() { return EventEmitter; }
import { EventEmitter } from "node:events";

test("a member makes, lists and revokes keys; the key is shown once", async () => {
  assert.equal((await call("GET", "/api/v1/keys")).status, 401, "signed out: no keys");
  const made = await call("POST", "/api/v1/keys", { email: "me@example.com", body: { label: "bot" } });
  assert.equal(made.status, 200);
  assert.match(made.body.key, /^blx_live_[A-Za-z0-9_-]{32}$/);
  assert.equal(made.body.prefix, made.body.key.slice(0, 17));
  const list = await call("GET", "/api/v1/keys", { email: "me@example.com" });
  assert.equal(list.body.keys.length, 1);
  assert.equal(list.body.keys[0].key, undefined, "the secret is never listed");
  assert.equal((await call("GET", "/api/v1/keys", { email: "other@example.com" })).body.keys.length, 0);
  assert.equal((await call("DELETE", `/api/v1/keys/${made.body.id}`, { email: "other@example.com" })).body.revoked, false, "only the owner revokes");
  assert.equal((await call("DELETE", `/api/v1/keys/${made.body.id}`, { email: "me@example.com" })).body.revoked, true);
  assert.equal((await call("GET", "/api/v1/me", { headers: { authorization: `Bearer ${made.body.key}` } })).status, 401, "a revoked key is dead");
  for (let i = 0; i < LIMITS.keysPerMember; i++) assert.equal((await call("POST", "/api/v1/keys", { email: "many@example.com", body: {} })).status, 200);
  assert.equal((await call("POST", "/api/v1/keys", { email: "many@example.com", body: {} })).status, 409);
});

test("key routes forward to the wallet service as the member, with their inviter as referrer", async () => {
  const k = (await call("POST", "/api/v1/keys", { email: "invited@example.com", body: {} })).body.key;
  const H = { authorization: `Bearer ${k}` };
  assert.equal((await call("POST", "/api/v1/quote", { body: { mint: "m" } })).status, 401, "no key, no quote");
  assert.equal((await call("POST", "/api/v1/quote", { headers: { authorization: "Bearer blx_live_wrongwrongwrongwrongwrongwrongwrong" }, body: {} })).status, 401);
  calls.length = 0;
  const q = await call("POST", "/api/v1/quote", { headers: H, body: { wallet: "w", mint: "m", side: "buy", sol: 0.1 } });
  assert.equal(q.status, 200);
  assert.equal(calls[0].p, "/local/quote");
  assert.equal(calls[0].body.trader, "invited@example.com");
  assert.equal(calls[0].body.referrer, "friend@example.com");
  assert.equal(calls[0].body.sol, 0.1);
  const b = await call("POST", "/api/v1/trade/build", { headers: H, body: { wallet: "w", mint: "m", side: "sell", pct: 50 } });
  assert.equal(b.status, 200); assert.equal(calls[1].p, "/local/build");
  const s = await call("POST", "/api/v1/trade/send", { headers: H, body: { transaction: "AAAA" } });
  assert.equal(s.status, 200); assert.equal(s.body.status, "confirmed"); assert.deepEqual(calls[2].body, { transaction: "AAAA", waitMs: undefined });
  const st = await call("GET", `/api/v1/trade/${"5".repeat(64)}`, { headers: H });
  assert.equal(st.status, 200);
  const me = await call("GET", "/api/v1/me", { headers: H });
  assert.equal(me.body.fee.bps, 160, "an invited member pays 1.6%");
  assert.equal(me.body.account, "in…@example.com");
  const usage = await call("GET", "/api/v1/usage", { email: "invited@example.com" });
  assert.equal(usage.body.days[0].quotes, 1); assert.equal(usage.body.days[0].builds, 1); assert.equal(usage.body.days[0].sends, 1); assert.equal(usage.body.days[0].confirmed, 1);
  assert.equal(usage.body.trades.length, 1); assert.equal(usage.body.totals.volumeSol, 0.1);
  assert.equal((await call("GET", "/api/v1/stream", { headers: H })).status, 426, "the stream is a WebSocket");
  assert.equal((await call("GET", "/api/v1/nothing", { headers: H })).status, 404);
});

test("a flood of quotes on one key is paced; a vault refusal passes through with its status", async () => {
  const k = (await call("POST", "/api/v1/keys", { email: "fast@example.com", body: {} })).body.key;
  const H = { authorization: `Bearer ${k}` };
  let last;
  for (let i = 0; i < LIMITS.quotesPerMin + 1; i++) last = await call("POST", "/api/v1/quote", { headers: H, body: {} });
  assert.equal(last.status, 429);
  t += 61_000;
  assert.equal((await call("POST", "/api/v1/quote", { headers: H, body: {} })).status, 200, "a minute later it is fine");
  const refusing = createTradeApi({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "blix-tradeapi-")), vault: async () => { throw Object.assign(new Error("Not enough SOL"), { status: 409, needSol: 0.2 }); }, refOf: () => null, log: () => {} });
  const key = refusing.createKey("x@example.com").key;
  const req = Object.assign(new EventEmitter(), { method: "POST", headers: { authorization: `Bearer ${key}` } });
  const out = await new Promise((ok) => { const res = { writeHead(s) { this.s = s; }, end(b) { ok({ status: this.s, body: JSON.parse(b) }); } }; refusing.handle(req, res, new URL("http://x/api/v1/quote"), {}); req.emit("data", "{}"); req.emit("end"); });
  assert.equal(out.status, 409); assert.equal(out.body.error, "Not enough SOL"); assert.equal(out.body.needSol, 0.2);
});

test("access rules: a member manages keys and usage under /api/v1 and nothing else; visitors nothing", () => {
  assert.equal(memberMay("GET", "/api/v1/keys"), true);
  assert.equal(memberMay("POST", "/api/v1/keys"), true);
  assert.equal(memberMay("DELETE", "/api/v1/keys/12"), true);
  assert.equal(memberMay("GET", "/api/v1/usage"), true);
  for (const p of ["/api/v1/quote", "/api/v1/trade/build", "/api/v1/trade/send", "/api/v1/me", "/api/v1/stream", "/api/v1/keys/abc", "/api/v1/keys/12/x"]) assert.equal(memberMay("POST", p), false, p);
  for (const p of ["/api/v1/keys", "/api/v1/usage", "/api/v1/quote"]) assert.equal(visitorMay("GET", p), false, p);
});
