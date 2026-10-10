import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA } from './db.js';
import { createFeedHistory } from './feed-history-store.js';
import { fomoFeed, peekFeed, onFomoFeed } from './fomofeed.js';
import { pumpFeed, peekPump, onPumpFeed } from './pumpfeed.js';
const db = new DatabaseSync(path.join(DATA, 'feed-history.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
const history = createFeedHistory(db);
onFomoFeed(key => history.ingest('fomo', peekFeed(key)));
onPumpFeed(() => history.ingest('pump', peekPump()));
export function feedHistory(params) {
  const sources = String(params.sources ?? 'fomo,pump').split(',');
  const fomo = sources.includes('fomo') ? fomoFeed(params.groups) : null;
  const pump = sources.includes('pump') ? pumpFeed() : null;
  if (fomo?.items) history.ingest('fomo', fomo.items);
  // The compact HTTP list omits original post times and extra identity fields; archive the source records.
  if (pump?.items) history.ingest('pump', peekPump());
  return { ...history.page(params), status: { fomo: fomo && { t: fomo.t, error: Boolean(fomo.error), signedOut: Boolean(fomo.signedOut), ready: Boolean(fomo.items) }, pump: pump && { t: pump.t, error: Boolean(pump.error), ready: Boolean(pump.items) } } };
}
