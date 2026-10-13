import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('diagnostic logs do not stall or throw under a real competing SQLite writer',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blix-event-log-'));
  process.env.RADAR_DATA=dir;
  const {db,logEvent,dbStats}=await import('../server/db.js');
  const other=new DatabaseSync(path.join(dir,'radar.db'));
  let locked=false;
  t.after(()=>{if(locked)other.exec('ROLLBACK');other.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const timeout=db.prepare('PRAGMA busy_timeout').get().timeout;
  other.exec('BEGIN IMMEDIATE');locked=true;
  const start=performance.now();
  assert.doesNotThrow(()=>logEvent('error','locked log fixture'));
  assert.ok(performance.now()-start<500,'logging must not consume the 15-second SQLite timeout');
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,timeout,'ordinary writes retain their timeout');
  assert.equal(dbStats.eventLog.queued,1);
  other.exec('ROLLBACK');locked=false;
  await new Promise(r=>setTimeout(r,650));
  assert.equal(db.prepare('SELECT count(*) AS n FROM events WHERE text=?').get('locked log fixture').n,1);
  assert.equal(dbStats.eventLog.queued,0);
});
