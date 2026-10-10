import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Each page's own files, by the first word of its address (main.tsx PAGES), written into index.html so its
// first script asks for the open page's code beside the entry, instead of after the entry has run (one round
// trip, ~100-300 ms through the tunnel, saved on every first load).
const PAGE_FILES: Record<string, string[]> = {
  "": ["pages/Pulse.tsx"], coins: ["pages/Coins.tsx"], feed: ["pages/Feed.tsx"], account: ["pages/Account.tsx"], health: ["pages/More.tsx"],
  launch: ["pages/Launch.tsx"], narratives: ["pages/Narratives.tsx"],
  "ai-picks": ["pages/AiPicks.tsx"], practice: ["pages/Practice.tsx"],
  settings: ["pages/Settings.tsx"], traders: ["pages/Traders.tsx"], x: ["pages/XTracker.tsx"], u: ["pages/Profile.tsx"],
  api: ["pages/Docs.tsx"], mcp: ["pages/Docs.tsx"], coin: ["pages/Coin.tsx", "pages/coin/Chart.tsx"], trader: ["pages/Trader.tsx"],
};
function pageChunks(): Plugin {
  return {
    name: "blix-page-chunks",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const chunks = Object.values(ctx.bundle || {}).filter((c) => c.type === "chunk");
        const byModule = new Map(chunks.filter((c) => c.facadeModuleId).map((c) => [c.facadeModuleId!.replace(/\\/g, "/"), c]));
        const byFile = new Map(chunks.map((c) => [c.fileName, c]));
        const entry = new Set<string>();
        const walk = (f: string, into: Set<string>) => { if (into.has(f)) return; into.add(f); for (const i of byFile.get(f)?.imports || []) walk(i, into); };
        for (const c of chunks) if (c.isEntry) walk(c.fileName, entry);
        const map: Record<string, string[]> = {};
        for (const [route, files] of Object.entries(PAGE_FILES)) {
          const need = new Set<string>();
          for (const f of files) { const c = [...byModule].find(([id]) => id.endsWith(`/src/${f}`))?.[1]; if (c) walk(c.fileName, need); }
          map[route] = [...need].filter((f) => !entry.has(f));
        }
        return html.replace("/*BLIX_PAGE_FILES*/{}", JSON.stringify(map));
      },
    },
  };
}

// The radar (server/server.js) keeps serving the API on :4420. In development this app runs on :4421
// and proxies to it; the radar only answers its own origin, so the proxy presents itself as that origin.
const RADAR = process.env.BLIX_URL || "http://localhost:4420";
const toRadar = {
  target: RADAR,
  changeOrigin: true,
  // x-forwarded-host tells the radar which address the browser is really on (Google sign-in returns there).
  configure: (proxy: { on: (ev: string, fn: (req: { setHeader: (k: string, v: string) => void }, from: { headers: { host?: string } }) => void) => void }) =>
    proxy.on("proxyReq", (req, from) => { req.setHeader("origin", RADAR); if (from.headers.host) req.setHeader("x-forwarded-host", from.headers.host); }),
};

// Accounts (sign-in, wallets) run beside the radar on their own port: server/accounts-server.mjs.
const toAccounts = { ...toRadar, target: process.env.BLIX_ACCOUNTS_URL || "http://127.0.0.1:4422" };

export default defineConfig({
  // Absolute asset paths: the app is served at the root everywhere (this PC, blixvip.com/app, origin; old /trade/
  // links are sent to the root by the Worker). Relative ones were fetched under the address the page was opened at,
  // so /app/ or /app/x got the page itself back for every script and stylesheet.
  base: "/",
  plugins: [react(), tailwindcss(), pageChunks()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "@shared": path.resolve(import.meta.dirname, "../public") } },
  // 127.0.0.1 only: the proxy presents itself to the radar as a local page, so this port must never be reachable from outside.
  server: { host: "127.0.0.1", port: 4421, strictPort: true, proxy: { "/api/account": toAccounts, "/api": toRadar, "/img": toRadar }, fs: { allow: [".."] } },
  // emptyOutDir false: a tab opened before a rebuild still asks for the old page chunks, so they stay; the
  // radar (server/webapp.js) prunes ones older than a week that the current page no longer uses.
  // React, React DOM and zustand in a file of their own: its name only changes when they are updated, so a visitor
  // coming back after a Blix release keeps them from their cache and fetches only Blix's own (smaller) entry again.
  build: {
    outDir: "dist", emptyOutDir: false, sourcemap: false, target: "es2022",
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: "react", test: /[\/]node_modules[\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\/]/ }] } } },
  },
});
