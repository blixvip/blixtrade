// Every pump.fun curve trade, PumpSwap pool trade, launch and migration the radar hears, as Server-Sent Events for
// the page server's trade-API WebSocket (tradeapi.js), on this machine only. Listeners are attached once; while
// nobody is connected nothing is serialised, so the radar's thread pays nothing for it. One connection carries
// everything; the page server fans it out per subscription.
import { onLiveTrade, onMigrated, feed as liveFeed } from "./livetrades.js";
import { onPoolTrade } from "./pumpswap.js";

const clients = new Set();
let attached = false;
const write = (event, data) => {
  if (!clients.size) return;
  const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { if (res.writableLength > 512 * 1024) { res.destroy(); clients.delete(res); continue; } res.write(text); }
};

// `bus`: the engine's event bus (launches). Called by server.js once at start.
export function attachFirehose(bus) {
  if (attached) return;
  attached = true;
  // Curve trades: tokens and reserves come in whole tokens (6 decimals) from the feed; sent as given, with the raw forms.
  onLiveTrade((mint, s, sol, buy, x) => {
    if (!clients.size) return;
    write("trade", { mint, sig: x?.sig || null, user: x?.user || null, buy, sol, tokens: x?.tokens ?? null, vSol: s.vSol ?? null, vTok: s.vTok ?? null, mcSol: s.mc ?? null,
      progress: s.progress ?? null, slot: x?.slot ?? null, pool: s.pad ? String(s.pad) : "pump", solUsd: liveFeed.solUsd, t: Date.now() });
  });
  onPoolTrade((mint, e) => {
    if (!clients.size) return;
    write("trade", { mint, sig: e.sig || null, user: e.user || null, buy: e.buy, sol: e.sol, tokens: e.tokens ?? null, vSol: e.depth ?? null, vTok: null, mcSol: e.mcSol ?? null,
      progress: 1, slot: e.slot ?? null, pool: "pump-amm", solUsd: liveFeed.solUsd, t: Date.now() });
  });
  onMigrated((mint, pool, at) => write("migrate", { mint, pool: pool || null, at, t: Date.now() }));
  bus.on("launch", (l) => write("launch", { ...l, t: Date.now() }));
}

export function serveFirehose(req, res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(`event: hello\ndata: ${JSON.stringify({ t: Date.now(), clients: clients.size + 1 })}\n\n`);
  clients.add(res);
  const bye = () => clients.delete(res);
  req.on("close", bye); res.on("close", bye); res.on("error", bye);
}
export const firehoseStats = () => ({ clients: clients.size, attached });
