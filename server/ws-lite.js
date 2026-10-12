// A WebSocket server with no dependencies (RFC 6455, server side): the handshake, text frames in and out, ping,
// pong and close. Enough for the trade API's live stream (tradeapi.js): JSON messages both ways, nothing binary,
// no extensions. Fragmented messages are joined; a frame over `maxBytes` closes the connection.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const isUpgrade = (req) => /websocket/i.test(String(req.headers.upgrade || "")) && /upgrade/i.test(String(req.headers.connection || ""));

// Answer the handshake on `socket` and return the connection, or write a refusal and return null.
export function accept(req, socket, { maxBytes = 64 * 1024 } = {}) {
  const key = req.headers["sec-websocket-key"];
  if (!isUpgrade(req) || typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
    socket.write("HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-type: text/plain\r\n\r\nWebSocket upgrade required");
    socket.destroy();
    return null;
  }
  const hash = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${hash}\r\n\r\n`);
  return new Connection(socket, maxBytes);
}

export function refuse(socket, status, message) {
  const body = JSON.stringify({ error: message });
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "Error"}\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  socket.destroy();
}

// One frame from the server: never masked. Payload is text (opcode 1) unless another opcode is given.
export function frame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}

// Frames out of `buf` from the start: [{ fin, opcode, payload }], and how many bytes they took. A client's frames are masked.
export function parse(buf) {
  const out = [];
  let at = 0;
  while (buf.length - at >= 2) {
    const b0 = buf[at], b1 = buf[at + 1];
    const fin = Boolean(b0 & 0x80), opcode = b0 & 0x0f, masked = Boolean(b1 & 0x80);
    let len = b1 & 0x7f, o = at + 2;
    if (len === 126) { if (buf.length < o + 2) break; len = buf.readUInt16BE(o); o += 2; }
    else if (len === 127) { if (buf.length < o + 8) break; const big = buf.readBigUInt64BE(o); if (big > 0x7fffffffn) return { frames: out, used: at, bad: true }; len = Number(big); o += 8; }
    const maskLen = masked ? 4 : 0;
    if (buf.length < o + maskLen + len) break;
    let payload = buf.subarray(o + maskLen, o + maskLen + len);
    if (masked) { const m = buf.subarray(o, o + 4), p = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) p[i] = payload[i] ^ m[i & 3]; payload = p; }
    out.push({ fin, opcode, payload });
    at = o + maskLen + len;
  }
  return { frames: out, used: at, bad: false };
}

export class Connection extends EventEmitter {
  constructor(socket, maxBytes) {
    super();
    this.socket = socket; this.open = true; this.maxBytes = maxBytes;
    this.buf = Buffer.alloc(0); this.parts = []; this.partsOp = 0;
    socket.setNoDelay(true);
    socket.on("data", (d) => this.#data(d));
    socket.on("error", () => this.#gone());
    socket.on("close", () => this.#gone());
    socket.on("end", () => this.#gone());
    this.pinger = setInterval(() => { if (this.open) this.#raw(frame(Buffer.alloc(0), 9)); }, 30_000);
    this.pinger.unref?.();
  }
  #gone() { if (!this.open) return; this.open = false; clearInterval(this.pinger); this.emit("close"); }
  #raw(b) { if (this.open && !this.socket.destroyed && this.socket.writableLength < 1 << 20) this.socket.write(b); }
  #data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > this.maxBytes + 14) return this.close(1009, "Message too big");
    const { frames, used, bad } = parse(this.buf);
    if (bad) return this.close(1009, "Message too big");
    this.buf = this.buf.subarray(used);
    for (const f of frames) {
      if (f.opcode === 8) { this.#raw(frame(f.payload.subarray(0, 2), 8)); this.socket.end(); return this.#gone(); }
      if (f.opcode === 9) { this.#raw(frame(f.payload, 10)); continue; }
      if (f.opcode === 10) continue;
      if (f.opcode === 1 || f.opcode === 2 || f.opcode === 0) {
        if (f.opcode !== 0) { this.parts = []; this.partsOp = f.opcode; }
        this.parts.push(f.payload);
        if (this.parts.reduce((a, p) => a + p.length, 0) > this.maxBytes) return this.close(1009, "Message too big");
        if (f.fin) { const whole = Buffer.concat(this.parts); this.parts = []; if (this.partsOp === 1) this.emit("message", whole.toString("utf8")); }
        continue;
      }
      return this.close(1003, "Unsupported frame");
    }
  }
  send(text) { this.#raw(frame(typeof text === "string" ? text : JSON.stringify(text))); }
  close(code = 1000, reason = "") {
    if (!this.open) return;
    const r = Buffer.from(reason), p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
    this.#raw(frame(p, 8));
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
    this.#gone();
  }
}

// Client-side frames, for tests: masked text.
export function clientFrame(text) {
  const data = Buffer.from(text), mask = crypto.randomBytes(4), n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x81, 0x80 | n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(n), 2); }
  const masked = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) masked[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, masked]);
}
