// Narratives that are running right now: not what is being launched or talked about, but where the money is
// going this hour. Every coin with real volume and a recent move is read (tokens table, DexScreener and the live
// feed keep it fresh), copies of one coin (five "TikTok" coins) are folded into one family, and families are
// grouped into stories: by an AI read when one is fresh (the owner's PC asks Claude every 2 minutes and relays it
// here, running-ai.js), otherwise by Blix's own themes (apps and brands, streamers, pump.fun itself...) and by
// words several running coins share. A story is ranked by the money moving through it, how many different coins
// carry it, and how hard they are moving.
//
// GET /api/running: { t, ai: { at, model } | null, stories: [{ id, name, why, source, score, stats, coins }],
// solo: [the biggest movers that belong to no story] }.
import { db } from "./db.js";
import { classifyAsset, median } from "./quality.js";
import { STOP } from "./narratives.js";

const MIN = 60_000, HOUR = 60 * MIN;
const now = () => Date.now();

// Themes, most specific first (a coin goes to the first that matches). Written for what runs on Solana now: coins
// named after apps and brands, streamers and celebrities, and pump.fun's own features are their own stories.
const RUN_THEMES = [
  ["Apps & platforms", /\b(tik ?tok|instagram|insta|youtube|yt|facebook|meta|reddit|twitter|tweet\w*|snapchat|snap|twitch|kick|discord|telegram|whatsapp|threads|linkedin|spotify|netflix|google|gmail|chrome|amazon|uber|airbnb|robinhood|coinbase|binance|paypal|venmo|cashapp|openai|chatgpt|rockstar|steam|onlyfans|tinder|pinterest|tumblr|myspace|vine|truth ?social|bluesky|substack|zoom|slack|microsoft|windows|apple|iphone|android|samsung|nike|mcdonalds|starbucks|walmart|tesla)\b/i, ["x", "tiktok", "ig", "fb", "yt"]],
  ["pump.fun itself", /\b(pump ?fun|pumpfun|pumpfolio|pumpwheel|pump ?pack|packs?|king of the hill|koth|bonding|graduat\w*|pumpswap|livestream|callout|pump ?verified)\b/i, ["pump", "pack", "koth"]],
  ["Streamers & celebrities", /\b(mr ?beast|ishowspeed|show ?speed|kai ?cenat|adin|xqc|pokimane|cr7|ronaldo|siu+|messi|neymar|megan ?fox|kanye|drake|taylor ?swift|tate|snoop|diddy|kardashian|kim k|logan paul|jake paul|ksi|streamer|celebrity)\b/i, ["speed", "beast"]],
  ["AI & agents", /\b(ai|agi|agent|agents|gpt|llm|neural|robot\w*|bot|grok|claude|deepseek|sentient\w*|autonomous|intelligence)\b/i, []],
  ["Elon & X", /\b(elon|musk|spacex|xai|starship|doge ?gov)\b/i, ["elon"]],
  ["Politics", /\b(trump|maga|biden|kamala|vance|obama|president|election|senate|congress|potus|melania|barron)\b/i, []],
  ["Brainrot", /\b(skibidi|sigma|rizz|gyatt|brainrot|fanum|ohio|mewing|aura|npc|mog|farming)\b/i, []],
  ["Dogs", /\b(dog|doge|dogs|inu|shib|shiba|puppy|pup|wif|bonk|woof|corgi|pitbull|pomeranian)\b/i, []],
  ["Cats", /\b(cat|cats|kitty|kitten|meow|mew|popcat|nyan|puss)\b/i, []],
  ["Frogs & Pepe", /\b(pepe|frog|toad|kek|ribbit)\b/i, []],
  ["Gaming", /\b(game|gaming|gamer|minecraft|roblox|fortnite|pokemon|arcade|nintendo|playstation|xbox|gta|tweetcraft)\b/i, []],
  ["Finance & markets", /\b(stock|stocks|fed|etf|nasdaq|wall ?street|stonk\w*|trader|trading|otc|swap|darkpool|privacy)\b/i, []],
  ["Animals", /\b(monkey|ape|penguin|bear|bull|goat|hippo|panda|fish|duck|chicken|pig|rat|hamster|capybara|otter|horse|lion|tiger|wolf|owl|bird)\b/i, []],
];
const themeOf = (c) => {
  const sym = String(c.symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = `${c.name || ""} ${c.symbol || ""} ${String(c.description || "").slice(0, 140)}`;
  const named = `${c.name || ""} ${c.symbol || ""}`;
  // pump.fun's own story by name only: half of all descriptions say "pump".
  for (const [name, re, syms] of RUN_THEMES) if (syms.includes(sym) || re.test(name === "pump.fun itself" ? named : text)) return name;
  return null;
};

// ---------- the coins running now ----------
// Real memecoins with a fresh reading, a market cap of at least $15K and $10K traded in the hour; old, steady
// coins only when they are moving (a week-old coin up 25% in the hour is part of today's story; one flat is not).
const pick = db.prepare(`SELECT mint, symbol, name, description, image, dex, liquidity, mcap, vol_m5, vol_h1, vol_h24, chg_m5, chg_h1, chg_h24,
  COALESCE(pair_created, first_seen) AS born, class_user, source FROM tokens
  WHERE mcap >= 15000 AND vol_h1 >= 10000 AND quarantine IS NULL AND updated > ? ORDER BY vol_h1 DESC LIMIT 400`);
const byMints = (mints) => (mints.length ? db.prepare(`SELECT mint, symbol, name, description, image, dex, liquidity, mcap, vol_m5, vol_h1, vol_h24, chg_m5, chg_h1, chg_h24,
  COALESCE(pair_created, first_seen) AS born, class_user, source FROM tokens WHERE mint IN (${mints.map(() => "?").join(",")})`).all(...mints) : []);

const familyKey = (c) => String(c.symbol || c.name || c.mint).toLowerCase().replace(/^\$/, "").replace(/[^a-z0-9]/g, "") || c.mint;
// Dollar-pegged and other quiet stores of value that the asset check misses (USDF, USDP...): never a story.
const pegged = (c) => /^(usd|eur|gbp)[a-z0-9]{0,3}$/i.test(String(c.symbol || "")) || /\b(stable ?coin|dollar|treasury|yield)\b/i.test(String(c.name || ""));
const moving = (c, t) => (c.chg_h1 ?? 0) >= 25 || (c.chg_m5 ?? 0) >= 10 || t - (c.born || 0) < 24 * HOUR;

// Families of the running coins: { key, lead (the most traded this hour), coins, vol (hour), mcap, chg (the lead's
// hour change), copies, youngest }. Shared with running-ai.js, which asks the AI about the same list.
// The lead is the biggest copy whose numbers hold together: real liquidity ($10K+) and a market cap no more than 25x
// it (pump pools sit at 2-20x; "IOF" at $158M on $1.1M and "SIB" at $12M on $0.3M were bad prices). The biggest cap alone picked a phantom $123M "QI" over the real $3M one, and the
// most volume picked an $85K copy with $4.9M of wash-traded volume (2026-10-10). No credible copy: the most traded.
const credible = (c) => (c.liquidity || 0) >= 10_000 && (c.mcap || 0) <= (c.liquidity || 0) * 25;
export function runningFamilies(t = now()) {
  // A price that does not hold together is not shown: no market cap (the page says —) and no move past +20,000%
  // in an hour (a bad first price, not a move).
  const rows = pick.all(t - 20 * MIN).filter((c) => classifyAsset(c) === "meme" && !pegged(c) && moving(c, t))
    .map((c) => ({ ...c, credible: credible(c), chg_h1: c.chg_h1 != null && Math.abs(c.chg_h1) > 20_000 ? null : c.chg_h1 }));
  const fams = new Map();
  for (const c of rows) {
    const k = familyKey(c);
    let f = fams.get(k);
    if (!f) fams.set(k, (f = { key: k, coins: [], vol: 0 }));
    f.coins.push(c); f.vol += c.vol_h1 || 0;
  }
  return [...fams.values()].map((f) => {
    f.coins.sort((a, b) => Number(b.credible) - Number(a.credible) || (a.credible ? (b.mcap || 0) - (a.mcap || 0) : (b.vol_h1 || 0) - (a.vol_h1 || 0)));
    const lead = f.coins[0];
    return { ...f, lead, mcap: lead.credible ? lead.mcap || 0 : 0, chg: lead.chg_h1 ?? null, copies: f.coins.length, youngest: Math.max(...f.coins.map((c) => c.born || 0)) };
  }).sort((a, b) => b.vol - a.vol).slice(0, 160);
}

// Blix's own grouping of a family list by theme, as [theme, [indexes]] (for the AI to start from: running-ai.js).
export function themeGroups(fams) {
  const by = new Map();
  fams.forEach((f, i) => { const th = themeOf(f.lead); if (th) (by.get(th) || by.set(th, []).get(th)).push(i); });
  return [...by].filter(([, ix]) => ix.length >= 2);
}

// ---------- the AI's read, relayed from the owner's PC ----------
// { at, model, stories: [{ name, why, mints: [lead mints] }] }; used while under AI_FRESH_MS old.
const AI_FRESH_MS = 8 * MIN;
let ai = null;
export function runningAiIn(body) {
  const stories = (Array.isArray(body?.stories) ? body.stories : []).slice(0, 20).map((s) => ({
    name: String(s?.name || "").slice(0, 60), why: String(s?.why || "").slice(0, 320),
    mints: (Array.isArray(s?.mints) ? s.mints : []).filter((m) => typeof m === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0, 30),
  })).filter((s) => s.name && s.mints.length);
  // An empty read means the AI read is off: Blix's own themes from now on.
  ai = stories.length ? { at: now(), model: String(body?.model || "").slice(0, 60) || null, stories } : null;
  memo = null;
  return { ok: true, stories: stories.length };
}
export const runningAiState = () => ai;

// ---------- stories ----------
// What ties a theme's coins together, in plain words (the story's first line when no AI read names it).
const THEME_LINK = {
  "Apps & platforms": "Coins named after apps, sites and brands (TikTok, X, YouTube...): traders betting on whatever app is in the news.",
  "pump.fun itself": "Coins about pump.fun's own features and culture: they run when pump.fun ships or teases something.",
  "Streamers & celebrities": "Coins named after streamers and celebrities: they move with whatever those people do on stream or post.",
  "AI & agents": "AI and agent coins: one of the longest-running stories on Solana, coming back whenever AI is in the news.",
  "Elon & X": "Coins about Elon Musk, X and SpaceX: they jump on his posts.",
  "Politics": "Political coins: they move with the news cycle and anything Trump or Washington says.",
  "Brainrot": "Brainrot coins: internet slang and meme words, pure attention plays.",
  "Dogs": "Dog coins: Solana's oldest meme category (BONK, WIF), and fresh ones keep launching.",
  "Cats": "Cat coins: the classic rival to dog coins.",
  "Frogs & Pepe": "Pepe and frog coins: the original internet meme, always a story somewhere.",
  "Gaming": "Coins named after games and gaming culture.",
  "Finance & markets": "Coins about stocks, trading and Wall Street: they follow what the wider markets are doing.",
  "Animals": "Other animal coins (apes, penguins, capybaras...): a rotating cast, one runs and copies follow.",
};
function linkOf(source, name, fams) {
  const lead = fams[0]?.lead, sym = lead ? `$${lead.symbol || lead.name}` : "one coin";
  if (source === "theme") return THEME_LINK[name] || `Coins that share the "${name}" theme.`;
  if (source === "words") { const w = name.replace(/^"|" coins$/g, ""); return `Every coin here has "${w}" in its name: several launches riding the same word at once, usually after one of them ran.`; }
  if (source === "copies") return `${sym} ran, and traders launched copies under the same name hoping to catch the spill-over. The copies usually fade faster than the original.`;
  return "";
}
// Heating up, steady or cooling: the last 5 minutes against the hour. Weighted by each coin's money.
function heatOf(fams) {
  const w = fams.filter((f) => f.lead.chg_m5 != null), tot = w.reduce((s, f) => s + f.vol, 0) || 1;
  const m5 = w.reduce((s, f) => s + (f.lead.chg_m5 || 0) * f.vol, 0) / tot, up5 = w.filter((f) => (f.lead.chg_m5 || 0) > 0).length;
  const heat = !w.length ? "steady" : m5 >= 3 && up5 >= w.length / 2 ? "heating" : m5 <= -3 && up5 < w.length / 2 ? "cooling" : "steady";
  return { heat, m5: w.length ? Math.round(m5 * 10) / 10 : null, up5, of5: w.length };
}
const coinOut = (f) => ({
  mint: f.lead.mint, symbol: f.lead.symbol, name: f.lead.name, image: f.lead.image, dex: f.lead.dex, mcap: f.lead.credible === false ? null : f.lead.mcap, liq: f.lead.liquidity,
  volH1: Math.round(f.vol), chg1h: f.lead.chg_h1 ?? null, chg5m: f.lead.chg_m5 ?? null, born: f.lead.born, copies: f.copies,
  // More than 20x its market cap traded in an hour: almost always bots trading with themselves (wash trading).
  wash: f.lead.credible !== false && (f.lead.mcap || 0) > 0 && (f.lead.vol_h1 || 0) > f.lead.mcap * 20,
});
function story(id, name, fams, source, why) {
  fams = fams.slice().sort((a, b) => b.vol - a.vol);
  const vol = fams.reduce((s, f) => s + f.vol, 0), mcap = fams.reduce((s, f) => s + (f.mcap || 0), 0);
  const chgs = fams.map((f) => f.chg).filter((x) => x != null), med = median(chgs);
  const up = chgs.filter((x) => x > 0).length, fresh = fams.filter((f) => now() - f.youngest < HOUR).length;
  const copies = fams.reduce((s, f) => s + f.copies, 0);
  // Money, widened by how many different coins carry the story and pushed by how hard they move (capped both ways).
  const score = vol * (1 + 0.25 * (fams.length - 1)) * Math.min(3, Math.max(0.4, 1 + (med ?? 0) / 150)) * (0.6 + 0.4 * (chgs.length ? up / chgs.length : 0.5));
  const names = fams.slice(0, 3).map((f) => f.lead.symbol || f.lead.name).join(", ");
  const h = heatOf(fams), lead = fams[0];
  const share = lead && vol > 0 ? Math.round((lead.vol / vol) * 100) : 0;
  // The numbers in words: who leads, how many are up, where it is heading now.
  const auto = `${names}${fams.length > 3 ? ` and ${fams.length - 3} more` : ""} ${fams.length > 1 ? "are" : "is"} running: ${usd(vol)} traded in the last hour${fams.length > 1 && lead ? `, ${share}% of it in $${lead.lead.symbol || lead.key}` : ""}. ${up} of ${chgs.length} ${chgs.length === 1 ? "is" : "are"} up on the hour${med != null ? ` (typical coin ${pctS(med)})` : ""}${fresh ? `, ${fresh} launched within the hour` : ""}${copies > fams.length ? `, plus ${copies - fams.length} copycat${copies - fams.length === 1 ? "" : "s"}` : ""}. ${h.heat === "heating" ? `Heating up: ${h.up5} of ${h.of5} are rising in the last 5 minutes.` : h.heat === "cooling" ? `Cooling off: only ${h.up5} of ${h.of5} are rising in the last 5 minutes.` : `Holding steady over the last 5 minutes.`}`;
  return { _fams: fams, id, name, source, why: why || "", link: source === "ai" ? "" : linkOf(source, name, fams), facts: auto, heat: h.heat, score: Math.round(score),
    stats: { coins: fams.length, copies, volH1: Math.round(vol), mcap: Math.round(mcap), medChg1h: med == null ? null : Math.round(med), up, fresh, m5: h.m5, up5: h.up5, leadShare: share }, coins: fams.slice(0, 12).map(coinOut) };
}
const usd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const pctS = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}%`;

let memo = null;
export function runningNarratives() {
  if (memo && now() - memo.t < 20_000) return memo;
  const t = now(), fams = runningFamilies(t);
  const byMint = new Map(); for (const f of fams) for (const c of f.coins) byMint.set(c.mint, f);
  const used = new Set(), stories = [];
  // 1. The AI's stories, while fresh: its coins as read here (a coin it named that is not in today's list is looked up).
  const aiFresh = ai && t - ai.at < AI_FRESH_MS ? ai : null;
  if (aiFresh) {
    const missing = aiFresh.stories.flatMap((s) => s.mints).filter((m) => !byMint.has(m));
    for (const c of byMints([...new Set(missing)].slice(0, 200))) if (classifyAsset(c) === "meme") { const f = { key: familyKey(c), coins: [c], vol: c.vol_h1 || 0, lead: c, mcap: c.mcap || 0, chg: c.chg_h1 ?? null, copies: 1, youngest: c.born || 0 }; byMint.set(c.mint, f); }
    aiFresh.stories.forEach((s, i) => {
      const fs = [...new Set(s.mints.map((m) => byMint.get(m)).filter(Boolean))].filter((f) => !used.has(f.key));
      if (fs.length < 2 || fs.reduce((a, f) => a + f.vol, 0) < 50_000) return;
      fs.forEach((f) => used.add(f.key));
      stories.push(story(`ai:${i}:${s.name}`, s.name, fs, "ai", s.why));
    });
  }
  // 2. Themes, over the families the AI did not place. A theme the AI already made a story of (most of a story's
  // coins share it) is not a second story: its other coins join that one ("Social app coins" and "Apps & platforms"
  // side by side read as two stories).
  const aiTheme = new Map();
  for (const st of stories) {
    const count = new Map(); for (const f of st._fams) { const th = themeOf(f.lead); if (th) count.set(th, (count.get(th) || 0) + 1); }
    const [th, n] = [...count].sort((x, y) => y[1] - x[1])[0] || [];
    if (th && n >= 2 && !aiTheme.has(th)) aiTheme.set(th, st);
  }
  const byTheme = new Map();
  for (const f of fams) { if (used.has(f.key)) continue; const th = themeOf(f.lead); if (th) (byTheme.get(th) || byTheme.set(th, []).get(th)).push(f); }
  for (const [name, fs] of byTheme) {
    const host = aiTheme.get(name);
    if (host) {
      fs.forEach((f) => used.add(f.key));
      const i = stories.indexOf(host);
      stories[i] = story(host.id, host.name, [...host._fams, ...fs], "ai", host.why);
      aiTheme.set(name, stories[i]);
      continue;
    }
    if (fs.length < 2 || fs.reduce((a, f) => a + f.vol, 0) < 50_000) continue;
    fs.forEach((f) => used.add(f.key));
    stories.push(story(`theme:${name}`, name, fs, "theme"));
  }
  // 3. A word several running coins share in their names (a story Blix has no theme for yet).
  const byWord = new Map();
  for (const f of fams) {
    if (used.has(f.key)) continue;
    const ws = new Set(`${f.lead.name || ""} ${f.lead.symbol || ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
    for (const w of ws) (byWord.get(w) || byWord.set(w, []).get(w)).push(f);
  }
  for (const [w, fs0] of [...byWord].sort((a, b) => b[1].length - a[1].length)) {
    const fs = fs0.filter((f) => !used.has(f.key));
    if (fs.length < 2 || fs.reduce((a, f) => a + f.vol, 0) < 50_000) continue;
    fs.forEach((f) => used.add(f.key));
    stories.push(story(`word:${w}`, `"${w[0].toUpperCase()}${w.slice(1)}" coins`, fs, "words"));
  }
  // 4. One coin with many copies is a story of its own (the crowd piling into one name).
  for (const f of fams) {
    if (used.has(f.key) || f.copies < 3 || f.vol < 100_000) continue;
    used.add(f.key);
    stories.push(story(`copies:${f.key}`, `$${f.lead.symbol || f.key} and its copies`, [f], "copies"));
  }
  stories.sort((a, b) => b.score - a.score);
  // The biggest movers no story holds: running on their own.
  const soloF = fams.filter((f) => !used.has(f.key) && (f.chg ?? 0) > 0).sort((a, b) => b.vol - a.vol).slice(0, 10), solo = soloF.map(coinOut);
  memo = { t, ai: aiFresh ? { at: aiFresh.at, model: aiFresh.model } : null, universe: { coins: fams.reduce((s, f) => s + f.copies, 0), families: fams.length }, stories: stories.slice(0, 16).map(({ _fams, ...st }) => st), solo, soloHeat: heatOf(soloF).heat };
  return memo;
}
