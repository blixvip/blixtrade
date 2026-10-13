// Maps every supplied keyword to a topic and canonical content brief.
// Public navigation lists live resources only; planned destinations stay here.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from './seo-ledger.mjs';
import { TOPIC_CLUSTERS, PAGE_TOPIC } from '../worker/site/clusters.js';

const root = resolve(import.meta.dirname, '..');
export function buildClusterPlan(source) {
  const unique = buildLedger(source).filter(row => row.normalized_keyword && !row.duplicate_of);
  return unique.map(row => {
    const keyword = row.normalized_keyword;
    const roadmap = row.roadmap_id;
    let planned = '';
    if (roadmap === 'ai-creator') planned = '/ai-meme-coin-maker';
    if (roadmap === 'branding-generators') {
      planned = /name|ticker/.test(keyword) ? '/meme-coin-name-generator'
        : /website|landing page/.test(keyword) ? '/meme-coin-website-generator'
        : /logo|image|mascot/.test(keyword) ? '/meme-coin-logo-generator' : '/meme-coin-branding';
    }
    if (roadmap === 'marketing-generators') planned = '/meme-coin-marketing-tools';
    if (roadmap === 'cli-package') planned = '/crypto-trading-cli';
    if (roadmap === 'sdk-package') planned = '/solana-trading-sdk';
    if (roadmap === 'bot-tutorial') planned = '/guides/build-solana-trading-bot';
    const topic = PAGE_TOPIC.get(row.assigned_page)?.id
      || (/cli|sdk/.test(row.cluster) ? 'developers' : 'discovery');
    return {
      keyword, topic,
      current_canonical: row.assigned_page || '',
      planned_canonical: planned,
      coverage: roadmap ? 'supporting content or planned; dependency remains' : 'existing targeted content; rankings unmeasured',
      dependency: roadmap,
      publication_gate: planned ? 'Publish after a working feature or distinct tested tutorial supports this intent.'
        : roadmap ? 'Meet the linked roadmap acceptance criteria; a related page alone is not complete coverage.'
        : 'Improve this canonical page from search performance and user needs; synonyms do not need new URLs.',
      notes: row.notes,
    };
  });
}

const csv = rows => [Object.keys(rows[0]), ...rows.map(Object.values)].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
async function main() {
  const rows = buildClusterPlan(await readFile(resolve(root, 'docs/seo/keywords-source.txt'), 'utf8'));
  if (rows.length !== 850 || new Set(rows.map(row => row.keyword)).size !== 850) throw Error('Keyword cluster coverage must preserve all 850 unique terms.');
  const summary = TOPIC_CLUSTERS.map(topic => `| ${topic.title} | ${rows.filter(row => row.topic === topic.id).length} | ${topic.pages.map(page => '`' + page + '`').join(', ')} |`).join('\n');
  const document = `# Keyword cluster architecture\n\nAll **850 unique supplied keywords** have one row in \`keyword-clusters.csv\`. Synonyms share a canonical resource. A topic can contain several distinct research, product or developer intents; it is not one enormous keyword page. Existing canonical URLs are retained so published links and indexing signals are not split across spelling variants.\n\n## Current topic structure\n\n| Topic | Supplied keywords | Published resources |\n|---|---:|---|\n${summary}\n\nCounts are inventory counts, not search volume, completed coverage or rankings. Missing functionality and unresolved intent remain explicit in the CSV.\n\n## Requested examples\n\n| Keyword cluster | Canonical destination | Decision |\n|---|---|---|\n| AI meme coin maker, AI memecoin creator, AI Pump.fun creator | /ai-meme-coin-maker (supporting guide) | A published guide explains the AI boundary; a working AI-assisted creation feature remains unverified. /create-memecoin covers the existing launcher. |\n| Pumpfun API, pump.fun API, pump fun API | /pump-fun-api | Keep the published canonical; do not create a competing /pumpfun-api article. |\n| Solana MCP, crypto MCP, memecoin MCP | /mcp | Keep the published MCP guide. A separate client tutorial needs a materially different setup task. |\n| Axiom alternative, Axiom alternatives | /compare/axiom-alternative | One independent comparison. Reversed versus queries share the relevant comparison matrix. |\n| AI meme coin picks, AI memecoin picks | /ai-memecoin-picks | One methodology/product page. Daily pick pages require dated data and outcome evidence. |\n| Meme coin scanner, memecoin scanner, Solana token scanner | /solana-memecoin-screener | One discovery product page; analysis and early-discovery tutorials answer different tasks. |\n\n## When another page earns its own URL\n\nPublish when the page answers a distinct question or offers a distinct working tool, supplies original steps/data/examples, and remains useful before a visitor signs up. Give it one canonical, contextual sibling links and a place in its topic hub. Merge pages whose only difference is spelling, word order, competitor-name swapping or repeated sales copy. Public CTAs remain the BLIX site and Discord.\n\nPublication speed is not the release gate. Each page must meet the same evidence, usefulness and technical checks, whether the batch ships today or over several weeks. See [Google's scaled-content, doorway and keyword-stuffing policies](https://developers.google.com/search/docs/essentials/spam-policies).\n\nGenerator, CLI and SDK destinations are feature or content briefs, not proof that those products exist. Some now have supporting guides from the parallel release; a guide explaining a missing feature does not satisfy the feature dependency. Promote a working-tool claim only after the corresponding roadmap gate is met. The 850 queries can be served by fewer substantial pages; no arbitrary target number of URLs is imposed.\n\nRegenerate: \`node scripts/seo-clusters.mjs\`.\n`;
  await writeFile(resolve(root, 'docs/seo/keyword-clusters.csv'), csv(rows));
  await writeFile(resolve(root, 'docs/seo/cluster-architecture.md'), document);
  console.log(`Mapped ${rows.length} unique keywords across ${TOPIC_CLUSTERS.length} topics; ${new Set(rows.map(row => row.planned_canonical).filter(Boolean)).size} planned canonical briefs.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
