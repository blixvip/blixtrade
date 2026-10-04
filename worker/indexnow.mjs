// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver) that the public pages changed.
// Run after `wrangler deploy`: node worker/indexnow.mjs. Google does not use IndexNow; it reads
// sitemap.xml (submit it once in Search Console).
import { INDEXNOW_KEY, PUBLIC_PATHS } from "./site/seo.js";
import { ORIGIN } from "./site/html.js";

const body = { host: new URL(ORIGIN).host, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: PUBLIC_PATHS.map((p) => ORIGIN + p) };
const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
console.log(`IndexNow ${r.status} ${r.statusText} for ${body.urlList.length} URLs`, (await r.text()).slice(0, 200));
