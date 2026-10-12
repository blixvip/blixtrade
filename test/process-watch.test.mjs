import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class Child extends EventEmitter {
  exitCode = null;
  signalCode = null;
  killed = false;
  signals = [];
  kill(signal) { this.signals.push(signal); this.killed = true; return true; }
  exit(code = 0, signal = null) {
    this.exitCode = code; this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

async function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  const { watchChild } = await import('../bin/process-watch.mjs');
  const child = new Child(), exits = [], hangs = [];
  const watch = watchChild(child, {
    probe: async () => true, onExit: (...args) => exits.push(args), onHang: (...args) => hangs.push(args),
    everyMs: 100, warmupMs: 0, missesBeforeKill: 4, killAfterMs: 50,
    ...options,
  });
  t.after(() => watch.stop());
  const tick = async ms => {
    t.mock.timers.tick(ms);
    // Let an async probe and its catch/finally bookkeeping settle before the next tick.
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return { child, exits, hangs, watch, tick };
}

test('four consecutive failed probes terminate only the watched child and escalate if it never exits', async t => {
  const h = await fixture(t, { probe: async () => false });
  for (let i = 0; i < 3; i++) await h.tick(100);
  assert.deepEqual(h.child.signals, []);
  await h.tick(100);
  assert.deepEqual(h.child.signals, ['SIGTERM']);
  assert.equal(h.hangs.length, 1);
  await h.tick(49);
  assert.deepEqual(h.child.signals, ['SIGTERM']);
  await h.tick(1);
  assert.deepEqual(h.child.signals, ['SIGTERM', 'SIGKILL']);
  await h.tick(1000);
  assert.deepEqual(h.child.signals, ['SIGTERM', 'SIGKILL'], 'A hanging child is escalated once');
  assert.equal(h.exits.length, 0, 'Termination requests alone do not prove the child exited');
});

test('a healthy response resets the count of consecutive failed probes', async t => {
  const replies = [false, false, false, true, false, false, false, false];
  const h = await fixture(t, { probe: async () => replies.shift() });
  for (let i = 0; i < 7; i++) await h.tick(100);
  assert.deepEqual(h.child.signals, []);
  await h.tick(100);
  assert.deepEqual(h.child.signals, ['SIGTERM']);
});

test('slow asynchronous probes never overlap and a thrown probe counts as a health miss', async t => {
  let calls = 0, resolve;
  const h = await fixture(t, {
    missesBeforeKill: 1,
    probe: () => {
      calls++;
      if (calls === 1) return new Promise(done => { resolve = done; });
      throw new Error('Health endpoint unavailable');
    },
  });
  await h.tick(100);
  await h.tick(1000);
  assert.equal(calls, 1, 'A pending health probe must not create more requests');
  resolve(true);
  await h.tick(0);
  await h.tick(100);
  assert.equal(calls, 2);
  assert.deepEqual(h.child.signals, ['SIGTERM']);
});

test('spawn error followed by exit finalizes once and passes the error to the restart callback', async t => {
  const h = await fixture(t);
  const error = new Error('spawn ENOENT');
  h.child.emit('error', error);
  h.child.exit(-2, null);
  await h.tick(1000);
  assert.equal(h.exits.length, 1);
  assert.equal(h.exits[0][2], error);
  assert.deepEqual(h.child.signals, []);
});

test('normal exit cancels probes and kill escalation while preserving exit code and signal', async t => {
  let calls = 0;
  const h = await fixture(t, { missesBeforeKill: 1, probe: async () => { calls++; return false; } });
  await h.tick(100);
  h.child.exit(null, 'SIGTERM');
  await h.tick(1000);
  assert.equal(calls, 1);
  assert.deepEqual(h.child.signals, ['SIGTERM'], 'An exited child must never receive SIGKILL');
  assert.equal(h.exits.length, 1);
  assert.equal(h.exits[0][0], null);
  assert.equal(h.exits[0][1], 'SIGTERM');
  assert.ok(h.exits[0][2] == null);
});

test('intentional stop terminates and escalates once without restarting the child', async t => {
  let calls = 0;
  const h = await fixture(t, { probe: async () => { calls++; return true; } });
  h.watch.stop();
  h.watch.stop();
  assert.deepEqual(h.child.signals, ['SIGTERM']);
  await h.tick(50);
  assert.deepEqual(h.child.signals, ['SIGTERM', 'SIGKILL']);
  h.child.exit(null, 'SIGKILL');
  await h.tick(1000);
  assert.equal(calls, 0);
  assert.equal(h.exits.length, 0);
  assert.equal(h.hangs.length, 0);
});

test('a late failed probe cannot terminate a child that already exited', async t => {
  let resolve;
  const h = await fixture(t, {
    missesBeforeKill: 1,
    probe: () => new Promise(done => { resolve = done; }),
  });
  await h.tick(100);
  h.child.exit(7, null);
  resolve(false);
  await h.tick(1000);
  assert.deepEqual(h.child.signals, []);
  assert.equal(h.exits.length, 1);
  assert.equal(h.exits[0][0], 7);
});

test('startup warmup does not mistake a booting application for a hung child', async t => {
  const h = await fixture(t, { warmupMs: 1000, missesBeforeKill: 1, probe: async () => false });
  for (let i = 0; i < 9; i++) await h.tick(100);
  assert.deepEqual(h.child.signals, []);
  await h.tick(200);
  assert.deepEqual(h.child.signals, ['SIGTERM']);
});
