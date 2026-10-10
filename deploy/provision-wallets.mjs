// Run with sudo on the VM; provisioning input arrives via SSH stdin, never command arguments.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const home = '/var/lib/blix-vault/keys', client = '/opt/blix/data/vault-client.json';
if (fs.existsSync(home + '/config.json') || fs.existsSync('/etc/blix-wallet-recovery.pub')) throw Error('Already provisioned; refusing to replace recovery material');
try { execFileSync('id', ['blix-vault'], { stdio: 'ignore' }); }
catch { execFileSync('useradd', ['--system', '--home-dir', '/var/lib/blix-vault', '--shell', '/usr/sbin/nologin', 'blix-vault']); }
execFileSync('install', ['-d', '-m', '0700', '-o', 'blix-vault', '-g', 'blix-vault', '/var/lib/blix-vault', home, '/var/lib/blix-vault/data']);
execFileSync('install', ['-d', '-m', '0700', '/var/backups/blix-wallets']);
const settings = JSON.parse(fs.readFileSync('/opt/blix/data/settings.json'));
if (!(settings.rpcUrl || input.rpcUrl) || !settings.memberKey || settings.memberKey.length < 32) throw Error('Required RPC/member configuration missing');
const serviceToken = crypto.randomBytes(32).toString('base64url');
fs.writeFileSync(home + '/config.json', JSON.stringify({ port: 4470, adminTunnelPort: 14470, serviceToken, adminHash: input.adminHash,
  rpcUrl: settings.rpcUrl || input.rpcUrl, jupiterUrl: 'https://api.jup.ag', jupiterKey: settings.jupiterKey || input.jupiterKey || '', slippageBps: 300, maxSolPerTrade: 2, maxSolPerWithdraw: 50 }, null, 2), { mode: 0o600, flag: 'wx' });
execFileSync('chown', ['blix-vault:blix-vault', home + '/config.json']);
fs.writeFileSync(client, JSON.stringify({ port: 4470, serviceToken }), { mode: 0o600, flag: 'wx' });
execFileSync('chown', ['ubuntu:ubuntu', client]);
fs.writeFileSync('/etc/blix-wallet-recovery.pub', input.publicKey, { mode: 0o644, flag: 'wx' });
fs.mkdirSync('/etc/systemd/system/blix.service.d', { recursive: true });
// Clear the existing broad browser pkill hook; only restart the actual Blix unit.
fs.writeFileSync('/etc/systemd/system/blix.service.d/wallets.conf', '[Service]\nEnvironment=BLIX_VAULT_CONFIG=/opt/blix/data/vault-client.json\nExecStartPre=\n');
console.log('Dedicated service identity, client authentication and recovery public key installed.');
