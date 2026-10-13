import fs from 'node:fs';
import path from 'node:path';
import { db, DATA, json } from './db.js';
import { liveStats, live } from './livetrades.js';
import { launchIndex } from './engine.js';
import { rowHolders } from './holders.js';
import { feesOf } from './coinfees.js';
import { figures } from './jupdisc.js';
import { configureCoinScreen, configureHeldWallets, isWalletHeld } from './coin-screen.js';

export function startCoinScreen() {
  const file = path.join(DATA, 'held-screen-wallets.json');
  let held = [];
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  configureHeldWallets(held, rows => {
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(rows), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); } catch {}
  });
  const token = db.prepare('SELECT * FROM tokens WHERE mint = ?');
  const paper = db.prepare("SELECT 1 FROM paper WHERE mint = ? AND status = 'open' LIMIT 1");
  const research = db.prepare("SELECT grade FROM research WHERE mint = ? AND status != 'expired'");
  const cache = new Map();
  configureCoinScreen({
    enabled: () => process.env.BLIX_COIN_SCREEN !== '0',
    held: mint => isWalletHeld(mint) || Boolean(paper.get(mint)),
    lookup(mint) {
      const hit = cache.get(mint);
      if (hit && Date.now() - hit.at < 2000) return hit.coin;
      const t = token.get(mint), x = liveStats(mint), l = launchIndex.get(mint), h = rowHolders(mint), j = figures(mint, '5m');
      const safety = !t?.graduated || Date.now() - (t.safety_checked || 0) < 180_000 ? json(t?.safety, {}) || {} : {};
      const fresh = x && Date.now() - x.last < 120_000;
      const graduated = Boolean(t?.graduated || j?.graduated || x?.pool || x?.progress >= .995);
      const coin = !t && !x && !l && !j ? null : {
        born: t?.pair_created || t?.first_seen || l?.seen || live.get(mint)?.first,
        graduated, progress: x?.progress,
        mcap: fresh ? x.mc : j?.mc ?? t?.mcap,
        fees: feesOf(mint)?.sol ?? null,
        liq: fresh && x.pool ? x.liq : j?.liq ?? t?.liquidity,
        buys: j?.buys ?? (fresh ? x.buys : 0), sells: j?.sells ?? (fresh ? x.sells : 0),
        holders: h?.p ? j?.holders ?? safety.totalHolders : h?.h ?? j?.holders ?? safety.totalHolders,
        top10: h?.p ? j?.top10 ?? safety.top10 : h?.t10 ?? j?.top10 ?? safety.top10,
        dev: h?.p ? j?.dev ?? safety.devPct : h?.dev ?? j?.dev ?? safety.devPct,
        snipers: h?.sn, bundle: h?.bd, devSold: h?.ds,
        grade: research.get(mint)?.grade,
        dead: t?.status === 'dead' && !fresh,
        emptied: graduated && fresh && x.pool && x.liq === 0,
      };
      cache.delete(mint); cache.set(mint, { at: Date.now(), coin });
      if (cache.size > 5000) cache.delete(cache.keys().next().value);
      return coin;
    },
  });
}
