import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertBackupSpace, trimImageCache } from '../bin/storage-guard.mjs';

const GB = 1024 ** 3;
test('backup reserves database-copy space, WAL headroom, and 6 GiB free', () => {
  assert.throws(() => assertBackupSpace(3 * GB, 11 * GB), /Backup skipped/);
  assert.doesNotThrow(() => assertBackupSpace(3 * GB, 12 * GB));
});

test('cache eviction removes oldest generated images but preserves fresh files and member data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-storage-test-'));
  const img = path.join(root, 'img'); fs.mkdirSync(img);
  const now = Date.now();
  const put = (name, age) => {
    const file = path.join(img, name); fs.writeFileSync(file, '1234567890');
    fs.utimesSync(file, new Date(now - age), new Date(now - age)); return file;
  };
  try {
    const old = put('old.webp', 3 * 3600_000);
    const newer = put('newer.png', 2 * 3600_000);
    const fresh = put('fresh.webp', 1000);
    const unknown = put('member-data.json', 3 * 3600_000);
    fs.mkdirSync(path.join(img, 'nested')); fs.writeFileSync(path.join(img, 'nested', 'keep.png'), 'keep');
    fs.mkdirSync(path.join(root, 'profiles')); fs.writeFileSync(path.join(root, 'profiles', 'keep.png'), 'keep');
    const result = trimImageCache(root, { budget: 20, now });
    assert.equal(result.removed, 1); assert.equal(fs.existsSync(old), false);
    for (const f of [newer, fresh, unknown, path.join(img, 'nested', 'keep.png'), path.join(root, 'profiles', 'keep.png')]) assert.ok(fs.existsSync(f));
    const pressure = trimImageCache(root, { budget: 1000, pressure: true, available: () => 0, now });
    assert.equal(pressure.removed, 1); assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(unknown));
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
