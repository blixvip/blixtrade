// Bound retained assets by bytes as well as count. Oversized files are served without retention.
export function createByteCache({ maxBytes, maxEntries, sizeOf }) {
  const entries = new Map();
  let bytes = 0;
  const drop = key => {
    const old = entries.get(key);
    if (!old) return false;
    bytes -= old.bytes; return entries.delete(key);
  };
  return {
    get bytes() { return bytes; },
    get size() { return entries.size; },
    has: key => entries.has(key),
    delete: drop,
    get(key) {
      const row = entries.get(key);
      if (!row) return undefined;
      entries.delete(key); entries.set(key, row);
      return row.value;
    },
    set(key, value) {
      drop(key);
      const size = sizeOf(value);
      if (!Number.isFinite(size) || size < 0 || size > maxBytes) return;
      entries.set(key, { value, bytes: size }); bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) drop(entries.keys().next().value);
    },
  };
}
