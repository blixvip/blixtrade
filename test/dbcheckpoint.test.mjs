import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

test('checkpoint worker preserves a pinned snapshot, then shrinks WAL and preserves committed writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-checkpoint-'));
  const file = path.join(dir, 'radar.db');
  const db = new DatabaseSync(file);
  let reader, worker;
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1)');
    reader = new DatabaseSync(file);
    reader.exec('BEGIN');
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
    db.exec('INSERT INTO t VALUES (2)');
    worker = new Worker(new URL('../server/dbcheckpoint.js', import.meta.url), { workerData: { file, everyMs: 20, maxWalBytes: 1 } });
    const next = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { clean(); reject(new Error('checkpoint timed out')); }, 5000);
      const clean = () => { clearTimeout(timer); worker.off('message', ok); worker.off('error', fail); };
      const ok = (m) => { clean(); resolve(m); };
      const fail = (e) => { clean(); reject(e); };
      worker.once('message', ok); worker.once('error', fail);
    });
    const pinned = await next();
    assert.equal(pinned.lastError, null);
    assert.equal(pinned.truncated, 0);
    assert.ok(fs.statSync(file + '-wal').size > 0);
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
    reader.exec('COMMIT');
    let result;
    for (let i = 0; i < 50; i++) { result = await next(); if (result.truncated) break; }
    assert.ok(result.truncated > 0);
    assert.equal(result.walBytes, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 2);
    db.exec('INSERT INTO t VALUES (3)');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 3);
  } finally {
    if (worker) await worker.terminate();
    reader?.close(); db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
