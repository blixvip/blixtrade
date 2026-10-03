# Contributing to Blix

Thanks for looking. Blix is a small, dependency-free Node codebase, so most changes are a single file and a test.

## Ground rules

1. **No dependencies.** Node 24 ships SQLite, fetch, websockets, test runner and everything else Blix needs. A PR that adds `node_modules` needs a very good reason.
2. **Every data source goes through the safety policy.** New feeds, new signal types and new AI calls must pass `server/quality.js` before they can raise a positive signal. Unscreened data is fine as long as it is labelled and kept apart.
3. **Honest numbers.** Any rate is shown as a count over the number actually checked. Emptied pools count as 0x. Never present price moves as profit.
4. **The design system is locked.** Read `design.md` before touching `public/`. New rules use the tokens in `public/tokens.css`. No new colours, no new fonts, no marketing pages.
5. **Nothing signs transactions.** Blix watches, grades, alerts and paper-trades. Execution stays in the user's own wallet app.

## Dev loop

```bash
git clone https://github.com/blixvip/blixtrade.git
cd blixtrade
RADAR_DATA=./data-dev RADAR_PORT=4421 npm start   # isolated copy, own database
npm test                                          # 30 tests, no network
```

`bin/replay.mjs` runs entry and exit rules over the recorded second-by-second trade tapes, so a rule change is judged on coins it never saw.

## Pull requests

- One change per PR. Describe what you saw, what you changed, how you verified it.
- Add or update a test in `test/radar.test.mjs` for anything in `server/`.
- Screenshots for anything in `public/`, taken at 1600px wide and at phone width.
- Keep the wording in the UI plain and specific. "Pool emptied" beats "liquidity event".

## Reporting bugs

Use the bug template. Include the **Health** page's output and the relevant lines from `data/logs/`. Never paste webhook URLs, bot tokens or keys.

## Ideas

Open a discussion or an issue with the feature template. The [roadmap](README.md#roadmap) lists what is already planned.
