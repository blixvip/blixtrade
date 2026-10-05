// What a visitor may do when the public site is open to everyone (settings.publicMode): read the live
// views. Anything that changes something, costs the owner money, or shows the owner's own setup
// (settings, wallets, alerts, paper desk, exports, backups) is refused. The owner keeps full control from
// this PC, or remotely with the access key.
const MINT = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const OPEN = [
  /^\/api\/(me|pulse|overview|bot|signals|tokens|sparks|market|narratives|clusters|perf|briefs|research|triage|picks|picks\/all|health)$/,
  new RegExp(`^/api/(holders|candles|token|research)/${MINT}$`),
  new RegExp(`^/api/coin/${MINT}(/trades|/big)?$`),
];

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
