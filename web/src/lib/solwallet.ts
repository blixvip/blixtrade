// Browser Solana wallets (Phantom, Solflare, Backpack and any other) through the Wallet Standard, without a
// wallet library: wallets announce themselves on the window, and a plain SOL transfer is built by hand (a legacy
// transaction with one System Program transfer), so no @solana/web3.js comes down with the app. Used by the
// Deposit window to send SOL from the person's own wallet into their Blix wallet.
import { useSyncExternalStore } from "react";

export interface StdAccount { address: string; publicKey: Uint8Array }
export interface StdWallet {
  name: string; icon: string; chains: readonly string[]; accounts: readonly StdAccount[];
  features: Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
}

const found = new Map<string, StdWallet>();
let list: StdWallet[] = [];
const subs = new Set<() => void>();
const register = (...ws: StdWallet[]) => {
  for (const w of ws) if (w.chains?.some((c) => c.startsWith("solana:")) && w.features?.["solana:signAndSendTransaction"] && w.features?.["standard:connect"]) found.set(w.name, w);
  list = [...found.values()];
  subs.forEach((f) => f());
  return () => {};
};
if (typeof window !== "undefined") {
  window.addEventListener("wallet-standard:register-wallet", (e) => (e as CustomEvent<(api: { register: typeof register }) => void>).detail?.({ register }));
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
}
export const useWallets = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => list);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) { const v = B58.indexOf(ch); if (v < 0) throw new Error("Bad address"); n = n * 58n + BigInt(v); }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
export function b58encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x !== 0) break; s = "1" + s; }
  return s;
}

// Public RPCs that answer browsers; the first that gives a blockhash is used.
const RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (j.result !== undefined) return j.result as T;
      last = j.error?.message;
    } catch (e) { last = e; }
  }
  throw new Error(`Solana RPC unavailable${last ? `: ${String((last as Error).message ?? last)}` : ""}`);
}
export const solBalance = (address: string) => rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]).then((r) => r.value / 1e9);

// A legacy transaction moving `lamports` from `from` to `to`, unsigned (one empty signature slot).
function transferTx(from: Uint8Array, to: Uint8Array, blockhash: Uint8Array, lamports: bigint): Uint8Array {
  const data = new Uint8Array(12), dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); dv.setBigUint64(4, lamports, true);
  const msg = [1, 0, 1, 3, ...from, ...to, ...new Uint8Array(32), ...blockhash, 1, 2, 2, 0, 1, data.length, ...data];
  return Uint8Array.from([1, ...new Uint8Array(64), ...msg]);
}

// Connects (asking the wallet if needed), sends `sol` to `to`, and returns the transaction signature.
export async function sendSol(w: StdWallet, to: string, sol: number): Promise<string> {
  let account = w.accounts[0];
  if (!account) { const r = await w.features["standard:connect"].connect(); account = r.accounts?.[0] ?? w.accounts[0]; }
  if (!account) throw new Error(`${w.name} did not share an account`);
  const { value } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
  const tx = transferTx(account.publicKey ?? b58decode(account.address), b58decode(to), b58decode(value.blockhash), BigInt(Math.round(sol * 1e9)));
  const [res] = await w.features["solana:signAndSendTransaction"].signAndSendTransaction({ account, chain: "solana:mainnet", transaction: tx });
  return b58encode(res.signature);
}
export async function connectWallet(w: StdWallet): Promise<StdAccount | null> {
  if (w.accounts[0]) return w.accounts[0];
  const r = await w.features["standard:connect"].connect();
  return r.accounts?.[0] ?? null;
}
