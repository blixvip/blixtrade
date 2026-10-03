# Security policy

## Scope

Blix runs on your own machine, listens on localhost only, holds no private keys and signs no transactions. The sensitive surface is:

- the local HTTP server (`server/server.js`): origin and host checks, CSP, the remote-key gate;
- stored secrets in `data/settings.json`: Discord webhook, Telegram token, RPC URL, Groq key, tunnel key;
- the optional Cloudflare tunnel and Worker (`server/tunnel.js`, `worker/`);
- everything fetched from third parties (token metadata, websites, tweets) that is rendered in the page.

## Reporting

Please do not open a public issue for a vulnerability. Email the maintainer through the address on the [blixvip GitHub profile](https://github.com/blixvip), or open a private security advisory on this repository. Include steps to reproduce and the version (`git rev-parse HEAD`).

You will get an acknowledgement within a few days. Fixes ship as a normal commit with credit unless you prefer otherwise.

## Hardening checklist for operators

- Do not port-forward 4420. For remote access use the built-in tunnel (keyed) or a private VPN such as Tailscale.
- If you ever paste the remote link somewhere public, blank `remoteKey` in `data/settings.json` and restart; a new key is generated.
- Keep `data/` out of backups you share; it contains your settings file.
- Alerts can contain coin names and links from untrusted token metadata. Treat links in Discord / Telegram as untrusted.
