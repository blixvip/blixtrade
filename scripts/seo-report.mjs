// node scripts/seo-report.mjs [search-console.json] [--out directory]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from './seo-ledger.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
export const DIMENSIONS = ['query', 'page', 'country', 'device'];
const normalizeQuery = value => value.toLowerCase().replace(/\s+/g, ' ').trim();
const pagePath = url => new URL(url).pathname.replace(/\/$/, '') || '/';
const identity = row => JSON.stringify(row.keys);
const safeText = value => String(value ?? 'unknown').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]/g, ' ');

export function validateSearchData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) throw new Error('Expected Search Console JSON with a rows array.');
  if (data.metadata !== undefined && (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata))) throw new Error('Metadata must be an object.');
  for (const dimensions of [data.dimensions, data.metadata?.dimensions]) {
    if (dimensions !== undefined && JSON.stringify(dimensions) !== JSON.stringify(DIMENSIONS)) throw new Error('Expected dimensions in query/page/country/device order.');
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const start = data.metadata?.startDate ?? data.startDate, end = data.metadata?.endDate ?? data.endDate;
  if ((start !== undefined || end !== undefined) && (!validDate(start) || !validDate(end) || start > end)) throw new Error('Export period must contain ordered, valid startDate and endDate values.');
  for (const key of ['possiblyTruncatedDays', 'daysWithoutReturnedRows']) {
    if (data.metadata?.[key] !== undefined && (!Array.isArray(data.metadata[key]) || data.metadata[key].some(value => !validDate(value)))) throw new Error(`Invalid metadata ${key}.`);
  }
  if (data.metadata?.notes !== undefined && (!Array.isArray(data.metadata.notes) || data.metadata.notes.some(value => typeof value !== 'string'))) throw new Error('Metadata notes must be a string array.');
  const seen = new Set();
  const rows = data.rows.map((row, index) => {
    const fail = reason => { throw new Error(`Invalid Search Console row ${index + 1}: ${reason}`); };
    if (!row || !Array.isArray(row.keys) || row.keys.length !== 4 || row.keys.some(k => typeof k !== 'string' || !k.trim())) fail('four nonempty query/page/country/device keys required.');
    if (!/^[a-z]{3}$/i.test(row.keys[2]) || !['DESKTOP', 'MOBILE', 'TABLET'].includes(row.keys[3].toUpperCase())) fail('invalid country or device.');
    let url;
    try { url = new URL(row.keys[1]); } catch { fail('invalid page URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('page must be an HTTP(S) URL without credentials.');
    if (!Number.isSafeInteger(row.clicks) || !Number.isSafeInteger(row.impressions) || row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions) fail('invalid click/impression counts.');
    if (!Number.isFinite(row.position) || !Number.isFinite(row.position * row.impressions) || row.position < 0 || (row.impressions > 0 && row.position < 1)) fail('invalid average position.');
    if (row.ctr !== undefined && (!Number.isFinite(row.ctr) || row.ctr < 0 || row.ctr > 1 || Math.abs(row.ctr - (row.impressions ? row.clicks / row.impressions : 0)) > 0.0001)) fail('invalid or inconsistent CTR.');
    const normalized = { ...row, keys: [row.keys[0], url.href, row.keys[2].toLowerCase(), row.keys[3].toUpperCase()] };
    const key = identity(normalized);
    if (seen.has(key)) fail('duplicate dimension row; aggregate daily exports before reporting to avoid double counting.');
    seen.add(key);
    return normalized;
  });
  return { ...data, rows };
}

function accumulator() { return { clicks: 0, impressions: 0, weightedPosition: 0, rows: 0 }; }
function add(acc, row) {
  acc.clicks += row.clicks; acc.impressions += row.impressions; acc.weightedPosition += row.position * row.impressions; acc.rows++;
  if (!Number.isSafeInteger(acc.clicks) || !Number.isSafeInteger(acc.impressions) || !Number.isFinite(acc.weightedPosition)) throw new Error('Search metrics exceed safe numeric aggregation limits.');
}
function metrics(acc) {
  if (!acc?.rows) return { clicks: null, impressions: null, ctr: null, average_position: null };
  return { clicks: acc.clicks, impressions: acc.impressions, ctr: acc.impressions ? acc.clicks / acc.impressions : null, average_position: acc.impressions ? acc.weightedPosition / acc.impressions : null };
}
function nextAction(keyword) {
  if (keyword.roadmap_id) return `Resolve ${keyword.roadmap_id} acceptance evidence before claiming complete coverage; review docs/seo/roadmap.md.`;
  if (keyword.measurement_status !== 'measured') return 'Verify Search Console access, query coverage and target-page indexing; absent rows do not establish zero demand or zero rank.';
  if (keyword.cannibalization_candidate) return 'Compare returned pages within the same country/device; check intent, canonicals and internal links before considering consolidation.';
  if (keyword.target_mismatch) return 'Review why another page receives impressions; compare search intent and internal links with the assigned target.';
  if (keyword.impressions >= 100 && keyword.ctr < 0.01) return 'Review the actual result and intent; improve truthful title/description and page answer, then compare an equal-length period.';
  if (keyword.average_position >= 4 && keyword.average_position <= 20) return 'Strengthen the answer, original evidence and relevant internal links; review the same market and device next period.';
  return 'Monitor comparable periods and qualified conversions; inspect search intent before expanding content.';
}

export function buildPerformanceReport({ ledger, data = null, origin = 'https://blixvip.com', now = new Date() }) {
  if (!Array.isArray(ledger)) throw new Error('Keyword ledger must be an array.');
  if (new URL(origin).origin !== origin) throw new Error('Report origin must be an exact URL origin.');
  const input = data === null ? null : validateSearchData(data);
  const targets = new Map();
  for (const entry of ledger) {
    if (!entry.normalized_keyword) continue;
    const query = normalizeQuery(entry.normalized_keyword);
    const prior = targets.get(query);
    if (prior && (prior.assigned_page !== entry.assigned_page || prior.roadmap_id !== entry.roadmap_id)) throw new Error(`Conflicting assignments for keyword: ${query}`);
    if (!prior) targets.set(query, entry);
  }
  const byKeyword = new Map(), byDetail = new Map(), byMarket = new Map(), sameMarketPages = new Map();
  const stats = { sourceRows: input?.rows.length ?? 0, filteredOriginRows: 0, untrackedRows: 0, matchedRows: 0 };
  for (const row of input?.rows || []) {
    const [rawQuery, url, country, device] = row.keys;
    if (new URL(url).origin !== origin) { stats.filteredOriginRows++; continue; }
    const marketKey = JSON.stringify([country, device]);
    if (!byMarket.has(marketKey)) byMarket.set(marketKey, { country, device, ...accumulator() });
    add(byMarket.get(marketKey), row);
    const query = normalizeQuery(rawQuery);
    if (!targets.has(query)) { stats.untrackedRows++; continue; }
    stats.matchedRows++;
    if (!byKeyword.has(query)) byKeyword.set(query, { ...accumulator(), pages: new Set(), markets: new Set() });
    const keyword = byKeyword.get(query);
    add(keyword, row); keyword.pages.add(url); keyword.markets.add(marketKey);
    const detailKey = JSON.stringify([query, url, country, device]);
    if (!byDetail.has(detailKey)) byDetail.set(detailKey, { query, page: url, country, device, observedQueries: new Set(), ...accumulator() });
    const detail = byDetail.get(detailKey);
    add(detail, row); detail.observedQueries.add(rawQuery);
    const competitionKey = JSON.stringify([query, country, device]);
    if (!sameMarketPages.has(competitionKey)) sameMarketPages.set(competitionKey, new Set());
    if (row.impressions > 0) sameMarketPages.get(competitionKey).add(pagePath(url));
  }
  const period = { start_date: input?.metadata?.startDate ?? input?.startDate ?? 'unknown', end_date: input?.metadata?.endDate ?? input?.endDate ?? 'unknown' };
  const keywords = [...targets].map(([query, target]) => {
    const measured = byKeyword.get(query);
    const pages = [...(measured?.pages || [])].sort();
    const candidate = [...(measured?.markets || [])].some(market => sameMarketPages.get(JSON.stringify([query, ...JSON.parse(market)]))?.size > 1);
    const item = { ...period, query, country: measured ? 'all returned countries' : 'unknown', device: measured ? 'all returned devices' : 'unknown', target_page: target.assigned_page || '', observed_pages: pages.join(' | '), measurement_status: measured ? 'measured' : input ? 'unknown-not-returned' : 'unknown-no-source', ...metrics(measured), cannibalization_candidate: measured ? candidate : null, target_mismatch: measured && target.assigned_page ? pages.some(url => pagePath(url) !== (target.assigned_page.replace(/\/$/, '') || '/')) : null, market_count: measured?.markets.size ?? null, priority: target.priority, roadmap_id: target.roadmap_id || '' };
    item.next_action = nextAction(item);
    return item;
  });
  const summaries = new Map(keywords.map(row => [row.query, row]));
  const details = [...byDetail.values()].map(detail => {
    const summary = summaries.get(detail.query);
    const pages = sameMarketPages.get(JSON.stringify([detail.query, detail.country, detail.device]));
    const item = { ...period, query: detail.query, observed_queries: [...detail.observedQueries].join(' | '), page: detail.page, country: detail.country, device: detail.device, target_page: summary.target_page, measurement_status: 'measured', ...metrics(detail), cannibalization_candidate: pages.size > 1, target_mismatch: summary.target_page ? pagePath(detail.page) !== (summary.target_page.replace(/\/$/, '') || '/') : null, priority: summary.priority, roadmap_id: summary.roadmap_id };
    item.next_action = nextAction(item);
    return item;
  }).sort((a, b) => a.query.localeCompare(b.query) || a.country.localeCompare(b.country) || a.device.localeCompare(b.device) || a.page.localeCompare(b.page));
  const markets = [...byMarket.values()].map(row => ({ country: row.country, device: row.device, ...metrics(row) }));
  const notes = [
    input ? 'Input supplied. Metrics summarize returned page-level rows only; omitted/anonymized queries and API limits mean these are not site totals.' : 'Search Console not connected. Every keyword remains unknown; no traffic, rank or improvement is claimed.',
    'Average position is impression-weighted across returned page rows, not a fixed rank. Summary values combine markets; inspect country/device detail before acting.',
    'A missing query is unknown, not zero. An observed zero remains zero. No exported row is proof of complete indexation or total search demand.',
    'Cannibalization is a review candidate only: two paths with impressions for the same normalized query, country and device. Different markets and query-string/trailing-slash variants alone do not trigger it.',
    ...(Array.isArray(input?.metadata?.notes) ? input.metadata.notes.filter(note => typeof note === 'string') : []),
  ];
  if (input?.metadata?.possiblyTruncatedDays?.length) notes.push(`Possibly truncated days: ${input.metadata.possiblyTruncatedDays.join(', ')}.`);
  if (input?.metadata?.daysWithoutReturnedRows?.length) notes.push(`Days without returned rows (not proof of zero traffic): ${input.metadata.daysWithoutReturnedRows.join(', ')}.`);
  const display = (value, kind = '') => value === null ? 'unknown' : kind === 'ctr' ? `${(value * 100).toFixed(2)}%` : kind === 'position' ? value.toFixed(2) : safeText(value);
  const keywordTable = keywords.map(row => `| ${safeText(row.query)} | ${safeText(row.target_page || 'roadmap')} | ${safeText(row.measurement_status)} | ${display(row.clicks)} | ${display(row.impressions)} | ${display(row.ctr, 'ctr')} | ${display(row.average_position, 'position')} | ${display(row.cannibalization_candidate)} | ${safeText(row.priority)} | ${safeText(row.next_action)} |`).join('\n');
  const detailTable = details.map(row => `| ${safeText(row.query)} | ${safeText(row.page)} | ${row.country} | ${row.device} | ${display(row.clicks)} | ${display(row.impressions)} | ${display(row.ctr, 'ctr')} | ${display(row.average_position, 'position')} | ${display(row.cannibalization_candidate)} |`).join('\n');
  const markdown = `# BLIX keyword search performance\n\nGenerated: ${now.toISOString()}\nPeriod: ${safeText(period.start_date)} through ${safeText(period.end_date)} (Search Console Pacific dates).\n\n${notes.map(note => `- ${safeText(note)}`).join('\n')}\n\n## Coverage\n\n${keywords.length} unique supplied keywords; ${keywords.filter(row => row.measurement_status === 'measured').length} have returned observations. ${stats.filteredOriginRows} noncanonical-origin rows excluded; ${stats.untrackedRows} other-query rows appear only in the market totals. Source: docs/seo/keyword-ledger.csv.\n\n## Country and device: all returned canonical-origin rows\n\n| Country | Device | Clicks | Impressions | CTR | Average position |\n|---|---|---:|---:|---:|---:|\n${markets.map(row => `| ${row.country} | ${row.device} | ${display(row.clicks)} | ${display(row.impressions)} | ${display(row.ctr, 'ctr')} | ${display(row.average_position, 'position')} |`).join('\n') || '| unknown | unknown | unknown | unknown | unknown | unknown |'}\n\n## Every supplied keyword\n\nCountries/devices are combined only in this summary. Observed URLs and market details are in keyword-performance.csv and keyword-page-markets.csv.\n\n| Keyword | Target | Measurement | Clicks | Impressions | CTR | Average position | Cannibalization candidate | Priority | Next action |\n|---|---|---|---:|---:|---:|---:|---|---|---|\n${keywordTable}\n\n## Returned keyword/page/country/device observations\n\n| Keyword | Observed page | Country | Device | Clicks | Impressions | CTR | Average position | Cannibalization candidate |\n|---|---|---|---|---:|---:|---:|---:|---|\n${detailTable || '| unknown | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unknown |'}\n\n## Next review\n\nCompare equal-length periods using identical dimensions, filters and markets. Review candidate issues manually, then measure qualified signups and product use separately. These exports do not measure conversions or prove #1 rankings.\n`;
  return { keywords, details, markets, stats, notes, markdown };
}

export function reportCsv(rows, columns = Object.keys(rows[0] || {})) {
  const cell = value => {
    let text = value === null || value === undefined ? 'unknown' : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/seo-report.mjs [search-console.json] [--out directory]'); return; }
  let input, out = path.join(ROOT, 'data/seo-review');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) out = path.resolve(args[++i]);
    else if (!args[i].startsWith('-') && !input) input = args[i];
    else throw new Error('Usage: node scripts/seo-report.mjs [search-console.json] [--out directory]');
  }
  const data = input ? JSON.parse(await readFile(input, 'utf8')) : null;
  const source = await readFile(path.join(ROOT, 'docs/seo/keywords-source.txt'), 'utf8');
  const result = buildPerformanceReport({ ledger: buildLedger(source), data });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'performance.md'), result.markdown);
  await writeFile(path.join(out, 'keyword-performance.csv'), reportCsv(result.keywords));
  await writeFile(path.join(out, 'keyword-page-markets.csv'), reportCsv(result.details, ['start_date', 'end_date', 'query', 'observed_queries', 'page', 'country', 'device', 'target_page', 'measurement_status', 'clicks', 'impressions', 'ctr', 'average_position', 'cannibalization_candidate', 'target_mismatch', 'priority', 'roadmap_id', 'next_action']));
  console.log(`Generated ${result.keywords.length} keyword rows in ${out}; ${result.keywords.filter(row => row.measurement_status === 'measured').length} measured.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
