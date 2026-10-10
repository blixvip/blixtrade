// Shared BTC/ETH/SOL status-bar prices. A slow provider must not delay a healthy one.
export function createMarketPrices({ fetch = (...args) => globalThis.fetch(...args), now = Date.now } = {}) {
  let value = null, pending = null, nextRead = 0, binanceDownUntil = 0, generation = 0;
  const empty = () => ({ t: now(), source: null, btc: null, eth: null, sol: null });
  const price = (amount, change = null) => {
    const usd = Number(amount);
    return Number.isFinite(usd) && usd > 0 ? { usd, chg24: Number.isFinite(change) ? change : null } : null;
  };
  const ask = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw Error(`Market prices: HTTP ${response.status}`);
    return response.json();
  };
  async function read() {
    const run = ++generation;
    const binance = now() < binanceDownUntil ? Promise.reject(Error('skipped')) :
      ask('https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]&type=MINI').then(rows => {
        const result = { ...empty(), source: 'binance' };
        for (const row of rows) {
          const key = { BTCUSDT: 'btc', ETHUSDT: 'eth', SOLUSDT: 'sol' }[row.symbol];
          if (key) result[key] = price(row.lastPrice, row.openPrice > 0 ? (row.lastPrice / row.openPrice - 1) * 100 : null);
        }
        return result;
      }).catch(error => { binanceDownUntil = now() + 30 * 60_000; throw error; });
    const coinbase = Promise.all(['BTC', 'ETH', 'SOL'].map(symbol =>
      ask(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`).then(body => price(body.data?.amount)).catch(() => null)))
      .then(([btc, eth, sol]) => ({ t: now(), source: 'coinbase', btc, eth, sol }));
    const complete = async promise => {
      const result = await promise;
      if (!result.btc || !result.eth || !result.sol) throw Error('Incomplete market prices');
      return result;
    };
    try {
      // A full answer is usable immediately. The other request is bounded by its own timeout.
      const result = await Promise.any([complete(binance), complete(coinbase)]);
      if (result.source === 'coinbase') {
        complete(binance).then(async richer => {
          await pending; // Let the first spot answer publish before enriching it.
          if (generation === run) value = richer;
        }).catch(() => {});
      }
      return result;
    } catch {
      const results = await Promise.allSettled([binance, coinbase]);
      const partial = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const result = empty();
      for (const key of ['btc', 'eth', 'sol']) result[key] = partial.find(r => r[key])?.[key] ?? null;
      if (result.btc || result.eth || result.sol) result.source = partial.length > 1 ? 'mixed' : partial[0].source;
      return result;
    }
  }
  return async function prices() {
    if (!pending && now() >= nextRead) {
      pending = read().then(result => {
        if (result.btc || result.eth || result.sol) value = result;
        // Back off after an outage; retain the last successful reading and its original timestamp.
        nextRead = now() + 15_000;
        return value || result;
      }).finally(() => { pending = null; });
    }
    return value || pending || empty();
  };
}
export const marketPrices = createMarketPrices();
