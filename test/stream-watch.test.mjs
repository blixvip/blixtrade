import test from 'node:test';
import assert from 'node:assert/strict';
import { watchStream } from '../web/src/lib/streamWatch.js';

function harness() {
  const stream = new EventTarget();
  let now = 1000, stale = 0, tick, hidden = false, cancelled = 0;
  const stop = watchStream(stream, () => stale++, {
    now: () => now, repeat: fn => { tick = fn; return 1; }, cancel: () => cancelled++, visible: () => !hidden,
  });
  return { stream, stop, advance(ms) { now += ms; tick(); }, hidden(v) { hidden = v; }, get stale() { return stale; }, get cancelled() { return cancelled; } };
}
test('silent connection recovers even without receiving its first event, once only', () => {
  const h = harness(); h.advance(20_000); h.advance(20_000);
  assert.equal(h.stale, 1); assert.equal(h.cancelled, 1);
});
test('heartbeats preserve quiet but healthy connections; a stalled one recovers', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) { h.advance(5000); h.stream.dispatchEvent(new Event('tick')); }
  assert.equal(h.stale, 0); h.advance(20_000); assert.equal(h.stale, 1);
});
test('unmounted and hidden charts do not reconnect in the background', () => {
  const h = harness(); h.hidden(true); h.advance(60_000); assert.equal(h.stale, 0);
  h.hidden(false); h.advance(0); assert.equal(h.stale, 1);
  const stopped = harness(); stopped.stop(); stopped.advance(60_000); assert.equal(stopped.stale, 0);
});
