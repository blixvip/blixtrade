import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const exec=promisify(execFile);
const script=name=>fileURLToPath(new URL(`../bin/${name}`,import.meta.url));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blix-backup-safety-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
test('failed database copy preserves the previous completed backup',async t=>{
  const dir=fixture(t),src=path.join(dir,'invalid.db'),dest=path.join(dir,'previous.db');
  fs.writeFileSync(src,'not a database'.repeat(100));fs.writeFileSync(dest,'previous good copy');
  await assert.rejects(exec(process.execPath,[script('backup.mjs'),src,dest],{timeout:60000,windowsHide:true}));
  assert.equal(fs.readFileSync(dest,'utf8'),'previous good copy');
  assert.deepEqual(fs.readdirSync(dir).sort(),['invalid.db','previous.db']);
});
test('offsite archive is published only if every pipeline stage succeeds',{skip:process.platform==='win32'},async t=>{
  const dir=fixture(t),key=path.join(dir,'backup.key'),fake=path.join(dir,'bin');
  fs.writeFileSync(key,'fixture-encryption-key');fs.mkdirSync(fake);
  const db=new DatabaseSync(path.join(dir,'radar.db'));
  db.exec('CREATE TABLE fixture(value BLOB); INSERT INTO fixture VALUES(randomblob(8192));');db.close();
  fs.writeFileSync(path.join(dir,'settings.json'),'{}');
  fs.writeFileSync(path.join(fake,'rclone'),'#!/bin/sh\nexit 1\n',{mode:0o700});
  fs.writeFileSync(path.join(fake,'tar'),'#!/bin/sh\nhead -c 8192 /dev/urandom\nexit 42\n',{mode:0o700});
  const env={...process.env,RADAR_DATA:dir,BLIX_BACKUP_KEY:key,BLIX_SINK_URL:'',BLIX_SINK_KEY:'',PATH:fake+path.delimiter+process.env.PATH};
  await assert.rejects(exec(process.execPath,['--no-warnings',script('offsite-backup.mjs')],{env,timeout:60000}));
  const out=path.join(dir,'backups','off');
  assert.deepEqual(fs.readdirSync(out),[],'failed tar must not leave a published or partial backup');
  fs.unlinkSync(path.join(fake,'tar'));
  await exec(process.execPath,['--no-warnings',script('offsite-backup.mjs')],{env,timeout:60000});
  const archives=fs.readdirSync(out);assert.equal(archives.length,1);assert.match(archives[0],/\.tgz\.enc$/);
  const plain=path.join(dir,'restored.tgz');
  await exec('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-pass',`file:${key}`,'-in',path.join(out,archives[0]),'-out',plain]);
  const restore=path.join(dir,'restored');fs.mkdirSync(restore);
  await exec('tar',['-xzf',plain,'-C',restore]);
  const restored=new DatabaseSync(path.join(restore,'radar.db'),{readOnly:true});
  try{assert.equal(restored.prepare('SELECT length(value) AS n FROM fixture').get().n,8192);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{restored.close();}
});
