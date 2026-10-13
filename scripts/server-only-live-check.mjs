// Run on the VM: node --no-warnings scripts/server-only-live-check.mjs
// Read-only: no trades, settings changes, browser login copies, or PC connections.
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4421';
const json = async p => {
  const r = await fetch(base + p, { signal: AbortSignal.timeout(20_000) });
  assert.equal(r.status, 200, p);
  return r.json();
};
const initial = await json('/api/fomo/feed');
assert.equal(initial.via, 'here', 'Fomo must be read on the VM');
async function stream(p) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  const counts = {}, sources = {}, failures = [];
  let text = '';
  try {
    const r = await fetch(base + p, { signal: abort.signal });
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const decoder = new TextDecoder();
    for await (const chunk of r.body) {
      text += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = text.indexOf('\n\n')) >= 0) {
        const block = text.slice(0, end); text = text.slice(end + 2);
        const kind = block.match(/^event: ?(.+)$/m)?.[1];
        if (!kind) continue;
        counts[kind] = (counts[kind] || 0) + 1;
        if (kind === 'feed') {
          const j = JSON.parse(block.match(/^data: ?(.+)$/m)[1]);
          const s = sources[j.src] ||= { events: 0, first: j.t, last: j.t };
          s.events++; s.last = j.t;
          if (j.error || j.signedOut) failures.push(j.error || 'signed out');
        }
      }
    }
  } catch (e) { if (!abort.signal.aborted) throw e; }
  finally { clearTimeout(timer); }
  return { counts, sources, failures };
}
const [feed, main] = await Promise.all([
  stream(`/api/feed/stream?sources=fomo,pump&groups=${initial.groups.join(',')}`),
  stream('/api/stream'),
]);
const final = await json('/api/fomo/feed');
const health = await json('/api/health');
const report = {
  at: new Date().toISOString(), feed, main,
  fomo: { via: final.via, ageMs: Date.now() - final.t, error: final.error, items: final.items?.length },
  health: health.parts.filter(p => ['trades', 'fomochart', 'tunnel', 'responsiveness', 'backup'].includes(p.key)).map(({ key, state, summary }) => ({ key, state, summary })),
};
console.log(JSON.stringify(report, null, 2));
assert.equal(final.via, 'here');
assert.equal(feed.failures.length, 0);
for (const source of ['fomo', 'pump']) {
  assert.ok(feed.sources[source]?.events >= 2, `${source} must update more than once`);
  assert.ok(feed.sources[source].last > feed.sources[source].first, `${source} timestamps must advance`);
}
assert.ok(Object.values(main.counts).reduce((a, b) => a + b, 0) >= 2, 'market stream must keep delivering');
