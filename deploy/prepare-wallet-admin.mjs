import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = 'C:/Users/kaigu/.blix-wallet-admin';
// Caller creates this directory with inheritance removed and owner/SYSTEM-only ACL first.
const existing = fs.existsSync(dir + '/recovery-private.pem');
const { privateKey, publicKey } = existing ? { privateKey: fs.readFileSync(dir + '/recovery-private.pem', 'utf8'), publicKey: fs.readFileSync(dir + '/recovery-public.pem', 'utf8') } : crypto.generateKeyPairSync('rsa', { modulusLength: 3072,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const password = existing ? fs.readFileSync(dir + '/Admin credentials.txt', 'utf8').match(/^Password: (.+)$/m)[1].trim() : crypto.randomBytes(24).toString('base64url'), salt = crypto.randomBytes(16);
const adminHash = `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
if (!existing) {
fs.writeFileSync(dir + '/recovery-private.pem', privateKey, { flag: 'wx' });
fs.writeFileSync(dir + '/recovery-public.pem', publicKey, { flag: 'wx' });
fs.writeFileSync(dir + '/Admin credentials.txt', 'Blix hosted wallet administrator\r\nOpen using Open Wallet Admin.ps1 in this directory.\r\nPassword: ' + password + '\r\n\r\nKeep recovery-private.pem outside the VM. Protect this directory; it controls recovery of every hosted wallet.\r\n', { flag: 'wx' });
}
const local = JSON.parse(fs.readFileSync(process.env.APPDATA + '/blix-vault/config.json', 'utf8'));
const result = execFileSync('ssh', ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', 'ubuntu@129.146.62.88', 'sudo -n /usr/bin/node /opt/blix/data/hosted-wallet-release/provision-wallets.mjs'],
  { input: JSON.stringify({ publicKey, adminHash, rpcUrl: local.rpcUrl, jupiterKey: local.jupiterKey }), encoding: 'utf8', windowsHide: true });
console.log(result.trim());
console.log('Owner credentials and recovery key saved in the private local administrator directory.');
