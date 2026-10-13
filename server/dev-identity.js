// Reuse stored identities only when they are linked to the actual trading wallet.
export function createDevIdentityLookup(db) {
  let fomo, pump;
  return wallet => {
    try {
      fomo ||= db.prepare(`SELECT w.handle, p.data,
        (SELECT name FROM fomo_board WHERE uid=w.uid ORDER BY t DESC LIMIT 1) AS name,
        (SELECT pic FROM fomo_board WHERE uid=w.uid ORDER BY t DESC LIMIT 1) AS pic
        FROM fomo_wallets w LEFT JOIN fomo_profiles p ON p.uid=w.uid
        WHERE w.wallet=? AND w.matches>=2 ORDER BY w.checked DESC LIMIT 1`);
      const row = fomo.get(wallet);
      if (row) {
        let p = {}; try { p = JSON.parse(row.data || '{}'); } catch {}
        return { name: p.name || row.name || row.handle, pic: p.pic || row.pic || null,
          bio: p.bio || null, x: typeof p.twitter === 'string' ? p.twitter.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//,'').replace(/^@/,'').split(/[/?#]/)[0] : null,
          followers: p.followers ?? null, handle: row.handle, identitySource: 'fomo' };
      }
    } catch { /* Older databases may not have the Fomo tables yet. */ }
    try {
      pump ||= db.prepare('SELECT name,pic,followers,x FROM pump_people WHERE wallet=? AND name IS NOT NULL');
      const row = pump.get(wallet);
      if (row) return { ...row, identitySource: 'pump' };
    } catch {}
    return null;
  };
}
