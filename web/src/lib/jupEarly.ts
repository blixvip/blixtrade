// A coin's first minutes on its second charts (1 s, 5 s), read by the browser from Jupiter when the server's
// answer starts after the launch: the radar heard the coin late, and Jupiter refuses most of the server's own
// calls (429s on its address, 2026-10-10), while a visitor's browser is let through (it allows blixvip.com).
// One page is 1,000 of Jupiter's 1 s candles (under 17 minutes); up to 8 pages back from the server's first
// candle. Read once per coin, size and starting point; a failure is tried again after 30 s.
// Jupiter's market caps are on its own supply figure, which can be far off ours and change between reads (1DOG:
// 45M, so its caps read 22x under ours): the first page reaches a minute past `before`, and those overlapping
// candles say what to multiply Jupiter's by (onLevel).
interface Bar { time: number; open: number; high: number; low: number; close: number; value: number }
export interface Early { pre: Bar[]; overlap: Bar[] }

const API = "https://datapi.jup.ag/v2/charts/";
const done = new Map<string, { got: Early | null; t: number }>();

async function page(mint: string, toMs: number) {
  const r = await fetch(`${API}${mint}?interval=1_SECOND&to=${toMs}&candles=1000&type=mcap&quote=usd`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Jupiter ${r.status}`);
  const j = (await r.json()) as { candles?: { time: number; open: number; high: number; low: number; close: number; volume?: number }[] };
  return (j.candles || []).filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
}

async function read(mint: string, tf: number, before: number): Promise<Early> {
  let raw: Awaited<ReturnType<typeof page>> = [], to = (before + 60) * 1000;
  for (let i = 0; i < 8; i++) {
    const got = (await page(mint, to)).filter((c) => c.time < to / 1000 && (!raw.length || c.time < raw[0].time));
    if (!got.length) break;
    raw = [...got, ...raw];
    if (got.length < 900) break;   // the launch reached
    to = got[0].time * 1000;
  }
  // A launch block's stray quote on the very first candle (10x over the next ones) is pulled to its close.
  if (raw.length > 3) {
    const c0 = raw[0], next = Math.max(...raw.slice(1, 11).map((c) => c.high));
    if (c0.open > next * 10) c0.open = c0.close;
    if (c0.high > next * 10) c0.high = Math.max(c0.open, c0.close);
  }
  const out: Bar[] = [];
  for (const c of raw) {
    const t = c.time - (c.time % tf), last = out[out.length - 1];
    if (last && last.time === t) { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; last.value += c.volume || 0; }
    else out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, value: c.volume || 0 });
  }
  return { pre: out.filter((x) => x.time < before), overlap: out.filter((x) => x.time >= before) };
}

// The candles before `before` (unix seconds) once they are in, else null (and the read is started). Callers
// ask again on their next poll.
export function earlyBars(mint: string, tf: number, before: number): Early | null {
  if (tf >= 60 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const key = `${mint}:${tf}:${before}`, had = done.get(key);
  if (had && (had.got || Date.now() - had.t < 30_000)) return had.got;
  done.set(key, { got: null, t: Date.now() });
  if (done.size > 200) done.delete(done.keys().next().value!);
  read(mint, tf, before).then((got) => done.set(key, { got, t: Date.now() }), () => done.set(key, { got: null, t: Date.now() }));
  return null;
}

// Jupiter's early candles on our level: the factor is the median of our close over Jupiter's across the candles
// both have, and only when at least 3 of them share it within 15% (the middle 60% of the ratios, so one stray
// candle does not veto it). Else nothing is drawn: two sources that do not line up would put a step in the chart.
export function onLevel(e: Early, ours: { time: number; close: number }[]): Bar[] {
  const byT = new Map(ours.map((x) => [x.time, x.close]));
  const ks = e.overlap.map((x) => (byT.get(x.time) ?? 0) / x.close).filter((k) => k > 0 && Number.isFinite(k)).sort((a, b) => a - b);
  if (ks.length < 3 || ks[Math.floor(ks.length * 0.8)] / ks[Math.floor(ks.length * 0.2)] > 1.15) return [];
  const k = ks[Math.floor(ks.length / 2)];
  return e.pre.map((x) => ({ ...x, open: x.open * k, high: x.high * k, low: x.low * k, close: x.close * k }));
}
