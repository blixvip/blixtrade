// One subscription, with bounded handshakes and recovery independent of close events.
export function startRpcStream({ url, request, WebSocketImpl = WebSocket, onStatus = () => {}, onEvent = () => {} }) {
  let socket, timer, retry, stopped = false;
  const discard = () => {
    const old = socket; socket = null;
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try { old.close(); } catch {}
  };
  const fail = (error) => {
    clearTimeout(timer);
    discard();
    onStatus({ connected: false, error });
    if (!stopped && !retry) retry = setTimeout(() => { retry = null; connect(); }, 3000);
  };
  const watch = (ms, error) => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(error), ms);
  };
  const connect = () => {
    if (stopped) return;
    onStatus({ connected: false, error: null });
    let ws;
    try { socket = ws = new WebSocketImpl(url()); }
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
      let data;
      try { data = JSON.parse(message.data); } catch { return; }
      if (!data || typeof data !== "object") return;
      if (data.id === 1) {
        if (data.error || data.result == null) { fail("RPC provider rejected the subscription"); return; }
        subscribed = true;
        onStatus({ connected: true, error: null });
      } else if (subscribed && data.method === "logsNotification") {
        onEvent(data);
      } else return;
      watch(30_000, "RPC feed went silent");
    };
    ws.onclose = () => { if (socket === ws) fail("RPC connection closed"); };
    ws.onerror = () => { if (socket === ws) fail("RPC connection failed"); };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(retry); discard(); };
}
