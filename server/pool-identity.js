// A pool address in a token listing is not evidence of its quote currency.
// The journal's swap decoder assumes a six-decimal base and nine-decimal SOL quote.
const AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL = 'So11111111111111111111111111111111111111112';
function b58(bytes) {
  let n = 0n, out = '';
  for (const b of bytes) n = n * 256n + BigInt(b);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b) break; out = '1' + out; }
  return out;
}
export function solPumpMint(account) {
  if (account?.owner !== AMM || account?.data?.[1] !== 'base64') return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length !== 64) return null;
  const base = b58(data.subarray(0, 32)), quote = b58(data.subarray(32));
  return quote === WSOL && base.endsWith('pump') ? base : null;
}
export function createSolPoolResolver(call, now = Date.now) {
  const cache = new Map();
  return async (pool) => {
    const cached = cache.get(pool);
    if (cached && now() - cached.at < (cached.mint ? 3600_000 : 60_000)) return cached.mint;
    try {
      const account = (await call('getMultipleAccounts', [[pool], { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 43, length: 64 } }]))?.value?.[0];
      if (!account) return null; // A new pool may not have reached the RPC yet; retry later.
      const mint = solPumpMint(account);
      cache.set(pool, { mint, at: now() });
      if (cache.size > 20_000) cache.delete(cache.keys().next().value);
      return mint;
    } catch { return null; }
  };
}
