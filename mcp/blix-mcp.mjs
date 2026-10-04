#!/usr/bin/env node
// Blix MCP server: lets an AI client (Claude Code, Claude Desktop, Cursor, Codex) read the running radar.
// No dependencies: newline-delimited JSON-RPC 2.0 on stdio in, the local HTTP API out. Blix must be running.
//   node mcp/blix-mcp.mjs        BLIX_URL or RADAR_PORT point it at another install.
import readline from "node:readline";
import { MCP_TOOLS } from "../public/mcp-tools.js";

const BASE = (process.env.BLIX_URL || `http://localhost:${process.env.RADAR_PORT || 4420}`).replace(/\/$/, "");
const MAX_CHARS = 40_000;
const LIMIT = { type: "integer", description: "Most rows to return in any list (default 10, max 50)" };
const DROP = new Set(["image", "uri", "icon"]);

// The API answers for a dashboard and can run to hundreds of KB. A model wants the head of each list:
// cap every array, drop picture fields, shorten long strings.
function trim(v, n, tail) {
  if (Array.isArray(v)) return (tail ? v.slice(-n) : v.slice(0, n)).map((x) => trim(x, n, tail));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, trim(x, n, tail)]));
  return typeof v === "string" && v.length > 800 ? `${v.slice(0, 800)}…` : v;
}

async function callTool(name, args = {}) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  for (const k of tool.required || []) if (args[k] === undefined || args[k] === "") throw new Error(`Missing argument: ${k}`);
  const limit = Math.min(Math.max(Math.round(+args.limit) || 10, 1), 50);
  const [method, path, body] = tool.call({ ...args, limit });
  let r;
  try {
    r = await fetch(`${BASE}/api/${path}`, { method, signal: AbortSignal.timeout(60_000),
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  } catch (e) { throw new Error(`Blix is not answering at ${BASE} (${e.cause?.code || e.message}). Start Blix first.`); }
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  const text = JSON.stringify(trim(data, limit, tool.tail));
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[cut at ${MAX_CHARS} characters; ask again with a smaller limit]` : text;
}

const schema = (t) => ({ name: t.name, description: t.description,
  inputSchema: { type: "object", properties: { ...t.props, limit: LIMIT }, required: t.required || [] },
  annotations: { readOnlyHint: !t.write } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // a notification: nothing to answer
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") return ok({ protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} },
    serverInfo: { name: "blix", version: "0.2.0" }, instructions: "Read-only view of the Blix Solana memecoin radar running on this PC, plus a paper-money desk. Nothing here can spend real funds." });
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: MCP_TOOLS.map(schema) });
  if (method === "tools/call") {
    try { return ok({ content: [{ type: "text", text: await callTool(params?.name, params?.arguments) }] }); }
    catch (e) { return ok({ content: [{ type: "text", text: e.message }], isError: true }); }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  const res = await handle(msg).catch((e) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: e.message } }));
  if (res) out(res);
});
