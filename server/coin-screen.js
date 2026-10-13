// Admission to paid coin work, using evidence already collected by the shared feeds.
// Browser display grace is intentionally not a licence to spend RPC credits.
export function screenCoin(c, now = Date.now()) {
  if (!c) return 'unknown';
  const age = c.born > 0 ? Math.max(0, now - c.born) : null;
  if (c.emptied || c.dead) return 'inactive';
  if ((!c.graduated && (c.devSold === 'all' || c.devSold === 2) && c.mcap < 10_000)
    || (c.holders >= 15 && c.top10 >= 80) || (age > 90_000 && c.dev >= 50)
    || c.bundle >= 50 || c.snipers >= 50 || c.grade === 'F') return 'risk-filter';
  if (age > 45 * 60_000 && c.mcap > 0 && c.mcap < 6000) return 'inactive';
  const stretch = !c.graduated && c.progress >= .5;
  if (stretch && !(c.mcap >= 4000)) return 'market-cap';
  if (stretch && (age == null || age > 400 * 60_000)) return 'age';
  const floor = c.graduated ? 1 : stretch ? .05 : .001;
  if (c.fees >= floor) return null;
  // Mature coins often predate our fee ledger. Known liquidity AND indexed trading
  // keep those charts eligible; a launch with missing fees must still wait.
  if (c.fees == null && age >= 864e5 && c.liq >= 1000 && (c.buys ?? 0) + (c.sells ?? 0) > 0) return null;
  return 'fees';
}

export function createCoinScreen({ lookup = () => null, held = () => false, enabled = () => true, now = Date.now } = {}) {
  const focus = new Map(), visible = new Map(), reasons = {}, counts = { admitted: 0, deferred: 0 };
  const renew = (map, mint) => {
    map.delete(mint); map.set(mint, now());
    if (map.size > 512) map.delete(map.keys().next().value);
  };
  const fresh = (map, mint, ttl) => now() - (map.get(mint) ?? -Infinity) < ttl;
  return {
    focus: mint => renew(focus, mint),
    view: mint => renew(visible, mint),
    allow(mint, purpose = 'enrich') {
      if (!enabled()) return true;
      let reason;
      try {
        // Looking at a coin is sufficient reason to price it. Discovery heuristics
        // must never prevent checking a suspicious or newly launched coin's chart.
        if (purpose === 'stream') reason = fresh(focus, mint, 15_000) || held(mint) ? null : 'not-open';
        else {
          reason = screenCoin(lookup(mint), now());
          if (!reason && !fresh(focus, mint, 15_000) && !fresh(visible, mint, 20_000)) reason = 'not-visible';
        }
      } catch { reason = 'unknown'; }
      if (reason) { counts.deferred++; reasons[reason] = (reasons[reason] || 0) + 1; return false; }
      counts.admitted++; return true;
    },
    status: () => ({ enabled: enabled(), ...counts, reasons: { ...reasons } }),
  };
}

// Installed by the server after its cheap data sources are initialized. Isolated
// tools/tests that do not run the server retain their existing behaviour.
let screen = createCoinScreen({ enabled: () => false });
export const configureCoinScreen = options => { screen = createCoinScreen(options); };
export const canEnrich = mint => screen.allow(mint);
export const canStream = mint => screen.allow(mint, 'stream');
export const focusCoin = mint => screen.focus(mint);
export const viewCoin = mint => screen.view(mint);
export const coinScreenStatus = () => screen.status();

// Only server-verified wallet snapshots may grant the held-position exception.
const wallets = new Map();
let saveWallets = () => {};
export function configureHeldWallets(rows = [], save = () => {}) {
  wallets.clear();
  for (const [id, mints] of rows) wallets.set(id, new Set(mints));
  saveWallets = save;
}
export function noteHeldWallet(id, tokens) {
  if (!Array.isArray(tokens)) return;
  const next = [...new Set(tokens.filter(t => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.mint || '') && Number(t.amount ?? t.ui) > 0).map(t => t.mint))].sort();
  if (JSON.stringify([...(wallets.get(id) || [])].sort()) === JSON.stringify(next)) return;
  if (next.length) wallets.set(id, new Set(next)); else wallets.delete(id);
  saveWallets([...wallets].map(([key, mints]) => [key, [...mints]]));
}
export const isWalletHeld = mint => { for (const mints of wallets.values()) if (mints.has(mint)) return true; return false; };
