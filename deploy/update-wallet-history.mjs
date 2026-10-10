// Run on the VM as root. Patch only reconciled history; preserve all wallet data and other code.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const root = '/opt/blix-live-vault', vaultPath = root + '/server/vault.js', serverPath = root + '/server/server.js';
const originalVault = fs.readFileSync(vaultPath, 'utf8'), originalServer = fs.readFileSync(serverPath, 'utf8');
const oldRoute = 'return send(res, 200, vault.txsOf(id));';
if (originalVault.includes('export async function historyOf(')) throw Error('History update already installed; review before changing it.');
if (!originalServer.includes(oldRoute)) throw Error('Unexpected vault route; no files changed.');
const db = new DatabaseSync('/var/lib/blix-vault/data/vault.db', { readOnly: true });
const active = db.prepare("SELECT COUNT(*) n FROM txs WHERE status = 'sent' AND t > ?").get(Date.now() - 120000).n;
db.close();
if (active) throw Error('A recent transaction is still being checked; retry after it settles.');
const insertion = `const historyReads = new Map();
export async function historyOf(userId) {
  if (!busyWallets.has(userId)) {
    if (!historyReads.has(userId)) historyReads.set(userId, reconcile(userId).finally(() => historyReads.delete(userId)));
    await historyReads.get(userId);
  }
  return txsOf(userId);
}
`;
const anchor = 'export const allTxs =';
if (!originalVault.includes(anchor)) throw Error('Unexpected vault source; no files changed.');
const backup = root + '/deploy-backups/history-' + Date.now();
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
fs.writeFileSync(backup + '/vault.before.js', originalVault);
fs.writeFileSync(backup + '/server.before.js', originalServer);
fs.writeFileSync(backup + '/vault.next.mjs', originalVault.replace(anchor, insertion + anchor));
fs.writeFileSync(backup + '/server.next.mjs', originalServer.replace(oldRoute, 'return send(res, 200, await vault.historyOf(id));'));
for (const name of ['vault', 'server']) execFileSync(process.execPath, ['--check', `${backup}/${name}.next.mjs`]);
try {
  fs.writeFileSync(vaultPath, fs.readFileSync(backup + '/vault.next.mjs'));
  fs.writeFileSync(serverPath, fs.readFileSync(backup + '/server.next.mjs'));
  execFileSync('systemctl', ['restart', 'blix-vault']);
  let healthy = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { if ((await fetch('http://127.0.0.1:4470/admin/api/state', { signal: AbortSignal.timeout(1000) })).ok) { healthy = true; break; } } catch {}
  }
  if (!healthy) throw Error('Vault health check failed.');
  console.log('Reconciled wallet history deployed; vault healthy. Backup: ' + backup);
} catch (e) {
  fs.writeFileSync(vaultPath, originalVault); fs.writeFileSync(serverPath, originalServer);
  execFileSync('systemctl', ['restart', 'blix-vault']);
  throw e;
}
