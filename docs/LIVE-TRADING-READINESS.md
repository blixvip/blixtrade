# Hosted wallets — live, 2026-10-08

## Trading follow-through — deployed 2026-10-08

- Account balances and history refresh every ten seconds while visible, on window focus, and after a wallet action. Funded accounts in Paper mode show an explicit **Trade with real SOL** action; it changes mode without submitting a trade.
- Quick trade, account buy/sell/withdraw, and conversion share submission locking and confirmed/failed/pending notices. A lost response or ambiguous status never reports success. Withdrawal reauthentication still applies.
- Reading wallet history now reconciles unresolved signatures without initiating another spend. Active submissions are left alone; concurrent history reads share reconciliation. Keys and account bindings are unchanged.
- Validation: 38 vault tests, 15 account/access tests, 28 desktop/mobile quick-trade cases, six account-flow cases, and five onboarding viewport checks passed. Production dependency audit: zero findings. Screenshots inspected on desktop/mobile.
- Live provider check passed RPC, blockhash, SOL price and Jupiter quote. Unsigned live-chain simulation run: 21 passed, four failed (three moving-curve/slippage cases and one RPC rate limit). No signatures or broadcasts. This is not proof that all coins fill, nor a funded end-to-end trade.
- Vault rollback sources: `/opt/blix-live-vault/deploy-backups/history-1791501104463`. Only `server/vault.js` and `server/server.js` changed on the signer; service health passed after restart.

## Automatic onboarding update — deployed 2026-10-08

Signed-in users without a wallet now enter automatic setup, see a creation animation, then a funding prompt. Setup accepts an empty body; retries reuse the same wallet. New records keep the legacy consent timestamp at zero rather than claiming user acceptance. Ownership notices were removed from sign-in, creation and account screens, including the classic sign-in screen.

Hosted accounts show wallet details and actions directly; they no longer request the unsupported legacy profile endpoint that produced a member-access error on this screen.

Verified 33 targeted account/access/OAuth tests and browser layouts at 320, 390, 768, 1024 and 1440px. `scripts/hosted-wallet-onboarding-live-check.mjs` created a fresh real, unfunded wallet through the deployed UI and vault with a synthetic signed identity, verified the matching deposit address/QR at 1440px and 390px, and confirmed repeated setup returns that address. The test wallet was frozen and labeled internal. No funds were sent. The harness uses the origin server with production page-origin headers; it does not exercise a customer's Google browser session. Deployed read-only checks also passed for missing/forged wallet proof and public isolation.

Frontend rollback index: `/opt/blix/data/wallet-auto-release/index-before-copy-removal.html`. Classic rollback: `classic-account-before-copy-removal.js` in that directory. The remaining rollout notes describe the earlier wallet release.

Hosted custodial wallets are enabled for signed-in members at https://blixvip.com/app#/account. Users complete Google sign-in, accept the custody disclosure, create their own Solana wallet, deposit SOL, and turn Paper mode off to trade. Blix holds encrypted keys; the operator has administrator access. No real funds were deposited, transferred, or traded during this rollout.

## Deployed

- `blix-vault.service`: dedicated `blix-vault` Linux user; signer bound only to `127.0.0.1:4470`; code `/opt/blix-live-vault`; keys `/var/lib/blix-vault/keys`; ledger `/var/lib/blix-vault/data/vault.db`.
- Blix accesses the signer with the private `/opt/blix/data/vault-client.json` token. The public application cannot select another user's vault ID. Verified Google subject maps to an individual wallet in `accounts.db` / `hosted_accounts`.
- Worker version `2c03bbae-0e77-4a69-a912-534043146079` issues signed, HttpOnly wallet identity cookies. VM verifies signature, email binding, expiry and subject. Withdrawal/export requires completion of Google OAuth in the previous ten minutes. This is recent OAuth completion, not a guarantee of a newly entered Google password or MFA challenge.
- Setup requires explicit custodial consent. A repeated/concurrent request returns the same wallet. A different Google subject cannot claim an existing email's wallet.
- User actions include balances, deposits, buy/sell, transaction history, SOL withdrawal and key export. Owner dashboard includes wallet list, balances, freeze/unfreeze, transactions, audit log and password-confirmed key export. Private keys disappear from the dashboard DOM on close/sign-out.
- Trade limits: 2 SOL per buy, 50 SOL per withdrawal, default 3% slippage, 0.005 SOL trading fee reserve. User-supplied trade slippage remains bounded by the vault.
- Uncertain submissions retain their known signature and pending state; another spend is blocked until reconciliation. Only confirmed trades are labeled successful. RPC reads are paced and transient failures receive bounded retries; broadcasts retain the existing identical-transaction submission path.
- Existing PC wallet keys/accounts were not migrated or changed. Only its configured RPC provider credentials were reused for the new VM signer.

## Owner access

Private local directory: `C:\Users\kaigu\.blix-wallet-admin` (owner/SYSTEM ACL).

Run `Open Wallet Admin.ps1` to open an SSH tunnel and the dashboard at `http://127.0.0.1:14470`. Password is in `Admin credentials.txt`. SSH authenticates with the existing VM key. The dashboard is not exposed through the public website.

Do not manually pre-create Google users through Add user: normal signup binds the stable Google subject automatically. A legacy manually added email cannot be silently claimed by another identity.

## Recovery

- VM creates encrypted snapshots every 15 minutes using `blix-wallet-backup.timer`. Snapshots contain consistent SQLite backups of `vault.db` and `accounts.db`, plus the master key and signer config.
- Each snapshot uses AES-256-GCM; its random encryption key is encrypted with the recovery RSA public key. The VM holds only the public recovery key at `/etc/blix-wallet-recovery.pub`.
- Private recovery key: `C:\Users\kaigu\.blix-wallet-admin\recovery-private.pem`. Preserve it separately from the VM. Losing it prevents opening recovery archives.
- Scheduled task `Blix Hosted Wallet Recovery Backup` pulls and verifies snapshots every 15 minutes while Kai is signed into this PC. Copies are in the private directory's `backups` folder; `backup-status.json` records the last result. If the PC is off or signed out, off-VM copies do not refresh. VM-local backups continue. This is not an independently hosted cloud backup.
- Both sides retain up to 672 timestamped archives. Keep an additional protected copy of the recovery key and recovery archives on independent storage.
- Restore by decrypting with `openBackup` in `blix-vault/server/backup.js`, writing the named files in a private staging directory, verifying SQLite integrity, and checking every wallet seed against its stored address before replacing stopped services' data. Restore account bindings with the matching vault snapshot; never create a new master key over an existing wallet database. The vault refuses that condition.

## Verification

- 125 application/auth/identity/OAuth tests passed.
- 36 vault tests passed: key encryption/signing, transaction construction, uncertain submission recovery, concurrent-spend rejection, admin access, backup restoration and RPC retry/pacing.
- Hosted setup and owner dashboard tested at 1440px and 390px. Checked consent, retry, deposit address, Paper toggle, access isolation, password confirmation, secret cleanup and layouts.
- Live VM checks: signer loopback binding; real RPC/blockhash/SOL price/Jupiter quote; missing/forged identity refusal; public account access refusal; hosted consent on both widths; actual admin login/logout on both widths. An internal unfunded account exercised live consent enforcement, wallet creation, idempotent repeat setup, balance reads, empty transaction history and administrator visibility. It remains clearly labeled and frozen; no customer funds or signing were involved.
- Encrypted live archive downloaded, decrypted and restored; both databases passed integrity_check. The internal test wallet's encrypted key was unlocked and verified against its stored address, and its restored account binding matched. Separate synthetic recovery tests verify committed WAL rows, all key/config bytes, tamper rejection and wrong recovery keys.
- Original unsigned suite passed 23 simulations locally. VM stress run exposed provider429 failures, prompting pacing/retry fixes. After that, broad VM run passed18 and failed3 on a rapidly moving mayhem coin (one quote delta >15%, two on-chain slippage refusals); assertions were retained. Targeted final VM run passed8/8 on two PumpSwap pools (SPL and Token2022), including new buys, half/full sells and additional buys. This does not guarantee every coin remains fillable as markets move.
- Production dependency audit reported zero vulnerabilities. The vault has no third-party runtime packages.

The first funded buy, sell and withdrawal remain user-executed verification. Unsigned simulations and the internal live setup test do not prove a funded end-to-end trade or a customer's Google browser session.

## Reproduce / rollback

`npm test` in both repositories. Browser scripts: `scripts/hosted-wallet-check.mjs`, `scripts/hosted-wallet-live-check.mjs`, `scripts/wallet-admin-live-check.mjs`; vault `scripts/admin-wallet-check.mjs`. VM provider-only check: `bin/health.mjs`; unsigned simulations: `test/sim.mjs`. Never use funded transactions as an automated smoke test.

App rollback copies: `/opt/blix/data/hosted-wallet-release/rollback-1791493351281`. Preserve all wallet databases and keys during any rollback. Disabling `hostedWallets` removes public wallet access but must not delete wallets. Existing hashed frontend assets were retained; concurrent frontend updates were not overwritten.
