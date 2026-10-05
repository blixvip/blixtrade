// Profiles and following (server/social.js, under /api/account/*). Each Blix account has a public page at
// #/u/<username>; people follow Blix accounts, Fomo traders (by handle) and wallets.
import { useEffect, useState } from "react";
import { api } from "./api";
import { usePulse } from "./pulse";

export type FollowKind = "user" | "trader" | "wallet";
export interface Profile {
  id: number; username: string; display: string; bio: string; avatar: string | null; banner: string | null; address: string | null;
  showHoldings: boolean; joined: number; followers: number; follows: number; following: boolean; isMe: boolean;
}
export interface Holdings { sol: number; solUsd: number; tokensUsd: number; tokens: { mint: string; ui: number; usd: number | null }[] }
export interface Trade { t: number; kind: "buy" | "sell" | "launch"; mint: string | null; sol: number | null; sig: string | null; status: string }
export interface UserPage { profile: Profile; holdings: Holdings | null; activity: Trade[]; problem: string | null }
export type FollowRow = ({ kind: "user" } & Profile) | { kind: "trader" | "wallet"; target: string; t: number; following: boolean };

export async function social<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/account/${path}`, body === undefined ? { signal: AbortSignal.timeout(30_000) }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
  return j as T;
}

export const follow = (kind: FollowKind, target: string | number, on: boolean) =>
  social<{ following: boolean; followers?: number; follows?: number }>("follow", { kind, target: String(target), on });

// A picture from a file input, made small enough to send: cropped to the shape it is shown in and saved as
// WebP. A GIF is sent as it is, so it keeps moving.
export async function pictureFrom(file: File, w: number, h: number): Promise<string> {
  const read = () => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(file); });
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Pick a PNG, JPG, GIF or WebP picture.");
  if (file.type === "image/gif") { if (file.size > 2e6) throw new Error("A GIF can be up to 2 MB."); return read(); }
  const img = new Image();
  img.src = await read();
  await img.decode();
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const sw = w / scale, sh = h / scale;
  c.getContext("2d")!.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  return c.toDataURL("image/webp", 0.88);
}

// Ticker and name for coins a wallet holds: from live Pulse data when it has the coin, else asked once.
const nameCache = new Map<string, { symbol?: string; name?: string }>();
export function useCoinNames(mints: string[]) {
  const [, bump] = useState(0);
  const key = mints.join(",");
  useEffect(() => {
    for (const mint of mints) {
      if (nameCache.has(mint)) continue;
      const live = usePulse.getState().coins[mint];
      if (live?.symbol) { nameCache.set(mint, { symbol: live.symbol, name: live.name }); continue; }
      nameCache.set(mint, {});
      api<{ token?: { symbol?: string; name?: string } }>(`token/${mint}`).then((r) => { nameCache.set(mint, { symbol: r.token?.symbol, name: r.token?.name }); bump((n) => n + 1); }).catch(() => {});
    }
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (mint: string) => nameCache.get(mint) || {};
}
