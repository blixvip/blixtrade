# Pump callout integration — 2026-10-12

Scope: public documentation and public Pump web client inspection. No account access, credentials, posts, trades, or other remote mutations. This is feasibility research, not a working integration.

## Conclusion

Direct callout publishing is technically plausible: Pump's own web client contains a publishing endpoint. What remains unverified is a supported way for Blix to obtain each user's Pump publishing authorization. An internal endpoint does not establish a public API contract or permission to reuse sessions.

## Verified public client behavior

- Pump's public route contract declares `POST /callout/create`, a multipart body including `coinMint`, optional `thesis` limited to 2,000 characters, `version`, and `chainId`, with a response containing `callout.calloutId`. [Live contract bundle](https://pump.fun/_next/static/chunks/0ctwwwpm_zoke.js)
- Its web composer invokes that route through `getClientServerContract`, sends `credentials: 'include'`, uses version 2, handles expired-session responses, and checks `GET /callout/eligibility/{coinMint}`. This demonstrates a session-dependent publishing flow; a wallet address alone is insufficient. [Live composer bundle](https://pump.fun/_next/static/chunks/0rpt.8js6cpuz.js)
- Public assets inspected locally are under ignored `data/pump-callout-research`. Hashed bundle URLs may change at the next Pump deployment. No publishing request was executed.

## Published documentation

- Pump changed web sign-in on September 25, 2026 to email, Google, Apple, or GitHub. Its migration document explicitly says API sessions are unaffected. Therefore the web-login change does **not** prove API authentication is unavailable; it also does not document third-party callout delegation. [Pump sign-in changes](https://pump.fun/docs/wallet-login-changes)
- PumpPortal documents transaction, market-data, token-creation, wallet-creation, and creator-fee APIs. The reviewed documentation did not establish a callout-publishing API. PumpPortal trading credentials must not be assumed to authorize Pump social posts. [PumpPortal documentation](https://pumpportal.fun/), [creation API](https://pumpportal.fun/creation/), [trading API](https://pumpportal.fun/trading-api/)
- Searches of Pump's public documentation did not establish a supported OAuth publishing scope or a deep link that pre-fills and submits a callout. This is a research limitation, not proof that no partner or undocumented interface exists.
- Callout participation requires a Pump account in good standing. Rewards, if any, are discretionary USDC distributions to the account-associated wallet or an external address where Pump offers that option. Posting through Blix would not itself redirect rewards into Blix creator fees. The callout terms prohibit automation intended to inflate measured activity; they do not establish approval for a third-party posting client. [Callout terms, sections 3, 7, 8, and 10](https://pump.fun/docs/callout-reward-terms)

## Engineering recommendation and remaining verification

1. **Preferred product integration:** obtain a documented Pump authorization/delegation mechanism, then implement account linking, eligibility checks, explicit user submission, and response-based success. This requires further evidence; do not advertise native publishing yet.
2. **Practical desktop prototype:** a user-installed companion extension can receive a draft from the allowlisted Blix site and fill the signed-in Pump composer. Chrome documents webpage-to-extension messaging and content-script access to a page's DOM. Actual Pump form compatibility and submission behavior still need a controlled test. Keep the Pump session in the user's browser and display the destination account before posting. [Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#external-webpage), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
3. **Current fallback:** draft in Blix, then open Pump and paste. This remains usable without asserting an unverified authentication integration.

The extension approach is an engineering inference, not a Pump-supported integration claim. It would require installation and maintenance as Pump's UI changes. A successful draft transfer must not be shown as a published callout; success needs a verified Pump result.

## Authentication, browser access, and embedding

- The public client's `getClientServerUrl()` resolves to `https://frontend-api-v3.pump.fun`, making the observed write route `https://frontend-api-v3.pump.fun/callout/create`. [Client configuration bundle](https://pump.fun/_next/static/chunks/0gx98fjg~v56~.js)
- A read-only `OPTIONS /callout/create` check on October 12 returned HTTP 204 with `Access-Control-Allow-Origin: https://pump.fun` and credentials allowed for Pump's origin. The same check with origin `https://blixvip.com` returned HTTP 403 without an allow-origin header. Recorded in ignored `data/pump-callout-research/cors.json`. Consequently direct cross-origin browser calls from Blix are blocked under the observed configuration; a proxy alone would not solve authorization.
- The inspected Pump coin response included `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'`. Embedding that page inside a Blix iframe is blocked by the observed headers. [Inspected Pump coin page](https://pump.fun/coin/9stanqrVUsQ2j7KxdEUXCN1EWes2eXi7hSQYJHRBpump)
- **Most concrete next prototype:** Blix passes a user-reviewed draft to an installed companion extension; it operates through the user's signed-in Pump tab, checks the destination account and eligibility, and returns a permalink only after Pump confirms publication. This is an inference from the browser capabilities and first-party client, not a completed end-to-end test. No private keys or Pump sessions need to be collected by Blix's server for this design.

No authenticated publishing was tested. The research establishes an internal route and browser restrictions, not a supported third-party publishing agreement or working native integration.
