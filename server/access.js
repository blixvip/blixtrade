// What a visitor may do when the public site is open to everyone (settings.publicMode): read the live
// views. Anything that changes something, costs the owner money, or shows the owner's own setup
// (settings, wallets, alerts, paper desk, exports, backups) is refused. The owner keeps full control from
// this PC, or remotely with the access key.
const MINT = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const OPEN = [
  /^\/api\/(me|pulse|overview|bot|signals|tokens|discover|running|xcard|sparks|market|narratives|clusters|perf|briefs|research|triage|picks|picks\/all|health)$/,
  new RegExp(`^/api/(holders|candles|token|research|fomo/bars|gecko/price|replay)/${MINT}$`),   // fomo/bars: the coin's Fomo chart (fomochart.js)
  new RegExp(`^/api/coin/${MINT}(/trades|/big)?$`),
  /^\/api\/replay\/peaks$/,   // Practice list: highs of the day (replay.js)
  /^\/api\/fast\/stream$/,   // the open chart's price stream (fastlane.js): one coin's price, nothing of the owner's
  // A picture from elsewhere (a person's avatar, a post's photo), kept by the page server (pagepics.js). On the direct
  // line the page asks for /api/pic.webp (lib/thumb.ts): without it here every member's faces were refused (403).
  /^\/api\/pic(\.webp)?$/,
];

// A member: someone Kai let in from the waitlist, signed in with Google on trade.blixvip.com (the Worker vouches
// for them, webapp.js checks it). They read what a visitor may, and run their own paper desk (paper.js keeps each
// member's to themselves) with live quotes and the live stream. Settings, wallets, alerts, real trades and
// everything else of the owner's stay the owner's.
const MEMBER = [
  /^\/api\/paper(\/wallet|\/reset|\/quoted|\/deposit|\/balance)?$/,
  /^\/api\/paper\/\d+(\/sell|\/rule|\/sellq|\/preview)?$/,
  /^\/api\/quote$/,
  /^\/api\/stream$/,
  /^\/api\/feed\/(views|like)$/,   // the Feed page's view counts and likes (feedviews.js)
  /^\/api\/bubblemap$/,            // a coin's shared bubble map: read it, or make it when no one has yet (bubblemap.js)
];
// Reads a member gets beyond a visitor's: the shared market views every page uses (Fomo, the pump feed, X posts,
// the coin page's people, callouts and Fomo tabs). Never the owner's settings, wallets, alerts, log or exports.
const MEMBER_READS = [
  /^\/api\/feed\/(history|hot)$/,
  // fomo/known: the Pulse rows' faces; feed/hot: the Feed page's most-bought coins (both refused before: blank faces, empty list).
  /^\/api\/(fomo|fomo\/board|fomo\/feed|fomo\/list|fomo\/known|feed\/stream|feed\/hot|pump\/feed|pump\/board|x|narrative-feed|ext-sparks|picks\/all)$/,
  /^\/api\/fomo\/trader\/[A-Za-z0-9_.-]{1,64}$/,
  /^\/api\/banner$/,               // a coin's DexScreener banner for Discover's coin card (banner.js)
  new RegExp(`^/api/coin/${MINT}/(people|callouts|fomo)$`),
];
export function memberMay(method, pathname) {
  if (method === "GET" && /^\/api\/account\/(me|google|txs|rewards|referral|handle)$/.test(pathname)) return true;
  if (method === "POST" && /^\/api\/account\/(setup|logout|buy|sell|withdraw|export|launch|claim|referral\/claim|handle)$/.test(pathname)) return true;
  // A page that hit an error tells the server (main.tsx guards), so a crash anyone sees is in the log.
  if (method === "POST" && pathname === "/api/client-error") return true;
  if (visitorMay(method, pathname)) return true;
  if ((method === "GET" || method === "HEAD") && MEMBER_READS.some((re) => re.test(pathname))) return true;
  if (!["GET", "HEAD", "POST", "DELETE"].includes(method)) return false;
  return MEMBER.some((re) => re.test(pathname));
}

export function visitorMay(method, pathname) {
  if (method !== "GET" && method !== "HEAD") return false;
  if (!pathname.startsWith("/api/")) return true;        // the page itself and its pictures
  return OPEN.some((re) => re.test(pathname));
}

// The Health page for a visitor: what is working and what is not, without the detail (addresses, spend,
// file locations) that the owner's version carries.
export const visitorHealth = (report) => ({
  worst: report.worst, issues: report.issues,
  parts: (report.parts || []).map((p) => ({ key: p.key, name: p.name, state: p.state })),
});
