// Writes Brotli (best level) and gzip copies next to each built script and stylesheet in web/dist/assets
// (x-<hash>.js -> x-<hash>.js.br, .gz), for the page server to send as they are (server/webapp.js compressed()).
// Without them the first reader of each file after a deploy waited while the server compressed it.
// Run after `vite build` (web/package.json does); files that already have both copies are skipped.
//   node scripts/precompress.mjs [dir=web/dist/assets]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const br = promisify(zlib.brotliCompress), gz = promisify(zlib.gzip);
const dir = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist", "assets"));
let made = 0, bytes = 0, zbytes = 0;
// Only the files the current page uses (index.html names its entry files, those name the rest), not every older
// build's chunks still kept for open tabs.
const all = fs.readdirSync(dir).filter((f) => /\.(js|css)$/.test(f));
const used = new Set(all.filter((f) => fs.readFileSync(path.join(dir, "..", "index.html"), "utf8").includes(f))), walk = [...used];
while (walk.length) { const text = fs.readFileSync(path.join(dir, walk.pop()), "utf8"); for (const f of all) if (!used.has(f) && text.includes(f)) { used.add(f); walk.push(f); } }
const todo = [...used].filter((f) => !(fs.existsSync(path.join(dir, f + ".br")) && fs.existsSync(path.join(dir, f + ".gz"))));
await Promise.all(todo.map(async (f) => {
  const full = path.join(dir, f), body = fs.readFileSync(full);
  const [b, g] = await Promise.all([
    br(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
    gz(body, { level: 9 }),
  ]);
  fs.writeFileSync(full + ".br", b);
  fs.writeFileSync(full + ".gz", g);
  made++; bytes += body.length; zbytes += b.length;
}));
console.log(`precompress: ${made} files, ${(bytes / 1024).toFixed(0)} KB -> ${(zbytes / 1024).toFixed(0)} KB brotli`);
