import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLedger } from '../scripts/seo-ledger.mjs';
import { buildPerformanceReport, validateSearchData, reportCsv } from '../scripts/seo-report.mjs';
import { importSearchConsole, defaultPeriod } from '../scripts/seo-search-console.mjs';

const ledger = [
  { normalized_keyword: 'pumpfun api', assigned_page: '/pump-fun-api', priority: 'P1', roadmap_id: '', occurrence_id: 'KW-1' },
  { normalized_keyword: 'pumpfun api', assigned_page: '/pump-fun-api', priority: 'P1', roadmap_id: '', occurrence_id: 'KW-2' },
  { normalized_keyword: 'crypto cli', assigned_page: '', priority: 'P3', roadmap_id: 'cli-package', occurrence_id: 'KW-3' },
];
const row = (query, page, impressions, position, clicks = 0, country = 'usa', device = 'DESKTOP') => ({ keys: [query, page, country, device], impressions, clicks, position, ctr: impressions ? clicks / impressions : 0 });

test('all 850 keywords remain unknown without data; repeated source entries do not inflate report', async () => {
  const source = await readFile(new URL('../docs/seo/keywords-source.txt', import.meta.url), 'utf8');
  const result = buildPerformanceReport({ ledger: buildLedger(source), now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(result.keywords.length, 850);
  assert.ok(result.keywords.every(item => item.measurement_status === 'unknown-no-source' && item.clicks === null && item.impressions === null && item.average_position === null));
  assert.match(result.markdown, /Average position.*not.*fixed rank/i);
  assert.equal(result.details.length, 0);
});

test('weighted metrics, observed pages, target mismatch and market-specific cannibalization', () => {
  const data = { rows: [
    row('pumpfun api', 'https://blixvip.com/pump-fun-api', 10, 2, 2),
    row('PUMPFUN API', 'https://blixvip.com/api', 30, 10, 3),
    row('pumpfun api', 'https://blixvip.com/pump-fun-api', 10, 5, 1, 'can', 'MOBILE'),
    row('untracked query', 'https://blixvip.com/', 50, 3, 4),
  ] };
  const result = buildPerformanceReport({ ledger, data });
  const keyword = result.keywords[0];
  assert.equal(keyword.clicks, 6);
  assert.equal(keyword.impressions, 50);
  assert.equal(keyword.ctr, 0.12);
  assert.equal(keyword.average_position, 7.4);
  assert.equal(keyword.cannibalization_candidate, true);
  assert.equal(keyword.target_mismatch, true);
  assert.equal(result.details.length, 3);
  assert.equal(result.details.find(r => r.country === 'can').cannibalization_candidate, false);
  assert.equal(result.keywords[1].measurement_status, 'unknown-not-returned');
  assert.equal(result.keywords[1].clicks, null);
  assert.equal(result.stats.untrackedRows, 1);
});

test('different countries, devices and URL query parameters alone are not cannibalization', () => {
  const data = { rows: [
    row('pumpfun api', 'https://blixvip.com/pump-fun-api?ref=x', 1, 2),
    row('pumpfun api', 'https://blixvip.com/pump-fun-api/', 1, 2),
    row('pumpfun api', 'https://blixvip.com/api', 1, 3, 0, 'can'),
  ] };
  assert.equal(buildPerformanceReport({ ledger, data }).keywords[0].cannibalization_candidate, false);
});

test('filters noncanonical origins; preserves genuine measured zeros and empty-source uncertainty', () => {
  const data = { rows: [row('pumpfun api', 'https://blixvip.com.evil.test/pump-fun-api', 100, 1, 10), row('pumpfun api', 'http://blixvip.com/pump-fun-api', 100, 1, 10), row('crypto cli', 'https://blixvip.com/api', 0, 0)] };
  const result = buildPerformanceReport({ ledger, data });
  assert.equal(result.stats.filteredOriginRows, 2);
  assert.equal(result.keywords[0].clicks, null);
  assert.equal(result.keywords[1].clicks, 0);
  assert.equal(result.keywords[1].average_position, null);
  assert.equal(result.keywords[1].ctr, null);
  assert.equal(buildPerformanceReport({ ledger, data: { rows: [] } }).keywords[0].impressions, null);
});

test('validates dimensions, keys, URLs, counts, CTR, positions and duplicate exported rows', () => {
  const valid = row('pumpfun api', 'https://blixvip.com/api', 10, 2, 1);
  for (const bad of [{}, { rows: {} }, { rows: [{ ...valid, keys: ['query'] }] }, { rows: [{ ...valid, keys: ['q', 'not a url', 'usa', 'MOBILE'] }] }, { rows: [{ ...valid, keys: ['q', 'https://user:pass@blixvip.com/', 'usa', 'MOBILE'] }] }, { rows: [{ ...valid, clicks: -1 }] }, { rows: [{ ...valid, clicks: 11 }] }, { rows: [{ ...valid, impressions: 1.5 }] }, { rows: [{ ...valid, position: NaN }] }, { rows: [{ ...valid, position: 0 }] }, { rows: [{ ...valid, ctr: 2 }] }, { rows: [valid, valid] }, { rows: [valid], dimensions: ['page', 'query', 'country', 'device'] }]) {
    assert.throws(() => validateSearchData(bad));
  }
  assert.equal(validateSearchData({ rows: [valid] }).rows.length, 1);
  for (const metadata of [[], { startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-10-02', endDate: '2026-10-01' }, { possiblyTruncatedDays: '2026-10-01' }, { notes: [null] }, { dimensions: ['page', 'query', 'country', 'device'] }]) assert.throws(() => validateSearchData({ rows: [valid], dimensions: ['query', 'page', 'country', 'device'], metadata }));
});

test('CSV escapes quoted values and formula-looking queries without changing report matching', () => {
  const csv = reportCsv([{ query: '=HYPERLINK("x")', target: '/a,b', value: null }]);
  assert.match(csv, /'=/);
  assert.match(csv, /"\/a,b"/);
  assert.match(csv, /unknown/);
});

test('default period is 28 completed Pacific calendar days, including DST boundaries', () => {
  assert.deepEqual(defaultPeriod(new Date('2026-10-10T03:00:00Z')), { startDate: '2026-09-11', endDate: '2026-10-08' });
  assert.deepEqual(defaultPeriod(new Date('2026-03-10T00:00:00Z')), { startDate: '2026-02-09', endDate: '2026-03-08' });
});

test('importer paginates each day, aggregates repeated daily keys by impression weight and never saves token', async () => {
  const calls = [];
  const replies = [ { rows: [row('pumpfun api', 'https://blixvip.com/api', 10, 2, 1)] }, { rows: [] }, { rows: [row('pumpfun api', 'https://blixvip.com/api', 30, 10, 3)] }, { rows: [] } ];
  const result = await importSearchConsole({ token: 'secret-token', startDate: '2026-10-01', endDate: '2026-10-02', rowLimit: 1, fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response(JSON.stringify(replies.shift())); } });
  assert.deepEqual(calls.map(call => [call.body.startDate, call.body.startRow]), [['2026-10-01', 0], ['2026-10-01', 1], ['2026-10-02', 0], ['2026-10-02', 1]]);
  assert.ok(calls.every(call => call.auth === 'Bearer secret-token' && call.body.dataState === 'final' && call.body.type === 'web'));
  assert.match(calls[0].url, /sc-domain%3Ablixvip\.com/);
  assert.equal(result.rows[0].impressions, 40);
  assert.equal(result.rows[0].position, 8);
  assert.equal(result.rows[0].ctr, 0.1);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('importer records capped and empty days, rejects repeated page rows', async () => {
  const result = await importSearchConsole({ token: 'token', startDate: '2026-10-01', endDate: '2026-10-01', rowLimit: 1, maxRowsPerDay: 1, fetchImpl: async () => new Response(JSON.stringify({ rows: [row('q', 'https://blixvip.com/', 1, 2)] })) });
  assert.deepEqual(result.metadata.possiblyTruncatedDays, ['2026-10-01']);
  assert.match(result.metadata.notes.join(' '), /not.*all/i);
  const empty = await importSearchConsole({ token: 'token', startDate: '2026-10-01', endDate: '2026-10-01', fetchImpl: async () => new Response('{}') });
  assert.deepEqual(empty.metadata.daysWithoutReturnedRows, ['2026-10-01']);
  await assert.rejects(importSearchConsole({ token: 'token', startDate: '2026-10-01', endDate: '2026-10-01', rowLimit: 1, fetchImpl: async () => new Response(JSON.stringify({ rows: [row('q', 'https://blixvip.com/', 1, 2)] })) }), /duplicate/i);
});

test('importer rejects missing credentials, bad dates/ranges, preserves private errors and retries bounded transient failures', async () => {
  await assert.rejects(importSearchConsole({ token: '' }), /GSC_ACCESS_TOKEN/);
  for (const [startDate, endDate] of [['2026-02-30', '2026-03-01'], ['2026-10-02', '2026-10-01'], ['2026-01-01', '2026-12-31']]) await assert.rejects(importSearchConsole({ token: 'token', startDate, endDate }), /date|range|31/i);
  await assert.rejects(importSearchConsole({ token: 'secret-token', startDate: '2026-10-01', endDate: '2026-10-01', fetchImpl: async () => { throw new Error('secret-token'); } }), error => !error.message.includes('secret-token'));
  let calls = 0;
  const sleeps = [];
  await importSearchConsole({ token: 'token', startDate: '2026-10-01', endDate: '2026-10-01', sleep: async ms => sleeps.push(ms), fetchImpl: async () => { calls++; return calls < 3 ? new Response('private upstream error', { status: 429 }) : new Response('{}'); } });
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every(ms => ms <= 10000));
});
