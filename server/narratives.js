// Narratives: what themes are coins being launched around, and which ones are heating up.
import { db, json } from "./db.js";

// Known meme themes. Order matters only for display.
export const THEMES = [
  ["AI & Agents", /\b(ai|agi|agent|agents|gpt|llm|neural|robot|bot|grok|claude|openai|deepseek|sentient|autonomous)\b/i],
  ["Dogs", /\b(dog|doge|dogs|inu|shib|shiba|puppy|pup|wif|bonk|woof|corgi|pitbull)\b/i],
  ["Cats", /\b(cat|cats|kitty|kitten|meow|mew|popcat|nyan|puss)\b/i],
  ["Frogs & Pepe", /\b(pepe|frog|toad|kek|ribbit)\b/i],
  ["Politics", /\b(trump|maga|biden|kamala|vance|obama|president|election|senate|congress|potus|melania|barron)\b/i],
  ["Elon & X", /\b(elon|musk|tesla|spacex|xai|starship|doge\s?gov)\b/i],
  ["Degen culture", /\b(degen|ape|chad|gigachad|wojak|moon|pump|send|gm|wagmi|ngmi|jeet|cope|based|rekt|ser)\b/i],
  ["Brainrot", /\b(skibidi|sigma|rizz|gyatt|brainrot|fanum|ohio|mewing|aura|npc|mog)\b/i],
  ["Anime & Waifu", /\b(anime|waifu|chan|kun|senpai|kawaii|manga|otaku|goku|naruto)\b/i],
  ["Celebrity & Streamers", /\b(kanye|ye|drake|mrbeast|speed|kai|cenat|adin|tate|snoop|taylor|swift|diddy|streamer|rapper)\b/i],
  ["Finance & Stocks", /\b(nvda|nvidia|tsla|aapl|stock|stocks|fed|etf|bitcoin|btc|eth|gold|nasdaq|sp500|treasury)\b/i],
  ["Space & Aliens", /\b(space|alien|aliens|ufo|mars|moon\s?base|galaxy|cosmic|nasa|astro)\b/i],
  ["Religion & Myth", /\b(god|jesus|christ|bible|pope|allah|buddha|zeus|dragon|angel|devil|demon)\b/i],
  ["Food", /\b(pizza|burger|taco|sushi|banana|apple|cheese|bread|coffee|cookie|donut|milk|egg)\b/i],
  ["Animals", /\b(monkey|ape|penguin|bear|bull|goat|hippo|moo\s?deng|panda|fish|duck|chicken|pig|rat|hamster|capybara|otter|horse|lion|tiger|wolf|fox)\b/i],
  ["Gaming", /\b(game|gaming|gamer|minecraft|roblox|fortnite|pokemon|pixel|arcade|nintendo|playstation|xbox|gta)\b/i],
  ["Holidays & Events", /\b(halloween|spooky|pumpkin|christmas|santa|xmas|thanksgiving|easter|new\s?year|world\s?cup|olympics|super\s?bowl)\b/i],
  ["Countries & Cities", /\b(usa|america|china|japan|korea|india|russia|uk|canada|france|brazil|mexico|dubai|nyc|tokyo)\b/i],
];

const STOP = new Set(("the a an and or of to in on for with is it this that be are was by from at as your you we our my i me " +
  "coin token sol solana crypto meme memecoin official community first new just only all will can get has have not " +
  "https http www com fun io xyz app pump pumpfun dev ca launch live " +
  "every its into more real what when where who why how than then them they their there here out over under about just also " +
  "very much most many some any one two three next best more make made like love want need our first ever take back time " +
  "day days year world people thing things way been being were would could should into onto upon via per its it's dont don").split(" "));

const words = (t) => `${t.name || ""} ${t.symbol || ""} ${t.description || ""}`
  .toLowerCase().replace(/https?:\/\/\S+/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

export function themesFor(t) {
  const text = `${t.name || ""} ${t.symbol || ""} ${t.description || ""}`;
  return THEMES.filter(([, re]) => re.test(text)).map(([n]) => n).slice(0, 3);
}

// Rising = share of recent launches carrying a theme vs. its share over the prior window.
// Only real memecoins with believable prices count: a tokenized Apple share is not a Food meme, and an
// emptied pool's quoted volume is not money flowing into a theme.
export function computeNarratives({ recentMin = 60, baseMin = 6 * 60, launches = [] } = {}) {
  const now = Date.now();
  const rows = db.prepare(`SELECT mint, symbol, name, description, image, first_seen, mcap, vol_h1, chg_h1, score, themes, safety_score, status
    FROM tokens WHERE first_seen > ? AND quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme'`).all(now - baseMin * 60_000);
  const recent = rows.filter((r) => r.first_seen > now - recentMin * 60_000);
  const older = rows.filter((r) => r.first_seen <= now - recentMin * 60_000);

  const themes = THEMES.map(([name]) => {
    const inTheme = (r) => (json(r.themes, null) || themesFor(r)).includes(name);
    const rNow = recent.filter(inTheme), rOld = older.filter(inTheme);
    const shareNow = rNow.length / Math.max(recent.length, 1);
    const shareOld = rOld.length / Math.max(older.length, 1);
    const all = rows.filter(inTheme);
    const volume = all.reduce((s, r) => s + (r.vol_h1 || 0), 0);
    const top = all.filter((r) => r.status === "active" && (r.mcap || 0) >= 10000).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6)
      .map((r) => ({ mint: r.mint, symbol: r.symbol, name: r.name, image: r.image, score: r.score, mcap: r.mcap, chg_h1: r.chg_h1 }));
    const lNow = launches.filter((l) => l.t > now - recentMin * 60_000);
    const lOld = launches.length - lNow.length;
    const re = THEMES.find(([n]) => n === name)[1];
    const launchNow = lNow.filter((l) => re.test(`${l.name} ${l.symbol}`)).length;
    const launchOld = launches.filter((l) => l.t <= now - recentMin * 60_000 && re.test(`${l.name} ${l.symbol}`)).length;
    const launchShare = lNow.length ? launchNow / lNow.length : 0;
    // No earlier launches to compare against yet: no lift rather than a made-up one.
    const launchLift = launchOld && lOld >= 200 ? launchShare / (launchOld / lOld) : null;
    // Heat mixes money (volume of tracked coins), survivors (tracked coins), and attention (share of all launches).
    const heat = Math.round(100 * Math.min(1,
      Math.min(1, Math.log10(volume + 1) / 7) * 0.45 + Math.min(1, rNow.length / 15) * 0.25 + Math.min(1, launchShare / 0.08) * 0.3));
    return {
      name, launchNow, launchShare, launchLift, recent: rNow.length, total: all.length, volume, heat,
      momentum: shareOld ? shareNow / shareOld : rNow.length ? 3 : 0,
      top,
    };
  }).filter((t) => t.total > 0 || t.launchNow > 0).sort((a, b) => b.heat - a.heat);

  // Emerging words: terms showing up across several recent coins much more than before.
  const count = (list) => {
    const m = new Map();
    for (const r of list) for (const w of new Set(words(r))) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const cNow = count(recent), cOld = count(older);
  const emerging = older.length < 40 ? [] : [...cNow].filter(([, n]) => n >= 3).map(([w, n]) => {
    const before = (cOld.get(w) || 0) / Math.max(older.length, 1);
    const after = n / Math.max(recent.length, 1);
    return { word: w, count: n, lift: before ? after / before : n };
  }).filter((e) => e.lift >= 2).sort((a, b) => b.lift * Math.log(b.count + 1) - a.lift * Math.log(a.count + 1)).slice(0, 18);

  return { themes, emerging, sample: { recent: recent.length, older: older.length } };
}
