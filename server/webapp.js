// The new Blix front end (web/, built with `npm run build` into web/dist), served by Blix itself on
// 127.0.0.1:4421 so it starts and stops with the radar and needs no dev server.
//   /api/account/*  -> the accounts service beside the radar (127.0.0.1:4422), when it is running
//   /api/*, /img/*  -> the radar's own request handler, in this process
//   anything else   -> a file from web/dist, or the app's page for any route it does not know
// This PC only: the port is bound to 127.0.0.1, and the radar sees these requests as its own local page.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
const PORT = Number(process.env.BLIX_WEB_PORT) || 4421;
const ACCOUNTS = { host: "127.0.0.1", port: Number(process.env.BLIX_ACCOUNTS_PORT) || 4422 };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
export const webStats = { on: false, port: PORT, built: null, error: null };

const files = new Map();     // path -> { body, mtime, checked }: read once, re-checked at most every 2 s
function read(file) {
  const c = files.get(file);
  if (c && Date.now() - c.checked < 2000) return c.body;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    if (c && c.mtime === st.mtimeMs) { c.checked = Date.now(); return c.body; }
    const body = fs.readFileSync(file);
    files.set(file, { body, mtime: st.mtimeMs, checked: Date.now() });
    return body;
  } catch { files.delete(file); return null; }
}

function toAccounts(req, res) {
  const headers = { ...req.headers, origin: `http://localhost:${ACCOUNTS.port}`, "x-forwarded-host": req.headers.host || "" };
  const out = http.request({ ...ACCOUNTS, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  out.on("error", () => { if (!res.headersSent) res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "The accounts service is not running on this PC." })); });
  req.pipe(out);
}

export function startWebApp(radar, radarPort) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(String(req.url).split("?")[0]);
    if (p.startsWith("/api/account/")) return toAccounts(req, res);
    if (p.startsWith("/api/") || p.startsWith("/img/")) {
      // Hand the request to the radar as the local page it is.
      req.headers.host = `localhost:${radarPort}`;
      if (req.headers.origin) req.headers.origin = `http://localhost:${radarPort}`;
      return radar.emit("request", req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    const file = path.join(DIST, p === "/" ? "index.html" : p);
    const inside = file.startsWith(DIST + path.sep);
    const body = (inside && read(file)) || read(path.join(DIST, "index.html"));
    if (!body) { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); return res.end("The new Blix page has not been built yet. In the web folder run: npm run build"); }
    const isFile = inside && files.has(file);
    res.writeHead(200, {
      "content-type": TYPES[isFile ? path.extname(file) : ".html"] || "application/octet-stream",
      // Built files carry their content in their name and never change; the page itself is always re-checked.
      "cache-control": isFile && p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  const listen = () => server.listen(PORT, "127.0.0.1");
  server.on("listening", () => { webStats.on = true; webStats.error = null; });
  // Something else on the port (a dev server someone started): keep trying, never take the radar down over it.
  server.on("error", (e) => { webStats.on = false; webStats.error = e.code === "EADDRINUSE" ? `port ${PORT} is in use by another program` : e.message; setTimeout(listen, 30_000).unref?.(); });
  listen();
  try { webStats.built = fs.statSync(path.join(DIST, "index.html")).mtimeMs; } catch {}
  return server;
}
