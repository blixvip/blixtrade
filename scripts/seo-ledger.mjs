// Rebuild: node scripts/seo-ledger.mjs
// Verify without writing: node scripts/seo-ledger.mjs --check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(ROOT, 'docs/seo/keywords-source.txt');
const OUTPUT = resolve(ROOT, 'docs/seo/keyword-ledger.csv');
// A transcription integrity guard, not a statement of search demand.
const SOURCE_SHA256 = '960f8375170c449d4a57cf881d68e6a698956bd007069e91d674d6a337b0c632';
const EXPECTED_OCCURRENCES = 1275;
const HEADINGS = new Set([
  'Core brand / tool keywords', 'Axiom keywords', 'Pump.fun keywords', 'Nio.trade keywords',
  'Solana terminal keywords', 'AI meme coin creation', 'AI meme coin maker', 'AI Pump.fun creator',
  'AI branding for meme coins', 'Meme coin discovery', 'Meme coin analysis', 'Meme coin signals',
  'AI trading', 'AI coin picks', 'Grok / AI model coin-picking pages', 'MCP keywords', 'APIs',
  'CLI keywords', 'SDK keywords', 'Scanner keywords', 'Wallet tracking', 'Social / sentiment AI',
  'Token launch tools', 'Creator / marketing tools', 'SEO / comparison terms',
  'Alternative / competitor keywords', 'Vs pages', 'Question-style keywords', 'Long-tail keywords',
  'Developer-intent keywords', 'Transaction / execution keywords', 'Portfolio / PnL',
  'Risk / safety', 'Ultra-short high-value head terms',
]);
const EXISTING = new Set(['/', '/api', '/mcp', '/pump-fun-api', '/gmgn-api', '/axiom-api',
  '/fomo-api', '/pump-fun-tracker', '/solana-memecoin-screener', '/memecoin-paper-trading']);
const EVIDENCE = {
  api: 'docs/API.md; server/server.js',
  mcp: 'mcp/blix-mcp.mjs',
  creator: 'server/accounts.js: launchCoin; web/src/pages/Launch.tsx',
  ai: 'server/brain.js; server/ai.js; server/grok.js; server/fast.js',
  picks: 'server/desk.js; web/src/pages/AiPicks.tsx',
  risk: 'server/holders.js; server/snipe.js; server/bubblemap.js; server/sources.js',
  wallet: 'server/wallets.js; web/src/pages/Traders.tsx',
  pnl: 'web/src/components/PnlCard.tsx; web/src/pages/Practice.tsx',
  social: 'server/grok.js; server/brain.js',
  scanner: 'server/engine.js; server/pulse.js; server/coin.js',
  comparison: 'worker/site/comparisons.js; independently sourced comparison required',
};

export function parseSource(source) {
  let group = '';
  const rows = [];
  for (const [index, line] of source.replace(/\r\n/g, '\n').split('\n').entries()) {
    if (HEADINGS.has(line)) group = line;
    if (!line.startsWith('- ')) continue;
    const original = line.slice(2);
    const pasteError = original === 'ai tradCore brand / tool keywords';
    let normalized = original.toLowerCase().replace(/\s+/g, ' ').trim();
    let note = '';
    if (pasteError) {
      normalized = '';
      note = 'Truncated ai trad fragment joined to repeated section heading; retained as paste artifact, not a target keyword.';
    }
    if (original.startsWith('trading mcpSiDO ')) {
      normalized = 'trading mcp';
      note = 'Trailing user instruction removed from normalized keyword; original occurrence preserved.';
    }
    rows.push({ occurrence: rows.length + 1, line: index + 1, group, original, normalized, note, pasteError });
    if (pasteError) group = 'Core brand / tool keywords';
  }
  return rows;
}

function assignment(cluster, page, evidence, priority = 'P2', roadmap = '', notes = '') {
  return { cluster, page, evidence, priority, roadmap, notes };
}

function baseClassification(k) {
  if (!k) return assignment('paste-artifact', '', '', 'excluded', 'paste-artifact');
  const isPump = /pump[. ]?fun/.test(k);
  const isCompetitor = /\b(?:fomo|axiom|nio(?:\.trade| trade)?|photon|bullx|gmgn|dex ?screener|birdeye|jupiter terminal)\b/.test(k);
  const competitor = /\bfomo\b/.test(k) ? 'fomo' : /\baxiom\b/.test(k) ? 'axiom' : /\bnio\b/.test(k) ? 'nio-trade' : '';
  const comparison = competitor ? `/compare/${competitor}-alternative` : '/compare';
  const integration = competitor === 'fomo' ? '/fomo-api' : competitor === 'axiom' ? '/axiom-api' : /\bgmgn\b/.test(k) ? '/gmgn-api' : '';

  // Explicit interface promises take precedence over general token/creator matches.
  if (/\bcli\b/.test(k)) return assignment('cli', '', EVIDENCE.api, 'P3', 'cli-package', 'No standalone BLIX trading CLI distribution verified; Node entrypoints and third-party CLIs are not a BLIX CLI.');
  if (/\bsdk\b/.test(k)) return assignment('sdk', '', EVIDENCE.api, 'P3', 'sdk-package', 'No published BLIX SDK verified; HTTP examples are not an SDK package.');
  if (/\bwebsocket\b/.test(k)) return assignment('realtime-websocket', '/pumpfun-realtime-api', EVIDENCE.api, 'P2', 'public-websocket', 'Current public developer transport is SSE. Page explains the distinction; it does not provide a BLIX WebSocket endpoint.');
  if (/\b(?:logo|branding|name generator|ticker generator|image generator|mascot|slogan|website generator|landing page generator)\b/.test(k)) {
    return assignment('creator-branding', '/create-memecoin', EVIDENCE.creator, 'P3', 'branding-generators', 'Existing launcher accepts supplied name, ticker, image and description; dedicated generators are unverified.');
  }
  if (/\b(?:marketing|content generator|tweet generator|twitter generator|x post generator|social post generator|social media generator|meme generator|ad generator|copy generator|copywriting|description generator|bio generator)\b/.test(k)) {
    return assignment('creator-marketing', '/create-memecoin', EVIDENCE.creator, 'P3', 'marketing-generators', 'Supporting launch guide only; no advertised marketing/content generator until working capability is verified.');
  }
  if (/\bvs\b/.test(k)) return assignment('competitor-versus', '/compare', EVIDENCE.comparison, 'P3', 'comparison-research', 'Pairwise guide requires dated primary-source comparison and original evaluation; a hub is not full coverage.');
  if (/\balternatives?\b/.test(k)) {
    return assignment('competitor-alternatives', comparison, EVIDENCE.comparison, 'P2', competitor ? '' : 'comparison-research', 'Independent BLIX comparison; no official affiliation. Unimplemented competitor detail remains research backlog.');
  }
  if (isCompetitor) {
    if (/\b(?:api|mcp|docs|developer|integration)\b/.test(k) && integration) {
      return assignment(`${competitor || 'gmgn'}-integration`, integration, EVIDENCE.api, 'P1', '', 'BLIX integration/reference context; never represent this as the competitor\'s official API or MCP server.');
    }
    return assignment('competitor-navigation', comparison, EVIDENCE.comparison, 'P3', 'competitor-intent', 'Search may seek another company or unrelated meaning. Supporting comparison cannot fulfill official app/download/SEO intent.');
  }
  if (/\b(?:deepseek|qwen|chatgpt)\b/.test(k) && !/connect|mcp/.test(k)) {
    return assignment('unverified-model', '/ai-memecoin-picks', EVIDENCE.ai, 'P3', 'model-evidence', 'Provider-specific integration, dated examples and comparable results must be verified before a dedicated model page.');
  }
  if (/\b(?:grok|claude|gemini|kimi)\b/.test(k) || /ai (?:crypto )?model|best ai for/.test(k)) {
    return assignment('model-picks', '/ai-memecoin-picks', EVIDENCE.ai, 'P2', 'model-evidence', 'Existing model code is evidence of integration, not evidence of trading performance or a provider-specific search page.');
  }
  if (/\bmcp\b/.test(k) || /how to connect (?:solana|pumpfun) to (?:chatgpt|ai)/.test(k)) {
    return assignment('mcp', '/mcp', EVIDENCE.mcp, 'P1', /^best /.test(k) ? 'comparison-research' : '');
  }
  if (/\b(?:api|realtime)\b/.test(k)) {
    const page = /realtime/.test(k) ? '/pumpfun-realtime-api' : isPump ? '/pump-fun-api' : '/api';
    return assignment(isPump ? 'pumpfun-api' : 'developer-api', page, EVIDENCE.api, 'P1', /^best /.test(k) ? 'comparison-research' : '', 'BLIX API context; hosted account execution and local analytics have different authorization.');
  }
  if (/\b(?:signals?|alerts?)\b/.test(k)) return assignment('signals-alerts', '/memecoin-alerts', EVIDENCE.scanner, 'P1');
  if (/\b(?:creator|creation|maker|generator|generate|launcher|launch|create|make)\b/.test(k) && !/wallet/.test(k)) {
    const needsAI = /\b(?:ai|automatic|automated|automatically|one click|instant)\b/.test(k);
    return assignment('coin-creation', '/create-memecoin', EVIDENCE.creator, needsAI ? 'P3' : 'P1', needsAI ? 'ai-creator' : /^best /.test(k) ? 'comparison-research' : '', needsAI ? 'Manual metadata and transaction submission exist; AI generation, unattended launch and speed guarantees are unverified.' : 'Existing launch flow requires supplied metadata, authentication and funded transaction; no-code UI does not mean free on-chain execution.');
  }
  if (/\b(?:rug|risk|safety|scam|honeypot|contract checker|distribution|holder analysis|insider|bundled|sniper|dev wallet|developer wallet|creator wallet)\b/.test(k)) {
    const unsupported = /honeypot|contract checker|sniper github/.test(k);
    return assignment('token-risk', '/memecoin-risk-scanner', EVIDENCE.risk, 'P1', unsupported ? 'risk-validation' : '', 'Risk indicators are incomplete and cannot guarantee token safety; wallet tags require adequate observed data.');
  }
  if (/\b(?:pnl|portfolio|trading history|trade history)\b/.test(k)) return assignment('portfolio-pnl', '/solana-pnl-tracker', EVIDENCE.pnl, 'P1');
  if (/\b(?:wallet|wallets|whale|smart money|holder tracker)\b/.test(k) && !/alert/.test(k)) return assignment('wallet-tracking', '/solana-wallet-tracker', EVIDENCE.wallet, 'P1');
  if (/\b(?:sentiment|social|twitter|viral|trend ai|trend detection|trend tracker)\b/.test(k) || /^x /.test(k)) return assignment('social-sentiment', '/memecoin-social-sentiment', EVIDENCE.social, 'P2');
  if (/\b(?:picks?|recommendations?|selector|gem finder)\b/.test(k) || /ai that picks/.test(k)) return assignment('ai-picks', '/ai-memecoin-picks', EVIDENCE.picks, 'P1', /today/.test(k) ? 'dated-picks-evidence' : '', 'Public explainer; current picks are app data. Today-specific searches need a dated public snapshot before claiming complete coverage.');
  if (/how to (?:find|scan)/.test(k) || /\bearly\b/.test(k)) return assignment('discovery-guide', '/how-to-find-meme-coins-early', EVIDENCE.scanner, 'P1');
  if (/how to build/.test(k)) return assignment('developer-bot-guide', '/api', EVIDENCE.api, 'P2', 'bot-tutorial', 'Reference material exists; a runnable end-to-end bot tutorial must be built and safely validated separately.');
  if (/\b(?:trading|trade|bot|agent|assistant|autonomous|swap|execution|buy bot|sell bot)\b/.test(k) && !/platform|terminal|app|dashboard|tools|comparison/.test(k)) {
    const execution = /swap|execution/.test(k);
    return assignment(execution ? 'trading-execution' : 'ai-trading', execution ? '/solana-trading-terminal' : '/ai-memecoin-trading', EVIDENCE.ai, 'P1', /autonomous|automated/.test(k) ? 'automation-evidence' : '', 'Explain live execution, AI analysis and paper trading separately. Do not imply profitable or unattended execution.');
  }
  if (/\b(?:terminal|platform|app|tools|comparison)\b/.test(k)) return assignment('solana-terminal', /comparison/.test(k) ? '/compare' : '/solana-trading-terminal', EVIDENCE.scanner, 'P1', /^best /.test(k) ? 'comparison-research' : '');
  if (/\b(?:scanner|screener|finder|discovery|analytics|analyzer|analysis|analyze|dashboard|tracker|trending|new|momentum|volume|liquidity)\b/.test(k) || /ai that (?:finds|analyzes)/.test(k)) {
    return assignment(isPump ? 'pumpfun-discovery' : 'token-discovery-analysis', isPump ? '/pump-fun-tracker' : '/solana-memecoin-screener', EVIDENCE.scanner, 'P1');
  }
  if (isPump) return assignment('pumpfun-overview', '/pump-fun-tracker', EVIDENCE.scanner, 'P2', /^(?:pumpfun|pump fun|pump\.fun)$/.test(k) ? 'broad-intent' : '', 'BLIX tracking/analysis context; pump.fun is an independent platform.');
  if (/^best .*coins$/.test(k)) return assignment('coin-discovery-ranking', '/solana-memecoin-screener', EVIDENCE.scanner, 'P2', 'dated-picks-evidence');
  if (/\b(?:github|open source)\b/.test(k)) return assignment('open-source', '/api', EVIDENCE.api, 'P2');
  if (/^best (?:meme coin|memecoin) ai$/.test(k)) return assignment('ai-comparison', '/compare', EVIDENCE.ai, 'P2', 'comparison-research');
  if (/^(?:memecoin|meme coin|solana|crypto ai|trading ai)$/.test(k)) return assignment('broad-head-term', '/', EVIDENCE.scanner, 'P3', 'broad-intent', 'Broad and often non-product search intent; requires country-specific SERP research and authority-building.');
  return assignment('unresolved-intent', '/guides', '', 'P3', 'intent-research', 'Preserved for manual intent review; no invented matching capability.');
}

export function classifyKeyword(keyword) {
  const result = baseClassification(keyword);
  if (result.roadmap === 'ai-creator') {
    result.page = '/ai-meme-coin-maker';
    result.notes = 'Published supporting guide explains the AI creation boundary. A working AI generation/unattended launch workflow still needs verification; the page is not evidence of that product.';
  }
  // One useful canonical resource per intent. Variants stay in the inventory,
  // rather than becoming duplicate articles or unsupported product promises.
  const alternatives = [
    [/^bullx(?: neo)? alternatives?$/, '/compare/bullx-alternative'],
    [/^gmgn alternatives?$/, '/compare/gmgn-alternative'],
    [/^(?:dex screener|dexscreener) alternatives?$/, '/compare/dexscreener-alternative'],
    [/^birdeye alternatives?$/, '/compare/birdeye-alternative'],
    [/^jupiter terminal alternatives?$/, '/compare/jupiter-terminal-alternative'],
  ];
  const alternative = alternatives.find(([pattern]) => pattern.test(keyword));
  if (alternative) Object.assign(result, { page: alternative[1], roadmap: '', evidence: 'worker/site/competitor-guides.js; docs/seo/search-research-2026-10-10.md', notes: 'Dated independent comparison with primary sources and a task-specific evaluation; no universal superiority or measured execution advantage claimed.' });
  if (/^(?:(?:axiom|fomo|bullx|photon|gmgn) vs (?:axiom|fomo|bullx|photon|gmgn)|best (?:solana terminal|meme coin trading platform) comparison)$/.test(keyword)) {
    Object.assign(result, { page: '/compare/solana-terminal-comparison', roadmap: '', evidence: 'worker/site/competitor-guides.js; docs/seo/search-research-2026-10-10.md', notes: 'Pairwise questions share a sourced decision matrix. Unknown Photon capabilities and missing execution benchmarks remain explicit.' });
  }
  const learning = new Map([
    ['how to analyze meme coins', '/guides/how-to-analyze-meme-coins'],
    ['how to analyze pumpfun coins', '/guides/how-to-analyze-meme-coins'],
    ['how to find smart money wallets', '/guides/how-to-find-smart-money-wallets'],
    ['token holder analysis', '/guides/token-holder-distribution'],
    ['token distribution analysis', '/guides/token-holder-distribution'],
    ['ai crypto model comparison', '/guides/compare-ai-crypto-research'],
  ]);
  if (learning.has(keyword)) {
    result.page = learning.get(keyword);
    result.evidence = 'worker/site/learning.js; docs/seo/content-expansion-2026-10-10.md';
    result.notes = 'Concrete research workflow with primary sources and illustrative examples. Model comparison is a method, not a tested winner or provider-specific performance claim.';
    // A model benchmark is still missing; publishing a method does not supply one.
  }
  if (/^best /.test(keyword) && !result.roadmap) {
    result.roadmap = /\b(?:picks|coins)\b/.test(keyword) ? 'dated-picks-evidence' : 'comparison-research';
    result.priority = 'P2';
    result.notes = [result.notes, 'A feature explainer alone does not substantiate a best-in-category claim; comparative evidence remains pending.'].filter(Boolean).join(' ');
  }
  return result;
}

function intent(k, classification) {
  if (!k) return 'paste-artifact';
  if (/\b(?:api|sdk|cli|mcp|github|docs|documentation|websocket|integration)\b/.test(k)) return 'developer';
  if (/\b(?:alternative|alternatives|vs|best|comparison)\b/.test(k)) return 'commercial-research';
  if (/^(?:how to|create |make |launch )/.test(k) || /tutorial|setup/.test(k)) return 'instructional';
  if (classification.cluster === 'competitor-navigation') return 'navigational-or-ambiguous';
  if (classification.roadmap === 'broad-intent') return 'broad-or-ambiguous';
  return 'product-or-tool';
}

export function buildLedger(source) {
  const parsed = parseSource(source);
  const first = new Map();
  const counts = new Map();
  for (const row of parsed) if (row.normalized) counts.set(row.normalized, (counts.get(row.normalized) || 0) + 1);
  return parsed.map(row => {
    const assigned = classifyKeyword(row.normalized);
    const id = `KW-${String(row.occurrence).padStart(4, '0')}`;
    const duplicate = row.normalized ? first.get(row.normalized) || '' : '';
    if (row.normalized && !duplicate) first.set(row.normalized, id);
    const status = row.pasteError ? 'excluded-paste-artifact' : assigned.roadmap ? 'roadmap; supporting page only where assigned' : EXISTING.has(assigned.page) ? 'existing page; deployment unverified' : 'new page; deployment unverified';
    return {
      occurrence_id: id,
      source_line: row.line,
      source_group: row.group,
      original_keyword: row.original,
      normalized_keyword: row.normalized,
      duplicate_of: duplicate,
      occurrence_count: counts.get(row.normalized) || 0,
      intent: intent(row.normalized, assigned),
      cluster: assigned.cluster,
      assigned_page: assigned.page,
      roadmap_id: assigned.roadmap,
      publication_status: status,
      priority: assigned.priority,
      ranking_prospect: 'unassessed; no ranking guarantee',
      current_position: 'unknown',
      monthly_search_volume: 'unknown',
      competitor_urls: 'unknown; target-country SERP research pending',
      search_evidence: 'Not measured; Search Console and localized SERP baseline pending',
      product_evidence: assigned.evidence || 'none verified',
      notes: [row.note, assigned.notes].filter(Boolean).join(' '),
    };
  });
}

export function toCsv(rows) {
  const columns = Object.keys(rows[0]);
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(quote).join(','), ...rows.map(row => columns.map(key => quote(row[key])).join(','))].join('\n') + '\n';
}

export function validateLedger(source, rows) {
  assert.equal(createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex'), SOURCE_SHA256, 'Source transcription changed; review coverage before updating the fingerprint.');
  assert.equal(rows.length, EXPECTED_OCCURRENCES, 'Every original bullet occurrence must remain accounted for.');
  assert.equal(rows.filter(row => row.cluster === 'paste-artifact').length, 1);
  assert.equal(rows.filter(row => row.normalized_keyword === 'fomo').length, 2, 'Repeated source block must remain visible.');
  assert.equal(rows.at(-1).normalized_keyword, 'trading mcp', 'Final pasted instruction is not part of the search phrase.');
  const byId = new Map(rows.map(row => [row.occurrence_id, row]));
  for (const row of rows) {
    assert.ok(row.assigned_page || row.roadmap_id, `Unassigned occurrence: ${row.occurrence_id}`);
    assert.ok(row.product_evidence && row.intent && row.cluster);
    if (row.duplicate_of) {
      const original = byId.get(row.duplicate_of);
      assert.equal(row.normalized_keyword, original.normalized_keyword);
      assert.equal(row.assigned_page, original.assigned_page, 'Duplicate phrases must share a target.');
      assert.equal(row.roadmap_id, original.roadmap_id);
    }
  }
  // Concrete regressions: unsupported products must not become existing features.
  for (const keyword of ['pumpfun cli', 'fomo cli', 'solana terminal cli']) assert.equal(classifyKeyword(keyword).roadmap, 'cli-package');
  assert.equal(classifyKeyword('pumpfun sdk').roadmap, 'sdk-package');
  assert.equal(classifyKeyword('pumpfun websocket api').roadmap, 'public-websocket');
  assert.equal(classifyKeyword('ai meme coin maker').roadmap, 'ai-creator');
  assert.equal(classifyKeyword('meme coin logo generator').roadmap, 'branding-generators');
  assert.equal(classifyKeyword('ai crypto ticker generator').roadmap, 'branding-generators');
  assert.equal(classifyKeyword('meme coin tweet generator').roadmap, 'marketing-generators');
  assert.equal(classifyKeyword('axiom download').roadmap, 'competitor-intent');
  assert.equal(classifyKeyword('axiom vs fomo').page, '/compare/solana-terminal-comparison');
  assert.equal(classifyKeyword('axiom vs fomo').roadmap, '');
  assert.equal(classifyKeyword('fomo vs axiom').page, classifyKeyword('axiom vs fomo').page);
  assert.equal(classifyKeyword('bullx neo alternative').page, '/compare/bullx-alternative');
  assert.equal(classifyKeyword('how to analyze pumpfun coins').page, '/guides/how-to-analyze-meme-coins');
  assert.equal(classifyKeyword('fomo alternative').page, '/compare/fomo-alternative');
  assert.equal(classifyKeyword('solana wallet tracker').page, '/solana-wallet-tracker');
  assert.equal(classifyKeyword('wallet pnl tracker').page, '/solana-pnl-tracker');
  assert.equal(classifyKeyword('crypto mcp').page, '/mcp');
  assert.equal(classifyKeyword('pumpfun api').page, '/pump-fun-api');
  assert.equal(classifyKeyword('how to create a meme coin').page, '/create-memecoin');
  assert.equal(classifyKeyword('generate meme coin with ai').roadmap, 'ai-creator');
  assert.equal(classifyKeyword('solana token creation tool').page, '/create-memecoin');
  assert.equal(classifyKeyword('pumpfun launch alerts').page, '/memecoin-alerts');
  assert.equal(classifyKeyword('token creator wallet tracker').page, '/memecoin-risk-scanner');
  assert.equal(classifyKeyword('how to build a pumpfun bot').roadmap, 'bot-tutorial');
  assert.equal(classifyKeyword('best pumpfun scanner').roadmap, 'comparison-research');
  assert.equal(classifyKeyword('best meme coin picks').roadmap, 'dated-picks-evidence');
  return { occurrences: rows.length, keywords: rows.filter(row => row.normalized_keyword).length,
    uniqueKeywords: new Set(rows.map(row => row.normalized_keyword).filter(Boolean)).size,
    duplicateOccurrences: rows.filter(row => row.duplicate_of).length,
    roadmapOccurrences: rows.filter(row => row.roadmap_id && row.roadmap_id !== 'paste-artifact').length,
    mappedPages: new Set(rows.map(row => row.assigned_page).filter(Boolean)).size };
}

async function main() {
  const source = await readFile(SOURCE, 'utf8');
  const rows = buildLedger(source);
  const summary = validateLedger(source, rows);
  const csv = toCsv(rows);
  if (process.argv.includes('--check')) {
    assert.equal((await readFile(OUTPUT, 'utf8')).replace(/\r\n/g, '\n'), csv, 'Ledger is stale; run node scripts/seo-ledger.mjs');
    const { PAGES } = await import('../worker/site/pages.js');
    const missing = [...new Set(rows.map(row => row.assigned_page).filter(path => path && path !== '/' && !PAGES[path]))];
    assert.deepEqual(missing, [], 'Assigned public pages must exist in the page registry.');
    const roadmap = await readFile(resolve(ROOT, 'docs/seo/roadmap.md'), 'utf8');
    for (const id of new Set(rows.map(row => row.roadmap_id).filter(Boolean))) {
      assert.ok(roadmap.includes(`id="${id}"`), `Roadmap entry missing: ${id}`);
    }
    console.log('SEO ledger verified:', JSON.stringify(summary));
  } else {
    await writeFile(OUTPUT, csv);
    console.log('SEO ledger generated:', JSON.stringify(summary));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
