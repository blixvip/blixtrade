// Hosted wallets bind to a verified Google subject. HTTP callers cannot choose a vault user ID.
// refOf(email): who invited this member (server/handles.js), told to the wallet service with each trade.
export function createHostedAccounts({ db, vault, launch, rewards, refOf = () => null, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS hosted_accounts (
    sub TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    vault_id INTEGER UNIQUE, address TEXT UNIQUE, consented INTEGER NOT NULL)`);
  const settingUp = new Map();
  const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
  const send = (res, status, data, headers = {}) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); res.end(JSON.stringify(data)); };
  const readBody = async (req, max = 8192) => {
    let body = "";
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > max) throw fail(413, "Request too large."); }
    try { const j = JSON.parse(body || "{}"); if (!j || typeof j !== "object" || Array.isArray(j)) throw Error(); return j; }
    catch { throw fail(400, "Body must be a JSON object."); }
  };
  const get = sub => db.prepare("SELECT * FROM hosted_accounts WHERE sub = ?").get(sub);
  const setup = identity => {
    if (settingUp.has(identity.sub)) return settingUp.get(identity.sub);
    const task = (async () => {
      let account = get(identity.sub);
      if (account?.address) return account;
      const other = db.prepare("SELECT sub FROM hosted_accounts WHERE email = ?").get(identity.email);
      if (other && other.sub !== identity.sub) throw fail(409, "This email already has a wallet linked to another identity. Contact support.");
      // Legacy consent timestamp: automatic provisioning records no user acceptance.
      if (!account) db.prepare("INSERT INTO hosted_accounts (sub, email, consented) VALUES (?, ?, ?)").run(identity.sub, identity.email, 0);
      const ref = `blix:google:${identity.sub}`;
      const v = await vault("/users", { email: identity.email, ref });
      if (!v || !Number.isSafeInteger(v.id) || v.id < 1 || v.ref !== ref || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.address || "")) throw fail(503, "Wallet identity could not be verified. Contact support.");
      db.prepare("UPDATE hosted_accounts SET vault_id = ?, address = ? WHERE sub = ?").run(v.id, v.address, identity.sub);
      return get(identity.sub);
    })().finally(() => settingUp.delete(identity.sub));
    settingUp.set(identity.sub, task);
    return task;
  };
  return async function handle(req, res, url) {
    try {
      const p = url.pathname, method = req.method, identity = req.walletIdentity;
      if (!/^\/api\/account\/(me|google|logout|setup|txs|buy|sell|withdraw|export|launch|rewards|claim|referral|referral\/claim)$/.test(p)) throw fail(404, "Not found.");
      if (p === "/api/account/google" && method === "GET") { res.writeHead(302, { location: "/auth/google?wallet=1", "cache-control": "no-store" }); res.end(); return true; }
      if (p === "/api/account/logout" && method === "POST") { send(res, 200, { signedIn: false }, { "set-cookie": "blix_wallet=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" }); return true; }
      if (!identity) {
        if (p === "/api/account/me" && method === "GET") send(res, 200, { signedIn: false, google: true, hosted: true });
        else throw fail(401, "Sign in with Google to access your wallet.");
        return true;
      }
      if (identity.email !== req.walletMember) throw fail(401, "Wallet identity does not match your signed-in account.");
      const account = get(identity.sub);
      if (p === "/api/account/me" && method === "GET") {
        let wallet = null, problem = null;
        if (account?.address) {
          try {
            wallet = await vault(`/users/${account.vault_id}/wallet`);
            if (wallet?.address !== account.address) throw Error("mismatched wallet");
          } catch { wallet = null; problem = "Wallet balance is temporarily unavailable. Try refreshing."; }
        }
        send(res, 200, { signedIn: true, hosted: true, email: identity.email, address: account?.address || null, needsWallet: !account?.address, wallet, problem, onramp: { stripe: false } });
        return true;
      }
      const body = method === "POST" ? await readBody(req, p === "/api/account/launch" ? 6e6 : 8192) : {};   // a launch carries the coin picture
      if (p === "/api/account/setup" && method === "POST") {
        const a = await setup(identity);
        send(res, 200, { address: a.address, hosted: true }); return true;
      }
      if (!account?.address) throw fail(409, "Create your hosted wallet before using it.");
      const own = `/users/${account.vault_id}`;
      if (p === "/api/account/txs" && method === "GET") { send(res, 200, await vault(`${own}/txs`)); return true; }
      if (p === "/api/account/rewards" && method === "GET" && rewards) { send(res, 200, await rewards(account.vault_id)); return true; }
      if (p === "/api/account/claim" && method === "POST") { send(res, 200, await vault(`${own}/claim`, {})); return true; }
      // Referrals: what this member earned from the trading fees of people they invited, and paying it out.
      if (p === "/api/account/referral" && method === "GET") {
        // Invited but not traded yet: the wallet service learns the inviter with the first trade; the fee shown is theirs already.
        const r = await vault(`${own}/referral`);
        if (r && !r.invited && refOf(identity.email) && r.on) Object.assign(r, { invited: true, yourFeeBps: Math.round((r.feeBps * (10_000 - (r.discountBps || 0))) / 10_000) });
        send(res, 200, r); return true;
      }
      if (p === "/api/account/referral/claim" && method === "POST") { send(res, 200, await vault(`${own}/refclaim`, {})); return true; }
      if (p === "/api/account/launch" && method === "POST" && launch) { send(res, 200, await launch(account.vault_id, body)); return true; }
      const fresh = () => { if (!Number.isSafeInteger(identity.authed) || identity.authed < 0 || now() - identity.authed > 600_000 || identity.authed > now() + 30_000) throw fail(401, "Sign in with Google again to confirm this.", { confirm: true }); };
      if (method === "POST" && (p === "/api/account/buy" || p === "/api/account/sell")) {
        const side = p.endsWith("/buy") ? "buy" : "sell";
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.mint || "")) throw fail(400, "Invalid coin address.");
        send(res, 200, await vault(`${own}/swap`, { side, mint: body.mint, ...(side === "buy" ? { sol: body.sol } : { pct: body.pct }), slippageBps: body.slippageBps, referrer: refOf(identity.email) || req.walletRef || undefined })); return true;
      }
      if (p === "/api/account/withdraw" && method === "POST") { fresh(); send(res, 200, await vault(`${own}/withdraw`, { to: body.to, sol: body.sol })); return true; }
      if (p === "/api/account/export" && method === "POST") { fresh(); send(res, 200, await vault(`${own}/export`, {})); return true; }
      throw fail(404, "Not found.");
    } catch (e) {
      send(res, e.status >= 400 && e.status < 500 ? e.status : 503, { error: e.status >= 400 && e.status < 500 ? e.message : "The wallet service is temporarily unavailable.", ...(e.confirm ? { confirm: true } : {}) });
    }
    return true;
  };
}
