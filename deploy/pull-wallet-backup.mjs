import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openBackup } from '../../blix-vault/server/backup.js';
const dir = 'C:/Users/kaigu/.blix-wallet-admin';
fs.mkdirSync(dir + '/backups', { recursive: true });
try {
  const blob = execFileSync('ssh', ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@129.146.62.88', 'sudo -n cat /var/backups/blix-wallets/latest.sealed'],
    { timeout: 60_000, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  const payload = openBackup(blob.toString(), fs.readFileSync(dir + '/recovery-private.pem'));
  if (Date.now() - Date.parse(payload.created) > 45 * 60_000) throw Error('VM backup is stale');
  for (const name of ['vault.db', 'accounts.db', 'master.key', 'config.json']) if (!payload.files[name]) throw Error('Incomplete recovery archive');
  const stamp = payload.created.replace(/[:.]/g, '-');
  fs.writeFileSync(`${dir}/backups/wallets-${stamp}.sealed`, blob);
  fs.writeFileSync(dir + '/backups/latest.sealed', blob);
  fs.writeFileSync(dir + '/backup-status.json', JSON.stringify({ ok: true, checked: new Date().toISOString(), snapshot: payload.created }));
  const files = fs.readdirSync(dir + '/backups').filter(n => /^wallets-[\dTZ-]+\.sealed$/.test(n)).sort();
  for (const file of files.slice(0, -672)) fs.unlinkSync(dir + '/backups/' + file);
  console.log('Encrypted recovery copy downloaded and decrypted successfully for verification.');
} catch (e) {
  fs.writeFileSync(dir + '/backup-status.json', JSON.stringify({ ok: false, checked: new Date().toISOString(), error: e.message.split('\n')[0] }));
  throw Error('Wallet backup pull failed; check private backup-status.json');
}
