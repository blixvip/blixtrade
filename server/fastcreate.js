// pump.fun creates straight from a Helius socket: the program's logs filtered on its mint authority (every create
// is signed by it, nothing else is), at "processed". The live trade feed decodes creates too, but on the public
// endpoints it runs on (livetrades.js PUBLIC_WS_POOL) a create lands 120-220 ms after Helius's (measured
// 2026-10-11: mainnet-beta +118 ms, publicnode +218 ms median), and PumpPortal misses ~40% of creates outright.
// ~50 creates per 2.5 min at a few KB each: under 100 MB a day of the key's budget, metered as "launch".
import { startRpcStream } from "./rpc-stream.js";
import { announceCreate, b58 } from "./livetrades.js";
import { keyUrls, activeUrl, noteBytes } from "./heliuskeys.js";

const MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const CREATE = "1b72a94ddeeb6376";   // sha256("event:CreateEvent")[0..8]
export const fastCreate = { connected: false, error: null, creates: 0, url: null, lastMs: 0 };

function decodeCreate(buf) {
  let o = 8;
  const str = () => { const n = buf.readUInt32LE(o); const v = buf.toString("utf8", o + 4, o + 4 + n); o += 4 + n; return v; };
  const name = str(), symbol = str(), uri = str();
  const mint = b58(buf.subarray(o, o + 32)), creator = b58(buf.subarray(o + 64, o + 96));
  return { mint, name: name.slice(0, 64), symbol: symbol.slice(0, 32), uri: uri.slice(0, 300), creator, source: "pump-helius-chain" };
}

let stop = null;
export function startFastCreate() {
  if (stop || !keyUrls().length) return;
  const url = () => (fastCreate.url = activeUrl() || keyUrls()[0]);
  stop = startRpcStream({
    url, request: { method: "logsSubscribe", params: [{ mentions: [MINT_AUTHORITY] }, { commitment: "processed" }] },
    onStatus: (s) => { fastCreate.connected = s.connected; fastCreate.error = s.error; },
    meter: (endpoint, bytes) => noteBytes(endpoint, bytes, "launch"),
    silentMs: 120_000,
    onEvent: (d) => {
      const v = d.params?.result?.value;
      if (!v || v.err) return;
      for (const l of v.logs || []) {
        if (!l.startsWith("Program data: ")) continue;
        const buf = Buffer.from(l.slice(14), "base64");
        if (buf.length < 8 + 12 + 96 || buf.toString("hex", 0, 8) !== CREATE) continue;
        try { announceCreate(decodeCreate(buf)); fastCreate.creates++; fastCreate.lastMs = Date.now(); } catch {}
      }
    },
  });
}
export const stopFastCreate = () => { stop?.(); stop = null; };
