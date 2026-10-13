// One subscription, with bounded handshakes and recovery independent of close events. `silentMs`: how long
// without a message counts as a dead feed (a busy program's logs: 30 s; one quiet pool's account: longer).
// `behind`: optional () => slots this feed's newest message trails the chain tip. A feed more than `maxBehind`
// slots back for 10 s is dropped and subscribed again: on a congested connection the provider's queue for one
// socket grew to minutes (465-553 slots seen), and the page showed trades that old. A fresh subscription
// starts at the tip; the trades skipped are those the radar could not have shown in time anyway.
// maxBehind 60 (~24 s): a public node itself sits 20-40 slots behind the tip at busy hours (2026-10-07), and
// resubscribing for that only opened a gap every minute. A lag resubscription reconnects at once, not after
// the 3 s a dead socket waits, so the gap it opens is the handshake alone.
export function startRpcStream({ url, request, WebSocketImpl = WebSocket, onStatus = () => {}, onEvent = () => {}, silentMs = 30_000, behind = null, maxBehind = 60, admit = () => true, meter = () => {} }) {
  let socket, timer, retry, stopped = false, upAt = 0, lateSince = 0;
  const lagCheck = behind && setInterval(() => {
    if (!socket || !upAt || Date.now() - upAt < 15_000) { lateSince = 0; return; }
    const b = behind();
    if (!(b > maxBehind)) { lateSince = 0; return; }
    if (!lateSince) lateSince = Date.now();
    else if (Date.now() - lateSince > 10_000) { lateSince = 0; upAt = 0; fail(`fell ${b} slots behind the chain: subscribed again`, 0); }
  }, 2000);
  lagCheck?.unref?.();
  const discard = () => {
    const old = socket; socket = null;
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try { old.close(); } catch {}
  };
  const fail = (error, delay = 3000) => {
    clearTimeout(timer);
    discard();
    onStatus({ connected: false, error });
    if (!stopped && !retry) retry = setTimeout(() => { retry = null; connect(); }, delay);
  };
  const watch = (ms, error) => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(error), ms);
  };
  const connect = () => {
    if (stopped) return;
    onStatus({ connected: false, error: null });
    let ws;
    const endpoint = url();
    if (!admit(endpoint)) { fail('RPC shared budget resting', 15_000); return; }
    try { socket = ws = new WebSocketImpl(endpoint); }
    catch { fail("RPC connection failed"); return; }
    let subscribed = false;
    watch(10_000, "RPC subscription timed out");
    ws.onopen = () => {
      if (socket !== ws) return;
      try { ws.send(JSON.stringify({ ...request, jsonrpc: "2.0", id: 1 })); }
      catch { fail("RPC subscription failed"); }
    };
    ws.onmessage = (message) => {
      if (socket !== ws) return;
      const raw = message.data;
      const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString();
      meter(endpoint, typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength);
      // Meter and check every message: a busy stream can spend its remaining grant within one second.
      if (!admit(endpoint)) { fail('RPC shared budget resting', 15_000); return; }
      let data;
      try { data = JSON.parse(text); } catch { return; }
      if (!data || typeof data !== "object") return;
      if (data.id === 1) {
        if (data.error || data.result == null) { fail("RPC provider rejected the subscription"); return; }
        subscribed = true; upAt = Date.now();
        onStatus({ connected: true, error: null });
      } else if (subscribed && (data.method === "logsNotification" || data.method === "accountNotification" || data.method === "programNotification" || data.method === "slotNotification")) {
        onEvent(data);
      } else return;
      watch(silentMs, "RPC feed went silent");
    };
    ws.onclose = () => { if (socket === ws) fail("RPC connection closed"); };
    ws.onerror = () => { if (socket === ws) fail("RPC connection failed"); };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(retry); if (lagCheck) clearInterval(lagCheck); discard(); };
}
