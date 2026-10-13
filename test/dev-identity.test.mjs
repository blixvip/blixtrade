import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDevIdentityLookup } from '../server/dev-identity.js';
import { avatarColor } from '../public/avatar-colors.js';
test('known devs use verified wallet identities, never Fomo account addresses or one-swap guesses', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE fomo_wallets(uid TEXT,handle TEXT,wallet TEXT,matches INTEGER,checked INTEGER); CREATE TABLE fomo_profiles(uid TEXT,data TEXT); CREATE TABLE fomo_board(uid TEXT,name TEXT,pic TEXT,t INTEGER); CREATE TABLE pump_people(wallet TEXT,name TEXT,pic TEXT,followers INTEGER,x TEXT);
      INSERT INTO fomo_wallets VALUES('one','known','real-wallet',2,1),('two','guess','unverified',1,1);
      INSERT INTO fomo_profiles VALUES('one','{"name":"Known Dev","pic":"https://example.com/face.png"}');
      INSERT INTO pump_people VALUES('pump-wallet','Pump Dev','https://example.com/pump.png',200,'pumpdev');`);
    const lookup=createDevIdentityLookup(db);
    assert.equal(lookup('real-wallet').name,'Known Dev');
    assert.equal(lookup('real-wallet').pic,'https://example.com/face.png');
    assert.equal(lookup('pump-wallet').name,'Pump Dev');
    assert.equal(lookup('one'),null);
    assert.equal(lookup('unverified'),null);
    assert.equal(lookup('unknown'),null);
  } finally { db.close(); }
});
test('unknown wallet logo colours are stable and varied', () => {
  assert.equal(avatarColor('wallet123'),avatarColor('wallet123'));
  assert.ok(new Set(Array.from({length:100},(_,i)=>avatarColor(`wallet${i}`))).size>=16);
});
