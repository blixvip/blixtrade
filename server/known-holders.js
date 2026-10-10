// Compact, chain-scoped summaries for coin rows. Only accounts still holding count as faces.
export const SOL_NETWORK = 1399811149;
export const knownKey = ({ address, networkId }) => networkId === SOL_NETWORK ? address : `${networkId}:${address.toLowerCase()}`;
export function parseKnownTokens(value = '') {
  const out = new Map();
  for (const part of String(value).slice(0, 12000).split(',')) {
    const [net, address] = part.split(':'), networkId = Number(net);
    if (![SOL_NETWORK, 1, 56, 8453, 143, 4663].includes(networkId) || !address) continue;
    if (!(networkId === SOL_NETWORK ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[\da-fA-F]{40}$/).test(address)) continue;
    const token = { address: networkId === SOL_NETWORK ? address : address.toLowerCase(), networkId };
    out.set(knownKey(token), token);
    if (out.size === 100) break;
  }
  return [...out.values()];
}
export function holderSummary(data) {
  const seen = new Set();
  const holders = (Array.isArray(data?.holders) ? data.holders : []).filter(h => {
    if (!h || (h.amount != null && Number(h.amount) <= 0)) return false;
    const id = String(h.handle || h.wallet || h.name || '').toLowerCase();
    if (id && seen.has(id)) return false;
    if (id) seen.add(id);
    return true;
  }).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const count = Number.isFinite(data?.totalHolders) ? Math.max(holders.length, Math.floor(data.totalHolders)) : holders.length;
  return [count, holders.slice(0, 3).map(h => [h.handle || h.name || '', h.pic || '', Number.isFinite(h.value) ? h.value : null])];
}
