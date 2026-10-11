export function createPriceGuard({ now = Date.now, maxCoins = 500 } = {}) {
  const values = new Map();
  return { accept(mint, value, slot) {
    if (!Number.isFinite(value) || value <= 0 || value > 1e8) return false;
    const t = now(), old = values.get(mint);
    if (old && slot != null && old.slot != null && slot < old.slot) return false;
    if (old && t - old.at < 10_000 && (value / old.value > 20 || value / old.value < .05)) {
      if (!(old.held && slot != null && slot > old.heldSlot && value / old.held > .5 && value / old.held < 2)) { old.held = value; old.heldSlot = slot; return false; }
    }
    values.delete(mint); values.set(mint, { value, slot, at: t });
    if (values.size > maxCoins) values.delete(values.keys().next().value);
    return true;
  } };
}
