import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MCP_TOOLS } from "../public/mcp-tools.js";

const MCP_BIN = fileURLToPath(new URL("../mcp/blix-mcp.mjs", import.meta.url));

test("blix-mcp stdio server handles JSON-RPC lifecycle, tools, and errors", async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const child = spawn(process.execPath, [MCP_BIN], {
    env: { ...process.env, BLIX_URL: `http://127.0.0.1:${port}` },
    stdio: ["pipe", "pipe", "pipe"],
  });

  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await new Promise((resolve) => server.close(resolve));
  });

  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const nextReply = async () => {
    const { value, done } = await lines.next();
    assert.equal(done, false, "expected JSON-RPC reply line from stdout");
    return JSON.parse(value);
  };
  const sendLine = (raw) => child.stdin.write(`${raw}\n`);
  const sendRpc = (msg) => sendLine(JSON.stringify(msg));

  // 1. initialize returns capabilities.tools
  sendRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const initReply = await nextReply();
  assert.equal(initReply.id, 1);
  assert.ok(initReply.result?.capabilities?.tools);

  // 2. notification (no id) gets no reply; verified by immediately sending tools/list (id: 2)
  sendRpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  sendRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const listReply = await nextReply();
  assert.equal(listReply.id, 2);
  const tools = listReply.result?.tools;
  assert.equal(tools.length, MCP_TOOLS.length);
  const writable = tools.filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name).sort();
  assert.deepEqual(writable, ["blix_paper_buy", "blix_paper_sell"]);
  const readable = tools.filter((tool) => tool.annotations?.readOnlyHint === true);
  assert.equal(readable.length, MCP_TOOLS.length - 2);

  // 3. tools/call blix_candles {mint, tf:"5m"} requests /api/candles/<mint>?tf=300
  const mint = "So11111111111111111111111111111111111111112";
  sendRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "blix_candles", arguments: { mint, tf: "5m" } },
  });
  const candlesReply = await nextReply();
  assert.equal(candlesReply.id, 3);
  assert.notEqual(candlesReply.result?.isError, true);
  assert.equal(requests.at(-1)?.url, `/api/candles/${mint}?tf=300`);

  // 4. call without required mint returns isError: true
  sendRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "blix_candles", arguments: {} },
  });
  const missingArgReply = await nextReply();
  assert.equal(missingArgReply.id, 4);
  assert.equal(missingArgReply.result?.isError, true);
  assert.match(missingArgReply.result?.content?.[0]?.text || "", /Missing argument: mint/);

  // 5. unknown method returns error -32601
  sendRpc({ jsonrpc: "2.0", id: 5, method: "no/such/method" });
  const unknownMethodReply = await nextReply();
  assert.equal(unknownMethodReply.id, 5);
  assert.equal(unknownMethodReply.error?.code, -32601);

  // 6. bad line returns -32700
  sendLine("{not valid json");
  const parseErrReply = await nextReply();
  assert.equal(parseErrReply.id, null);
  assert.equal(parseErrReply.error?.code, -32700);

  // Close stdin so blix-mcp.mjs exits naturally without leaving a child process behind
  child.stdin.end();
  const [exitCode] = await new Promise((resolve) => child.once("exit", (code, sig) => resolve([code, sig])));
  assert.equal(exitCode, 0);
});
