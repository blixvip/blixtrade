// Isolate this reviewed content release from concurrently edited keyword drafts.
// Never edits or removes another session's files. Review the manifest before deploying.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const includeLiveExpansion = process.argv.includes('--include-live-expansion');
const destination = path.join(root, 'data', `seo-release-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const excluded = includeLiveExpansion ? /(?:^|[\\/])(?:\.wrangler|node_modules)(?:[\\/]|$)/ : /(?:^|[\\/])(?:\.wrangler|node_modules|pagekit\.js|pages-(?:pump|ai|trade|dev|compete|create|guides)\.js|blix-mcp\.mjs)(?:[\\/]|$)/;
await mkdir(destination, { recursive: true });
for (const directory of ['worker', 'public', 'test', 'scripts', 'docs/seo']) {
  await cp(path.join(root, directory), path.join(destination, directory), { recursive: true, filter: source => !excluded.test(source) });
}
await writeFile(path.join(destination, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const pagesPath = path.join(destination, 'worker/site/pages.js');
let pages = await readFile(pagesPath, 'utf8');
if (!includeLiveExpansion) {
if (pages.includes('[...entries, ...KEYWORD_PAGES]')) throw new Error('Topic navigation now includes the published expansion. Use --include-live-expansion to preserve the live site.');
const integrations = [...pages.matchAll(/^import \{ \w+_PAGES \} from "\.\/pages-(?:pump|ai|trade|dev|compete|create|guides)\.js";\r?\n/gm)];
if (integrations.length !== 0 && integrations.length !== 7) throw new Error('Concurrent draft integration changed; review before snapshotting.');
pages = pages.replace(/^import \{ \w+_PAGES \} from "\.\/pages-(?:pump|ai|trade|dev|compete|create|guides)\.js";\r?\n/gm, '')
  .replace(/^const KEYWORD_PAGES = .*;\r?\n/gm, '')
  .replace('[...entries, guides, ...KEYWORD_PAGES]', '[...entries, guides]')
  .replace(/\/\/ The keyword pages[^\n]*\r?\n\/\/ built on pagekit[^\n]*\r?\n/, '');
if (/KEYWORD_PAGES|from "\.\/pages-/.test(pages)) throw new Error('Unreviewed draft dependency remains.');
await writeFile(pagesPath, pages);
// Do not activate the other session's account-credential display route in this content release.
const indexPath = path.join(destination, 'worker/index.js');
let index = await readFile(indexPath, 'utf8');
index = index.replace('import { SCRIPT, layout, code, esc }', 'import { SCRIPT }')
  .replace(/    \/\/ \/developers for someone signed in:[\s\S]*?    const page = await site/, '    const page = await site')
  .replace(/\/\/ \/developers for a signed-in member:[\s\S]*?\nasync function site\(/, 'async function site(');
if (/developerAccess|your-session/.test(index)) throw new Error('Unreviewed developer route remains.');
await writeFile(indexPath, index);
}
const reviewed = ['worker/index.js', 'worker/site/pages.js', 'worker/site/html.js', 'worker/site/seo.js', 'worker/site/editorial.js', 'worker/site/competitor-guides.js', 'worker/site/learning.js', 'worker/site/clusters.js'];
const hashes = Object.fromEntries(await Promise.all(reviewed.map(async file => [file, createHash('sha256').update(await readFile(path.join(destination, file))).digest('hex')])));
await writeFile(path.join(destination, 'release-manifest.json'), JSON.stringify({ created: new Date().toISOString(), source: root, excluded: includeLiveExpansion ? 'Only dependencies and Wrangler temporary state. Retains the parallel release already published to the live site.' : 'Concurrent pages-*.js, pagekit.js, MCP connector and account-session display route. Original files preserved.', hashes }, null, 2));
console.log(destination);
