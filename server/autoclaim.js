// Auto-claim creator rewards: a member sets a floor in SOL and, every few minutes, each account at or above it
// gets its pump.fun creator fees claimed into its Blix wallet without a visit to the page (what every launch
// tool's "auto-claim" does). The floor keeps a claim from costing more in fees than it brings in.
// One row per account (`key`: the sign-in's own id, "acc:<id>" or "sub:<google sub>"), pointing at its vault user.
export const AUTO_CLAIM_MIN = 0.001, AUTO_CLAIM_MAX = 100;

export function createAutoClaim({ db, vault, now = Date.now, log = (...a) => console.log("[auto-claim]", ...a) }) {
  db.exec(`CREATE TABLE IF NOT EXISTS auto_claim (
    key TEXT PRIMARY KEY, vault_id INTEGER NOT NULL, min_sol REAL NOT NULL, created INTEGER NOT NULL,
    claims INTEGER NOT NULL DEFAULT 0, last_t INTEGER, last_sol REAL, last_sig TEXT, error TEXT, error_t INTEGER, checked INTEGER)`);
  const row = db.prepare("SELECT * FROM auto_claim WHERE key = ?");
  const upsert = db.prepare(`INSERT INTO auto_claim (key, vault_id, min_sol, created) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET vault_id = excluded.vault_id, min_sol = excluded.min_sol`);
  const drop = db.prepare("DELETE FROM auto_claim WHERE key = ?");
  const claimed = db.prepare("UPDATE auto_claim SET claims = claims + 1, last_t = ?, last_sol = ?, last_sig = ?, error = NULL, error_t = NULL, checked = ? WHERE key = ?");
  const failed = db.prepare("UPDATE auto_claim SET error = ?, error_t = ?, checked = ? WHERE key = ?");
  const seen = db.prepare("UPDATE auto_claim SET checked = ? WHERE key = ?");

  const out = (r) => (r ? { on: true, minSol: r.min_sol, claims: r.claims, checked: r.checked,
    last: r.last_t ? { t: r.last_t, sol: r.last_sol, sig: r.last_sig } : null, error: r.error ? { text: r.error, t: r.error_t } : null }
    : { on: false, minSol: null, claims: 0, checked: null, last: null, error: null });
  const get = (key) => out(row.get(key));
  // minSol null, 0 or false switches it off.
  function set(key, vaultId, minSol) {
    if (!Number.isSafeInteger(vaultId) || vaultId < 1) throw Object.assign(new Error("No wallet to claim into."), { status: 409 });
    if (minSol == null || minSol === false || minSol === 0 || minSol === "0" || minSol === "") { drop.run(key); return get(key); }
    const n = +minSol;
    if (!Number.isFinite(n) || n < AUTO_CLAIM_MIN || n > AUTO_CLAIM_MAX) throw Object.assign(new Error(`The floor is ${AUTO_CLAIM_MIN} to ${AUTO_CLAIM_MAX} SOL.`), { status: 400 });
    upsert.run(key, vaultId, n, now());
    return get(key);
  }

  let ticking = null;
  // One pass over every account with auto-claim on. Claims are sequential: the vault serialises a wallet's spends anyway.
  function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      const did = { checked: 0, claimed: 0, failed: 0 };
      for (const r of db.prepare("SELECT * FROM auto_claim ORDER BY created").all()) {
        did.checked++;
        try {
          const due = await vault(`/users/${r.vault_id}/rewards`);
          const total = +due?.total || 0;
          if (total < r.min_sol) { seen.run(now(), r.key); continue; }
          const c = await vault(`/users/${r.vault_id}/claim`, {});
          claimed.run(now(), total, c?.signature || null, now(), r.key);
          did.claimed++;
          log(`claimed ${total.toFixed(4)} SOL for ${r.key} (${c?.status || "sent"})`);
        } catch (e) {
          failed.run(String(e?.message || e).slice(0, 200), now(), now(), r.key);
          did.failed++;
        }
      }
      return did;
    })().finally(() => { ticking = null; });
    return ticking;
  }
  let timer = null;
  function start({ everyMs = 10 * 60_000, delayMs = 90_000 } = {}) {
    if (timer) return;
    setTimeout(() => tick().catch(() => {}), delayMs).unref?.();
    timer = setInterval(() => tick().catch(() => {}), everyMs);
    timer.unref?.();
  }
  return { get, set, tick, start };
}
