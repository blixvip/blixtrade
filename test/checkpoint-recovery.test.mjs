import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class Worker extends EventEmitter {
  unrefs = 0;
  terminations = 0;
  unref() { this.unrefs++; }
  terminate() { this.terminations++; return Promise.resolve(0); }
}

async function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  const { superviseCheckpoint } = await import('../server/checkpoint-watch.js');
  const workers = [], stats = [], fallbackStates = [];
  const stop = superviseCheckpoint({
    spawn: () => { const worker = new Worker(); workers.push(worker); return worker; },
    onStats: value => stats.push(value), fallback: value => fallbackStates.push(value),
    retryMs: 30, staleMs: 60, checkMs: 15, ...options,
  });
  t.after(stop);
  const tick = async ms => {
    t.mock.timers.tick(ms);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return { workers, stats, fallbackStates, stop, tick };
}

test('healthy checkpoint reports preserve statistics and disable SQLite fallback only while healthy', async t => {
  const h = await fixture(t);
  assert.equal(h.workers.length, 1);
  const first = { runs: 1, pages: 12, lastMs: 3 };
  h.workers[0].emit('message', first);
  assert.deepEqual(h.stats, [first]);
  assert.equal(h.fallbackStates.at(-1), false);
  for (let i = 0; i < 6; i++) {
    await h.tick(30);
    h.workers[0].emit('message', { runs: i + 2 });
  }
  assert.equal(h.workers.length, 1);
  assert.equal(h.workers[0].terminations, 0);
  assert.equal(h.fallbackStates.at(-1), false);
});

test('a later worker error restores autocheckpoint immediately and starts one replacement', async t => {
  const h = await fixture(t);
  const original = h.workers[0];
  original.emit('message', { runs: 1 });
  original.emit('error', new Error('Checkpoint worker crashed'));
  original.emit('exit', 1);
  assert.equal(h.fallbackStates.at(-1), true, 'A crash after startup must restore disk protection');
  await h.tick(29);
  assert.equal(h.workers.length, 1);
  await h.tick(1);
  assert.equal(h.workers.length, 2, 'Error followed by exit must not schedule duplicate workers');
  assert.equal(h.fallbackStates.at(-1), true, 'Spawning alone does not prove checkpoint recovery');
  h.workers[1].emit('message', { runs: 2 });
  assert.equal(h.fallbackStates.at(-1), false);
});

test('unexpected clean worker exit also enables fallback and retries', async t => {
  const h = await fixture(t);
  h.workers[0].emit('message', { runs: 1 });
  h.workers[0].emit('exit', 0);
  assert.equal(h.fallbackStates.at(-1), true);
  await h.tick(30);
  assert.equal(h.workers.length, 2);
});

test('a silent checkpoint worker is retired and replaced without waiting for an exit event', async t => {
  const h = await fixture(t);
  const original = h.workers[0];
  original.emit('message', { runs: 1 });
  await h.tick(45);
  assert.equal(original.terminations, 0);
  await h.tick(30);
  assert.equal(h.fallbackStates.at(-1), true);
  assert.equal(original.terminations, 1, 'Only the owned silent worker should be terminated');
  await h.tick(30);
  assert.equal(h.workers.length, 2);
  assert.equal(original.terminations, 1);
  assert.equal(h.workers[1].terminations, 0);
});

test('late messages and exit events from a retired worker cannot override replacement health', async t => {
  const h = await fixture(t);
  const original = h.workers[0];
  original.emit('message', { runs: 1 });
  original.emit('exit', 1);
  await h.tick(30);
  const replacement = h.workers[1];
  replacement.emit('message', { runs: 2 });
  original.emit('message', { runs: 999 });
  original.emit('exit', 1);
  assert.deepEqual(h.stats, [{ runs: 1 }, { runs: 2 }]);
  assert.equal(h.fallbackStates.at(-1), false);
  await h.tick(30);
  assert.equal(h.workers.length, 2);
  assert.equal(replacement.terminations, 0);
});

test('intentional stop terminates its owned worker once and cancels all replacement work', async t => {
  const h = await fixture(t);
  h.stop();
  h.stop();
  assert.equal(h.workers[0].terminations, 1);
  h.workers[0].emit('exit', 1);
  await h.tick(300);
  assert.equal(h.workers.length, 1);
  assert.equal(h.workers[0].terminations, 1);
});

test('stop during retry cancels the pending replacement', async t => {
  const h = await fixture(t);
  h.workers[0].emit('exit', 1);
  h.stop();
  await h.tick(300);
  assert.equal(h.workers.length, 1);
});

test('worker construction failure keeps fallback enabled and retries safely', async t => {
  let attempts = 0;
  const replacement = new Worker();
  const h = await fixture(t, {
    spawn: () => { if (++attempts === 1) throw new Error('Worker unavailable'); return replacement; },
  });
  assert.equal(h.fallbackStates.at(-1), true);
  await h.tick(30);
  assert.equal(attempts, 2);
  replacement.emit('message', { runs: 1 });
  assert.equal(h.fallbackStates.at(-1), false);
});
