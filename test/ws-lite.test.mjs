// ws-lite.js: frames round-trip, the handshake answers 101 with the right accept key, text goes both ways.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { frame, parse, clientFrame, accept, isUpgrade } from "../server/ws-lite.js";

test("frames parse back to what was framed, masked and unmasked, every length class", () => {
  for (const n of [0, 5, 125, 126, 300, 65535, 65536, 70000]) {
    const text = "x".repeat(n);
    const { frames } = parse(frame(text));
    assert.equal(frames.length, 1); assert.equal(frames[0].opcode, 1); assert.equal(frames[0].payload.toString(), text);
    const m = parse(clientFrame(text));
    assert.equal(m.frames[0].payload.toString(), text);
  }
  // Two frames in one buffer, a partial third.
  const two = Buffer.concat([clientFrame("a"), clientFrame("b"), clientFrame("ccc").subarray(0, 3)]);
  const r = parse(two);
  assert.equal(r.frames.length, 2); assert.equal(r.used, two.length - 3);
});

test("the handshake and a message each way over a real socket", async () => {
  const got = [];
  const server = http.createServer((_, res) => { res.writeHead(404); res.end(); });
  server.on("upgrade", (req, socket) => {
    assert.ok(isUpgrade(req));
    const ws = accept(req, socket);
    ws.on("message", (t) => { got.push(t); ws.send(JSON.stringify({ echo: t })); if (t === "bye") ws.close(1000, "done"); });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const key = crypto.randomBytes(16).toString("base64");
  const sock = net.connect(port, "127.0.0.1");
  const chunks = [];
  const done = new Promise((ok) => sock.on("close", ok));
  sock.on("data", (d) => chunks.push(d));
  await new Promise((ok) => sock.on("connect", ok));
  sock.write(`GET /api/v1/stream HTTP/1.1\r\nhost: 127.0.0.1\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: ${key}\r\nsec-websocket-version: 13\r\n\r\n`);
  await new Promise((ok) => setTimeout(ok, 100));
  const head = Buffer.concat(chunks).toString("latin1");
  assert.match(head, /^HTTP\/1\.1 101 /);
  assert.ok(head.includes(`sec-websocket-accept: ${crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")}`));
  chunks.length = 0;
  sock.write(clientFrame("hello")); sock.write(clientFrame("bye"));
  await done;
  const { frames } = parse(Buffer.concat(chunks));
  assert.deepEqual(got, ["hello", "bye"]);
  assert.equal(frames[0].payload.toString(), JSON.stringify({ echo: "hello" }));
  assert.equal(frames.at(-1).opcode, 8, "closes with a close frame");
  server.close();
});

test("a bad handshake is refused", async () => {
  const server = http.createServer();
  server.on("upgrade", (req, socket) => assert.equal(accept(req, socket), null));
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const sock = net.connect(server.address().port, "127.0.0.1");
  const out = [];
  sock.on("data", (d) => out.push(d));
  await new Promise((ok) => sock.on("connect", ok));
  sock.write("GET /x HTTP/1.1\r\nhost: a\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n");
  await new Promise((ok) => sock.on("close", ok));
  assert.match(Buffer.concat(out).toString(), /^HTTP\/1\.1 400/);
  server.close();
});
