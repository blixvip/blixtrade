// The real logos of the sites and launchpads Blix links to (public/brand/logos, the sites' own icons), and
// where each launchpad's coin page is. Social marks (X, Telegram, TikTok) are in shell/icons.tsx.
import { cn } from "@/lib/utils";

export type Site = "axiom" | "bags" | "birdeye" | "bonk" | "bubblemaps" | "dexscreener" | "fomo" | "geckoterminal" | "gmgn" | "jupiter" | "meteora" | "moonshot" | "photon" | "pumpfun" | "raydium" | "rugcheck" | "solscan";

export function SiteLogo({ site, className }: { site: Site; className?: string }) {
  return <img src={`brand/logos/${site}.png`} alt="" aria-hidden loading="lazy" decoding="async" className={cn("size-3.5 shrink-0 rounded-[3px] object-contain", className)} />;
}

// Launchpads: key (as the radar names the pool) -> its logo, name and coin page.
export const PADS: Record<string, { logo: Site; name: string; url: (mint: string) => string }> = {
  pump: { logo: "pumpfun", name: "pump.fun", url: (m) => `https://pump.fun/coin/${m}` },
  bonk: { logo: "bonk", name: "letsbonk.fun", url: (m) => `https://letsbonk.fun/token/${m}` },
  launchlab: { logo: "raydium", name: "Raydium LaunchLab", url: (m) => `https://raydium.io/launchpad/token/?mint=${m}` },
  bags: { logo: "bags", name: "Bags", url: (m) => `https://bags.fm/${m}` },
  moonshot: { logo: "moonshot", name: "Moonshot", url: (m) => `https://moonshot.money/${m}` },
  meteora: { logo: "meteora", name: "Meteora", url: (m) => `https://app.meteora.ag/dbc/${m}` },
};
// A coin's launchpad: its pool when the radar knows it, else pump.fun by its dex or its "…pump" mint.
export function padOf(c: { pool?: string | null; dex?: string | null; mint: string }): string {
  const p = (c.pool || "").toLowerCase();
  if (p && PADS[p]) return p;
  if (/^pump(fun|swap)$/.test(c.dex || "") || c.mint.endsWith("pump")) return "pump";
  if (/^meteora/.test(c.dex || "")) return "meteora";
  return p;
}
export const PadLogo = ({ pad, className }: { pad: string; className?: string }) => PADS[pad] ? <SiteLogo site={PADS[pad].logo} className={className} /> : null;
