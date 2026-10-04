// The Blix MCP tools: one list, read by the MCP server (mcp/blix-mcp.mjs) and by the MCP page.
// Each tool is one call of the HTTP API in docs/API.md. `call` returns [method, path, body?].
const MINT = { type: "string", description: "Solana mint address (base58)" };
const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")).toString(); return s ? `?${s}` : ""; };
const seg = encodeURIComponent;

export const MCP_TOOLS = [
  { name: "blix_overview", description: "Market snapshot: launches per hour, coins tracked, signals in 24h, graduations, top movers, health issues.", call: () => ["GET", "overview"] },
  { name: "blix_pulse", description: "The live Pulse: new launches, final stretch, migrated and running coins, each with stats and the AI verdict.", call: () => ["GET", "pulse"] },
  { name: "blix_signals", description: "Latest signals, newest first.",
    props: { kind: { type: "string", description: "Signal type prefix to filter on" }, screen: { type: "string", enum: ["approved", "unscreened", "all"], description: "Safety screen (default approved)" } },
    call: (a) => ["GET", `signals${qs({ kind: a.kind, screen: a.screen, limit: a.limit })}`] },
  { name: "blix_coins", description: "Search or rank tracked coins. A search also finds dead and flagged coins.",
    props: { q: { type: "string", description: "Ticker, name or mint to search for" }, sort: { type: "string", description: "Column to sort by, e.g. mcap, vol_h1, chg_h1, safety_score" }, dir: { type: "string", enum: ["desc", "asc"] }, theme: { type: "string", description: "Narrative theme to filter on" } },
    call: (a) => ["GET", `tokens${qs({ q: a.q, sort: a.sort, dir: a.dir, theme: a.theme, limit: a.limit })}`] },
  { name: "blix_coin", description: "Everything on one coin: price history, safety report, holders summary, socials, research, signals.", props: { mint: MINT }, required: ["mint"], call: (a) => ["GET", `token/${seg(a.mint)}`] },
  { name: "blix_holders", description: "Live holder ledger for a coin: top holders tagged dev, sniper or bundle, and the top-10 share.", props: { mint: MINT }, required: ["mint"], call: (a) => ["GET", `holders/${seg(a.mint)}${qs({ top: a.limit })}`] },
  { name: "blix_candles", description: "Market-cap candles built from real trades, with volume. Returns the most recent candles.",
    props: { mint: MINT, tf: { type: "string", enum: ["5s", "15s", "1m", "5m", "15m", "1h"], description: "Candle size (default 1m)" } }, required: ["mint"], tail: true,
    call: (a) => ["GET", `candles/${seg(a.mint)}${qs({ tf: a.tf || "1m" })}`] },
  { name: "blix_quote", description: "A real Jupiter quote for a buy or a sell: amount out, price impact, route. Nothing is traded.",
    props: { mint: MINT, side: { type: "string", enum: ["buy", "sell"] }, amount: { type: "number", description: "SOL to spend on a buy, tokens to sell on a sell" }, slip: { type: "integer", description: "Slippage in basis points" } }, required: ["mint", "side", "amount"],
    call: (a) => ["GET", `quote${qs({ mint: a.mint, side: a.side, amount: a.amount, slip: a.slip })}`] },
  { name: "blix_narratives", description: "Narratives right now: themes with heat, launch share, lift, emerging words and lead coins.", call: () => ["GET", "narratives"] },
  { name: "blix_briefs", description: "The latest market briefs written by the AI.", call: () => ["GET", "briefs"] },
  { name: "blix_research", description: "The AI reads on one coin: first read, deep read, grade, thesis, plan, sources.", props: { mint: MINT }, required: ["mint"], call: (a) => ["GET", `research/${seg(a.mint)}`] },
  { name: "blix_picks", description: "The AI picks scorecard: by stage, by call, by reason, by day, and the running result.", call: () => ["GET", "picks"] },
  { name: "blix_wallets", description: "Followed wallets with PnL, the smart-money ranking and recent activity.", call: () => ["GET", "wallets"] },
  { name: "blix_wallet", description: "One wallet: swaps, realized and open PnL, positions, linked wallets.", props: { address: { type: "string", description: "Solana wallet address" } }, required: ["address"], call: (a) => ["GET", `wallet/${seg(a.address)}`] },
  { name: "blix_fomo", description: "What Fomo app traders are buying, and the top Fomo traders.", call: () => ["GET", "fomo"] },
  { name: "blix_track_record", description: "How past signals did, per signal type: up 20%+, down 50%+, unsellable, median, reached 2x.", call: () => ["GET", "perf"] },
  { name: "blix_health", description: "Every dependency of the radar: working or not, last success, last failure, what to do.", call: () => ["GET", "health"] },
  { name: "blix_paper_desk", description: "The paper desk: open positions, today's and lifetime PnL. Paper money only.", call: () => ["GET", "paper"] },
  { name: "blix_paper_buy", description: "Open a paper position at the real quote. Paper money only: nothing is ever bought.", write: true,
    props: { mint: MINT, sol: { type: "number", description: "Paper SOL to spend" }, tp: { type: "number", description: "Take-profit multiple, e.g. 2" }, sl: { type: "number", description: "Stop-loss percent" }, trail: { type: "number", description: "Trailing stop percent" } }, required: ["mint", "sol"],
    call: (a) => ["POST", "paper/quoted", { mint: a.mint, sol: a.sol, tp: a.tp, sl: a.sl, trail: a.trail }] },
  { name: "blix_paper_sell", description: "Sell all or part of a paper position at the real quote. Paper money only.", write: true,
    props: { id: { type: "integer", description: "Position id from blix_paper_desk" }, pct: { type: "number", description: "Percent to sell (default 100)" } }, required: ["id"],
    call: (a) => ["POST", `paper/${seg(a.id)}/sellq`, { pct: a.pct ?? 100, why: "mcp" }] },
];
