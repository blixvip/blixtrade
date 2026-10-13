// Trade presets, the way Axiom keeps them: three sets (P1 / P2 / P3), one picked at a time, each with its own buy
// sizes, sell shares, slippage, priority fee, bribe (the Sender tip) and MEV protection. Every buy and sell button
// (the instant trade panel, the coin page's panel, lib/trade.ts) trades with the set that is picked.
// Kept in this browser, and on the account when signed in (POST api/account/prefs), so every browser the person
// signs in from trades the same way; the account's copy wins when it is newer than this browser's.
import { create } from "zustand";
import { post } from "./api";
import { useMe } from "./ui";
import { store } from "./utils";

export type Preset = {
  name: string;
  buys: number[];        // the four buy sizes in SOL ([] = the paper desk's sizes)
  buysUsdc?: number[];   // the four buy sizes while trading in USDC
  sells: number[];       // the four sell shares in percent
  slip: number;          // max slippage, basis points (2000 = 20%)
  prio: number | null;   // priority fee in SOL; null = auto (what the coin's busiest recent trades paid, between the vault's floor and cap)
  tip: number;           // bribe in SOL: the Sender tip that puts the transaction on staked connections (and, from MEV_TIP, Jito's path too)
  mev: boolean;          // MEV protection: the tip is at least MEV_TIP, so the transaction goes through Jito and is never seen in the public mempool
};
export const SELLS = [25, 50, 75, 100];
export const PRIO_MAX = 0.01, TIP_MAX = 0.01, MEV_TIP = 0.001;   // SOL; the wallet service caps both fees at 0.01 too
export const SLIP_MIN = 10, SLIP_MAX = 5000;   // bps, the wallet service's own bounds

// The recommended sets, what everyone starts with (the user, 2026-10-12: "the base ones are the best ones"):
// Normal: 20% slippage (a pump.fun curve moves fast; tighter refuses too many fills), the priority fee read from the
//   coin's own busy trades, a small Sender tip so the transaction rides staked connections. Lands in a slot or two
//   on most coins for well under a cent of fees.
// Fast: for a launch's first seconds or a migration: 25% slippage, 0.003 SOL priority (the vault's cap), a 0.001
//   tip that opens every Sender path including Jito's, MEV protection on.
// Cheap: for quiet coins: 10% slippage, the floor priority fee, no tip.
export const DEFAULTS: Preset[] = [
  { name: "Normal", buys: [], sells: SELLS, slip: 2000, prio: null, tip: 0.0001, mev: false },
  { name: "Fast", buys: [], sells: SELLS, slip: 2500, prio: 0.003, tip: 0.001, mev: true },
  { name: "Cheap", buys: [], sells: SELLS, slip: 1000, prio: 0.0001, tip: 0, mev: false },
];
const OLD_SLIPS = [300, 1000, 2500];   // what the three sets had before fees were part of them (replaced by the recommended ones)

const num = (v: unknown, lo: number, hi: number): number | null => { const n = Number(v); return typeof v !== "boolean" && v !== "" && v != null && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const sizes = (v: unknown, n: number): number[] => (Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(Number(x)) && Number(x) > 0) ? v.map(Number) : []);
// One set, whatever shape it was kept in, made whole: a missing or bad field is the recommended one for that slot.
export function normalize(raw: unknown, i: number): Preset {
  const d = DEFAULTS[Math.min(2, Math.max(0, i))], r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const old = !("prio" in r);   // kept before fees were part of a set
  const slip = num(r.slip, SLIP_MIN, SLIP_MAX);
  const sells = sizes(r.sells, 4).map((x) => Math.round(x)).filter((x) => x >= 1 && x <= 100);
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 12) : d.name,
    buys: sizes(r.buys, 4), ...(sizes(r.buysUsdc, 4).length ? { buysUsdc: sizes(r.buysUsdc, 4) } : {}),
    sells: sells.length === 4 ? sells : d.sells,
    slip: slip == null || (old && OLD_SLIPS.includes(slip)) ? d.slip : Math.round(slip),
    prio: old || r.prio === null || r.prio === "auto" ? (old ? d.prio : null) : num(r.prio, 0, PRIO_MAX) ?? d.prio,
    tip: old ? d.tip : num(r.tip, 0, TIP_MAX) ?? d.tip,
    mev: old ? d.mev : r.mev === true,
  };
}
const normalizeAll = (raw: unknown): Preset[] => [0, 1, 2].map((i) => normalize(Array.isArray(raw) ? raw[i] : null, i));

type State = { list: Preset[]; pi: number; at: number };   // `at`: when the list last changed (ms), to pick the newer of browser and account
const load = (): State => {
  const kept = store.get<Preset[] | null>("qt:presets", null);
  const list = normalizeAll(kept);
  // The first set used to start from the panel's older keys.
  if (!kept) { const b = store.get<number[]>("qt:buys", []); if (b.length === 4) list[0].buys = b; }
  return { list, pi: Math.min(2, Math.max(0, store.get("qt:preset", 0))), at: store.get("qt:presets-at", 0) };
};
export const usePresets = create<State>(load);

const keep = (s: State) => {
  store.set("qt:presets", s.list); store.set("qt:preset", s.pi); store.set("qt:presets-at", s.at);
  store.set("trade:slip", s.list[s.pi].slip);   // the older single-slippage key, for anything still reading it
};
let syncTimer = 0;
// The account's copy, a moment after the last change (one request for a burst of edits).
const sync = () => {
  if (!useMe.getState().me?.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => { const s = usePresets.getState(); post("account/prefs", { presets: s.list, pi: s.pi, at: s.at }).catch(() => {}); }, 600);
};
const commit = (next: Partial<State>) => { const s = { ...usePresets.getState(), ...next, at: Date.now() }; keep(s); usePresets.setState(s); sync(); };

export const pickPreset = (pi: number) => commit({ pi: Math.min(2, Math.max(0, pi)) });
export const savePreset = (i: number, p: Preset) => commit({ list: usePresets.getState().list.map((x, j) => (j === i ? normalize(p, i) : x)) });
export const resetPresets = () => commit({ list: DEFAULTS.map((d) => ({ ...d })), pi: 0 });
export const activePreset = (): Preset => { const s = usePresets.getState(); return s.list[s.pi]; };
export const useActivePreset = () => usePresets((s) => s.list[s.pi]);

// What a trade sends the wallet service from a set: the priority fee (absent = auto) and the tip, raised to MEV_TIP
// when MEV protection is on.
export const feesFor = (p: Preset) => ({ priorityFeeSol: p.prio, tipSol: p.mev ? Math.max(p.tip, MEV_TIP) : p.tip });
// The editors' fields, by slot: 0-3 buys (above 0, at most 100,000 for a USDC size), 4-7 sells (1-100 %), 8 slippage
// (0.1-50 %), 9 priority fee ("auto", or 0 to PRIO_MAX SOL), 10 bribe (0 to TIP_MAX SOL).
export const fieldOk = (i: number, text: string) => {
  const t = text.trim();
  if (i === 9 && /^auto$/i.test(t)) return true;
  const v = Number(t);
  if (!t || !isFinite(v)) return false;
  return i < 4 ? v > 0 && v <= 100_000 : i < 8 ? v >= 1 && v <= 100 : i === 8 ? v >= 0.1 && v <= 50 : i === 9 ? v >= 0 && v <= PRIO_MAX : v >= 0 && v <= TIP_MAX;
};
export const slipTxt = (bps: number) => `${+(bps / 100).toFixed(2)}%`;
export const solTxt = (v: number) => (v === 0 ? "0" : v >= 0.001 ? `${+v.toFixed(4)}` : `${+v.toFixed(6)}`);
// One line for a set: "20% · auto · 0.0001 · MEV".
export const presetTxt = (p: Preset) => `${slipTxt(p.slip)} · ${p.prio == null ? "auto" : solTxt(p.prio)} · ${solTxt(p.mev ? Math.max(p.tip, MEV_TIP) : p.tip)}${p.mev ? " · MEV" : ""}`;

// The account's presets arrive with /api/account/me (server/hosted-accounts.js): the newer copy wins. A browser
// that never changed its presets takes the account's; an account with none takes this browser's.
type Prefs = { presets?: unknown; pi?: unknown; at?: unknown } | null | undefined;
let seenFor: string | undefined;
useMe.subscribe((s) => {
  const me = s.me;
  if (!me?.signedIn || me.email === seenFor) return;
  seenFor = me.email;
  const prefs = (me as { prefs?: Prefs }).prefs;
  const theirs = prefs && Array.isArray(prefs.presets) ? prefs : null;
  const mine = usePresets.getState();
  if (theirs && Number(theirs.at || 0) >= mine.at) {
    const s: State = { list: normalizeAll(theirs.presets), pi: Math.min(2, Math.max(0, Number(theirs.pi) || 0)), at: Number(theirs.at) || Date.now() };
    keep(s); usePresets.setState(s);
  } else if (mine.at > 0) sync();   // this browser's are newer (or the account has none yet): the account takes them
});
