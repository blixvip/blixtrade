import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "@shared": path.resolve(import.meta.dirname, "../public") } },
  // 127.0.0.1 only: the proxy presents itself to the radar as a local page, so this port must never be reachable from outside.
  server: { host: "127.0.0.1", port: 4421, strictPort: true, proxy: { "/api/account": toAccounts, "/api": toRadar, "/img": toRadar }, fs: { allow: [".."] } },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
