// The Account page (#/account): sign in with Google, the wallet Blix Vault holds for you, real buys and
// sells, withdrawals. Real money. Talks to /api/account/* (server/accounts.js); keys never reach this
// page except when you ask to export your own.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function call(path, body) {
  const r = await fetch(`/api/account/${path}`, body === undefined ? { signal: AbortSignal.timeout(30_000) }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || r.status), { confirm: j.confirm });
  return j;
}
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  bolt: svg('<path d="M13 2L5 13.5h6L10 22l9-12h-6.5z"/>'),
  out: svg('<path d="M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>'),
  // Google's "G", in its own four colours (a brand mark, not interface colour).
  google: '<svg viewBox="0 0 24 24" aria-hidden="true" class="acct-g"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.600-.2-2.300H12v4.400h6.200c-.3 1.400-1.100 2.600-2.300 3.400v2.900h3.700c2.200-2 3.400-5 3.400-8.400z"/><path fill="#34A853" d="M12 23.500c3.100 0 5.700-1 7.600-2.800l-3.700-2.900c-1 .7-2.300 1.100-3.900 1.100-3 0-5.500-2-6.400-4.700H1.800v3C3.700 21 7.500 23.500 12 23.500z"/><path fill="#FBBC05" d="M5.600 14.200c-.2-.7-.4-1.400-.4-2.200s.1-1.500.4-2.200v-3H1.800C1 8.400.5 10.100.5 12s.5 3.600 1.300 5.200l3.800-3z"/><path fill="#EA4335" d="M12 5.100c1.700 0 3.200.6 4.400 1.700l3.300-3.300C17.700 1.600 15.100.5 12 .5 7.500.5 3.700 3 1.800 6.800l3.800 3c.9-2.700 3.400-4.700 6.400-4.700z"/></svg>',
};
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const sol = (n) => (+n || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const usd = (n) => n == null ? "—" : `$${(+n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const tx = (s) => `<a class="linkish mono" href="https://solscan.io/tx/${esc(s)}" target="_blank" rel="noreferrer">${short(s)}</a>`;

export async function viewAccount(main, { toast = (t) => alert(t) } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "acct";
  const state = { me: null, txs: [], busy: null, confirm: false };
  // A sign-in that failed comes back as #/account/e/<why>
  const parts = location.hash.split("/");
  const failed = parts[2] === "e" && parts[3] ? decodeURIComponent(parts[3]) : null;

  const signedOut = () => `<div class="page-head"><div><h1>Account</h1><p>Sign in and Blix makes you a Solana wallet for real buys and sells.</p></div></div>
    <div class="card acct-form">
      ${state.me?.google ? `<a class="btn acct-google" href="/api/account/google">${ICON.google}Sign in with Google</a>
        <p class="note">Your first sign-in creates your wallet. Blix holds its key; you can export it at any time.</p>`
        : `<p class="note"><b>Google sign-in is not set up yet.</b> The owner needs to add a Google client id and secret (data/google.json).</p>`}
      ${failed ? `<p class="down">${esc(failed)}</p>` : ""}
    </div>`;

  const signedIn = () => {
    const m = state.me, w = m.wallet, total = w ? w.solUsd + w.tokensUsd : null;
    return `<div class="page-head"><div><h1>Account</h1><p>${esc(m.name ? `${m.name} · ` : "")}${esc(m.email)}</p></div>
        <div class="desk-stats"><button class="btn sm-btn" data-reload>${ICON.refresh}Refresh</button><button class="btn sm-btn" data-logout>Sign out</button></div></div>
      ${m.problem ? `<div class="card lane-note" style="margin-bottom:14px"><b>The wallet service did not answer.</b> ${esc(m.problem)}</div>` : ""}
      ${state.confirm ? `<div class="card lane-note acct-confirm" style="margin-bottom:14px"><span><b>Confirm it is you.</b> Withdrawing or showing your key needs a Google sign-in from the last ten minutes.</span><a class="btn sm-btn" href="/api/account/google?confirm=1">${ICON.google}Sign in again</a></div>` : ""}
      <div class="card acct-wallet"><div><span class="acct-label">Your wallet · send SOL here to deposit</span>
          <div class="acct-addr mono">${esc(m.address)}<button class="btn sm-btn" data-copy="${esc(m.address)}">${ICON.copy}Copy</button></div></div>
        <div class="acct-figs"><div><span class="acct-label">SOL</span><b>${w ? sol(w.sol) : "—"}</b><small>${w ? usd(w.solUsd) : ""}</small></div>
          <div><span class="acct-label">Coins</span><b>${w ? usd(w.tokensUsd) : "—"}</b><small>${w ? `${w.tokens.length} held` : ""}</small></div>
          <div><span class="acct-label">Total</span><b>${usd(total)}</b></div></div></div>
      <div class="acct-grid">
        <form class="card acct-form" data-form="buy"><h2>Buy a coin</h2>
          <label><span>Contract address</span><input name="mint" class="mono" placeholder="…pump" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}"></label>
          <label><span>SOL to spend</span><input name="sol" inputmode="decimal" value="0.05" required></label>
          <button class="btn primary" ${state.busy ? "disabled" : ""}>${ICON.bolt}${state.busy === "buy" ? "Buying…" : "Buy with real SOL"}</button></form>
        <form class="card acct-form" data-form="withdraw"><h2>Withdraw SOL</h2>
          <label><span>To address</span><input name="to" class="mono" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}"></label>
          <label><span>SOL</span><input name="sol" inputmode="decimal" required></label>
          <button class="btn" ${state.busy ? "disabled" : ""}>${ICON.out}${state.busy === "withdraw" ? "Sending…" : "Withdraw"}</button></form>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Holdings</h2><small>${w ? `${w.tokens.length} coins` : ""}</small></div>
        <div class="table-wrap"><table><thead><tr><th>Coin</th><th>Amount</th><th>Value</th><th>Sell</th></tr></thead><tbody>
        ${w?.tokens.length ? w.tokens.map((t) => `<tr><td><a class="linkish mono" href="#/coin/${esc(t.mint)}">${short(t.mint)}</a></td><td>${(+t.ui).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>${usd(t.usd)}</td>
          <td>${[25, 50, 100].map((p) => `<button class="btn sm-btn" data-sell="${esc(t.mint)}" data-pct="${p}" ${state.busy ? "disabled" : ""}>${p}%</button>`).join(" ")}</td></tr>`).join("")
          : `<tr><td colspan="4"><p class="note pad">No coins yet. Deposit SOL, then buy one above.</p></td></tr>`}</tbody></table></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Transactions</h2><small>newest first</small></div>
        <div class="table-wrap"><table><thead><tr><th>When</th><th>Kind</th><th>SOL</th><th>Coin</th><th>Signature</th><th>Status</th></tr></thead><tbody>
        ${state.txs.length ? state.txs.map((t) => `<tr><td>${when(t.t)}</td><td>${esc(t.kind)}</td><td>${t.sol != null ? sol(t.sol) : "—"}</td><td class="mono">${t.mint ? short(t.mint) : t.dest ? `to ${short(t.dest)}` : "—"}</td><td>${t.sig ? tx(t.sig) : "—"}</td>
          <td class="${t.status === "confirmed" ? "up" : t.status === "failed" ? "down" : ""}">${esc(t.status)}</td></tr>`).join("") : `<tr><td colspan="6"><p class="note pad">Nothing yet.</p></td></tr>`}</tbody></table></div></div>
      <div class="card acct-form acct-export"><h2>Export your key</h2>
        <p class="note">Shows this wallet's secret key so you can import it into Phantom. Anyone who sees it can take everything in the wallet.</p>
        <button class="btn" data-export>${ICON.key}Show my secret key</button><pre class="acct-key mono" hidden></pre></div>`;
  };

  const draw = () => { wrap.innerHTML = state.me?.signedIn ? signedIn() : signedOut(); };
  async function load() {
    state.me = await call("me");
    state.txs = state.me.signedIn ? await call("txs").catch(() => []) : [];
    draw();
  }
  const oops = (e) => { if (e.confirm) { state.confirm = true; draw(); wrap.querySelector(".acct-confirm")?.scrollIntoView({ block: "center" }); } else toast(e.message); };
  // A real transaction: say what happened, then read the wallet again.
  async function act(kind, path, body, done) {
    state.busy = kind; draw();
    let err = null;
    try { const r = await call(path, body); toast(`${done} · ${r.status}${r.note ? ` (${r.note})` : ""}`); } catch (e) { err = e; }
    state.busy = null;
    await load().catch(() => draw());
    if (err) oops(err);
  }

  wrap.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target, kind = form.dataset.form, f = Object.fromEntries(new FormData(form));
    if (kind === "buy") return confirm(`Buy with ${f.sol} real SOL?\n\n${f.mint}`) && act("buy", "buy", { mint: f.mint.trim(), sol: +f.sol }, "Buy sent");
    if (kind === "withdraw") return confirm(`Send ${f.sol} SOL to\n${f.to}?\n\nThis cannot be undone.`) && act("withdraw", "withdraw", { to: f.to.trim(), sol: +f.sol }, "Withdrawal sent");
  });
  wrap.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-logout],[data-reload],[data-sell],[data-export]");
    if (!el) return;
    if ("logout" in el.dataset) { await call("logout", {}); return load(); }
    if ("reload" in el.dataset) return load().catch((err) => toast(err.message));
    if ("export" in el.dataset) {
      try { const box = wrap.querySelector(".acct-key"); box.textContent = (await call("export", {})).secretKey; box.hidden = false; } catch (err) { oops(err); }
      return;
    }
    if (el.dataset.sell && confirm(`Sell ${el.dataset.pct}% of ${short(el.dataset.sell)} for SOL?`)) act("sell", "sell", { mint: el.dataset.sell, pct: +el.dataset.pct }, "Sell sent");
  });

  await load();
  main.replaceChildren(wrap);
}
