// Read-only Search Analytics importer. Token is supplied explicitly via GSC_ACCESS_TOKEN.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIMENSIONS, validateSearchData } from './seo-report.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DAY = 86400000;
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function defaultPeriod(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const endDate = shiftDate(today, -1);
  return { startDate: shiftDate(endDate, -27), endDate };
}

function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || shiftDate(value, 0) !== value) throw new Error('Dates must be real calendar dates in YYYY-MM-DD format.');
}

function validateProperty(property) {
  if (typeof property !== 'string') throw new Error('Search Console property must be a domain or HTTPS URL-prefix property.');
  if (/^sc-domain:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(property)) return;
  try { const url = new URL(property); if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search) return; } catch {}
  throw new Error('Search Console property must be sc-domain:example.com or an HTTPS URL-prefix property.');
}

export async function importSearchConsole({ token, property = 'sc-domain:blixvip.com', startDate, endDate, now = new Date(), fetchImpl = fetch, rowLimit = 25000, maxRowsPerDay = 50000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Set GSC_ACCESS_TOKEN to an OAuth token with webmasters.readonly access. No credential files are read.');
  if (/\s/.test(token) || token.length > 8192) throw new Error('GSC_ACCESS_TOKEN must be a single valid bearer token.');
  validateProperty(property);
  if (Boolean(startDate) !== Boolean(endDate)) throw new Error('Provide both start and end dates, or neither.');
  ({ startDate, endDate } = startDate ? { startDate, endDate } : defaultPeriod(now));
  validateDate(startDate); validateDate(endDate);
  const dayCount = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1;
  if (dayCount < 1 || dayCount > 31) throw new Error('Date range must be ordered and contain 1–31 days. Use separate exports for larger periods.');
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000 || !Number.isInteger(maxRowsPerDay) || maxRowsPerDay < 1 || maxRowsPerDay > 50000) throw new Error('Invalid row limits: at most 25,000 per request and 50,000 per day.');
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const aggregated = new Map(), days = [], possiblyTruncatedDays = [], daysWithoutReturnedRows = [];
  let requests = 0;
  async function query(body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try { response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' }); }
      catch { throw new Error('Search Console request failed (network or timeout). No report was saved.'); }
      requests++;
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
        const retrySeconds = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.min(10000, retrySeconds * 1000) : 500 * (2 ** attempt);
        await sleep(delay); continue;
      }
      if (!response.ok) throw new Error(`Search Console request failed (HTTP ${response.status}). ${response.status === 401 || response.status === 403 ? 'Check token scope and property access.' : 'Retry later or inspect your Google API quota.'} No response body or credential is logged.`);
      let data;
      try { data = await response.json(); } catch { throw new Error('Search Console returned invalid JSON. No report was saved.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || ('rows' in data && !Array.isArray(data.rows))) throw new Error('Search Console returned an invalid rows structure.');
      return validateSearchData({ rows: data.rows ?? [] }).rows;
    }
  }
  for (let index = 0; index < dayCount; index++) {
    const date = shiftDate(startDate, index);
    let received = 0;
    const seen = new Set();
    while (received < maxRowsPerDay) {
      const batchLimit = Math.min(rowLimit, maxRowsPerDay - received);
      const rows = await query({ startDate: date, endDate: date, dimensions: DIMENSIONS, type: 'web', dataState: 'final', aggregationType: 'auto', rowLimit: batchLimit, startRow: received });
      if (rows.length > batchLimit) throw new Error('Search Console returned more rows than requested. No report was saved.');
      for (const row of rows) {
        const key = JSON.stringify(row.keys);
        if (seen.has(key)) throw new Error('Search Console returned a duplicate dimension row across pages within one day. No report was saved.');
        seen.add(key);
        const acc = aggregated.get(key) || { keys: row.keys, clicks: 0, impressions: 0, weightedPosition: 0 };
        acc.clicks += row.clicks; acc.impressions += row.impressions; acc.weightedPosition += row.position * row.impressions;
        aggregated.set(key, acc);
      }
      received += rows.length;
      if (rows.length < batchLimit) break;
    }
    if (received >= maxRowsPerDay) possiblyTruncatedDays.push(date);
    if (!received) daysWithoutReturnedRows.push(date);
    days.push({ date, returnedRows: received, possibleTruncation: received >= maxRowsPerDay });
  }
  const rows = [...aggregated.values()].map(row => ({ keys: row.keys, clicks: row.clicks, impressions: row.impressions, ctr: row.impressions ? row.clicks / row.impressions : 0, position: row.impressions ? row.weightedPosition / row.impressions : 0 }));
  return {
    dimensions: DIMENSIONS,
    metadata: {
      source: 'Google Search Console Search Analytics API', property, startDate, endDate, timeZone: 'America/Los_Angeles', type: 'web', dataState: 'final', dimensions: DIMENSIONS,
      fetchedAt: now.toISOString(), requests, dailyRowLimit: maxRowsPerDay, days, possiblyTruncatedDays, daysWithoutReturnedRows,
      notes: [
        'Requested one Pacific calendar day per query, finalized data only. The API does not guarantee all rows, even below the daily limit.',
        'At most 50,000 rows per day per search type are available. Hitting the configured daily cap is marked possible truncation; omitted/anonymized queries remain unknown.',
        'The default period is the previous 28 completed Pacific calendar days. The newest completed days may not yet have finalized data; empty days are not assumed to have zero traffic.',
        'Daily rows were merged by exact query/page/country/device keys. Clicks and impressions are summed; CTR is recomputed and position is impression-weighted.',
      ],
    },
    rows,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/seo-search-console.mjs [--start YYYY-MM-DD --end YYYY-MM-DD] [--out export.json]\nRequires GSC_ACCESS_TOKEN; optional GSC_SITE_PROPERTY defaults to sc-domain:blixvip.com. Reads Search Analytics only.'); return; }
  const options = {};
  let out;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) options.startDate = args[++i];
    else if (args[i] === '--end' && args[i + 1]) options.endDate = args[++i];
    else if (args[i] === '--out' && args[i + 1]) out = path.resolve(args[++i]);
    else throw new Error('Unknown or incomplete argument. Use --help.');
  }
  const data = await importSearchConsole({ ...options, token: process.env.GSC_ACCESS_TOKEN, property: process.env.GSC_SITE_PROPERTY || 'sc-domain:blixvip.com' });
  out ||= path.join(ROOT, `data/seo-review/search-console-${data.metadata.startDate}-${data.metadata.endDate}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  const temporary = `${out}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, out);
  console.log(`Saved ${data.rows.length} dimension rows: ${out}`);
  if (data.metadata.possiblyTruncatedDays.length) console.log(`Possible truncation on ${data.metadata.possiblyTruncatedDays.length} days; see export metadata.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
