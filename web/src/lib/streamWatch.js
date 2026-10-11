// Heartbeats detect an apparently open connection whose network has silently stopped delivering.
// Activity starts at connection creation, so a connection with no first event also times out.
export function watchStream(stream, onStale, options = {}) {
  const now = options.now || Date.now;
  const repeat = options.repeat || ((fn, ms) => globalThis.setInterval(fn, ms));
  const cancel = options.cancel || ((id) => globalThis.clearInterval(id));
  const visible = options.visible || (() => typeof document === "undefined" || !document.hidden);
  let active = true, seen = now();
  const touch = () => { if (active) seen = now(); };
  const events = ["open", "hello", "tick", "trade"];
  for (const event of events) stream.addEventListener(event, touch);
  const stop = () => {
    active = false;
    cancel(timer);
    for (const event of events) stream.removeEventListener(event, touch);
  };
  const timer = repeat(() => {
    if (!active || !visible() || now() - seen < (options.timeoutMs || 20_000)) return;
    stop();
    onStale();
  }, 2000);
  return stop;
}
