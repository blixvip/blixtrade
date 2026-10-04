// Accounts on their own small port, for when the radar itself has not mounted them.
// The new front end's dev server sends /api/account/* here (web/vite.config.ts). This PC only.
//   node --no-warnings server/accounts-server.mjs      (BLIX_ACCOUNTS_PORT, default 4422)
import http from "node:http";
import * as accounts from "./accounts.js";

const PORT = +process.env.BLIX_ACCOUNTS_PORT || 4422;
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (await accounts.handle(req, res, url)) return;
  res.writeHead(404, { "content-type": "application/json" });
  res.end('{"error":"not found"}');
}).listen(PORT, "127.0.0.1", () => console.log(`Blix accounts on http://127.0.0.1:${PORT}`));
