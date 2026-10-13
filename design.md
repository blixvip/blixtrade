# Design — Blix

The product is **Blix**. Its full name is **Blix Trade**; everything a person sees says Blix.

The locked design system for this app. Every page reads from it. Do not pick a new
look per page: extend or amend this file when the system needs to grow.

## Genre
modern-minimal, dark. A trading instrument, not a marketing page: dense, flat, quiet,
and specific about numbers.

## Macrostructure family
Every route is an app page.

- App pages: **Workbench**. A fixed side rail, a one-line status bar, then the work:
  live columns (Pulse), ledgers and tables (Picks, Coins, Track record), or a feed
  beside a table (Signals). Detail opens in a side sheet over the page, never a new page.
- Marketing pages: none.
- Content pages: Briefs only. Typography, one column.

Nav: N3 side rail (collapses to a bottom bar on phones). Footer: none.

## Theme
**Liquid chrome on black** (2026-10-04, replaces the cobalt palette). The brand is the chrome BLIX
wordmark (`public/brand/`, `web/public/brand/`): molten silver lettering glowing on a pure black
ground. The interface is that picture turned into a tool. Axes: dark / grotesk-sans / cold neutral.

- `--color-paper`    oklch(6% 0.003 255)     the ground: black
- `--color-paper-2`  oklch(10.5% 0.004 255)  chrome: rail, headers, sheet
- `--color-paper-3`  oklch(14% 0.005 255)    cards
- `--color-paper-4`  oklch(18% 0.006 255)
- `--color-paper-5`  oklch(23% 0.007 255)    selected control
- `--color-ink`      oklch(96% 0.004 255)
- `--color-ink-2`    oklch(79% 0.008 255)
- `--color-muted`    oklch(62% 0.010 255)
- `--color-rule`     oklch(21% 0.006 255)
- `--color-rule-2`   oklch(32% 0.008 255)
- `--color-edge`     oklch(100% 0 0 / 0.13)  the lit top edge of a panel
- `--color-accent`   oklch(90% 0.012 250)    chrome: selection, focus, links, the AI. A light, not a hue.
- `--color-focus`    oklch(98% 0.004 250)

The metal (three gradients, defined once in the token files, never re-mixed per component):

- `--chrome`       full strip: white, silver, a dark horizon at the middle, light bouncing back up
- `--chrome-type`  the same for lettering, brighter with a softer horizon
- `--chrome-soft`  for filled controls

Where metal goes, and nowhere else:

- the wordmark (always the image, never retyped in a font);
- page titles and the lead figures in a header (`.chrome-text`), heavy weights only;
- the selected choice in a group and a button under the pointer (`.chrome-fill`); one filled chrome control per view at rest;
- panel and column-header edges: a lit hairline on top, falling to black (`.surface`, `.metal-bar`).

Body text, table numbers and row content are plain ink on black: metal is the frame, the data stays flat.
The background field (React page) is the same light: silver over graphite, never coloured.

Data colours. They mean one thing each and are used for nothing else:

- `--color-up`      oklch(74% 0.15 160)   price up, a win, passed
- `--color-down`    oklch(67% 0.20 18)    price down, a loss, failed
- `--color-warn`    oklch(82% 0.14 85)    needs attention
- `--color-caution` oklch(73% 0.15 50)    grade D, weak

## Typography
- Display: Space Grotesk, weight 600, roman. Headings, the wordmark, lead figures.
- Body: the system sans (Segoe UI Variable on Windows), weight 400–600. Everything else,
  including every table number (tabular figures).
- Outlier: JetBrains Mono. Contract addresses and code only.
- Display tracking: -0.02em. Small capital labels: +0.045em. Body: 0.
- No italic headings. Emphasis is weight or the accent.
- Type scale anchor: `--text-display` = 1.75rem. This is a dense tool; page titles are `--text-xl`.

## Spacing
4-point named scale in `public/tokens.css` (`--space-3xs` … `--space-2xl`). New rules use
the names. Older rules in `styles.css` still carry raw pixel paddings; move them onto the
scale when a rule is touched.

## Motion
- Easings: `--ease-out` cubic-bezier(0.16, 1, 0.3, 1), `--ease-in`, `--ease-in-out`. No bounce on interface state.
- The side sheet moves on a spring and may overshoot slightly only after it is thrown.
- No scroll reveals. New rows slide in once; prices flash once when they change.
- Reduced motion: no travel, opacity only, under 150 ms.

## Microinteractions stance
- Feedback on the press, not the release.
- Silent success. A toast is for a failure or for something that happened out of sight.
- Focus rings appear instantly, 2 px, `--color-focus`.
- Disabled is opacity + `not-allowed` cursor + the `disabled` attribute.

## CTA voice
- Primary: chrome fill (`--chrome-soft`), dark label, 6 px radius. One per view at most.
- Secondary: 1 px `--color-rule-2` outline on `--color-paper-4`, 6 px radius.
- Labels are verbs and stay on one line.

## Surfaces
- Solid only. No blur, no translucency. The only gradients are the metal named in Theme, used where Theme says; the only glow is the wordmark's own.
- One layer of containment. Inside a card or the sheet, groups are separated by a
  hairline rule, not boxed again.
- No side stripes. A state is a tint plus a full hairline, or a small square beside the label.
- Other gradients are allowed only where they carry data: the bonding-progress ring and the loading skeleton.

## Icons
One hand-drawn SVG line set (the rail icons and the row glyphs). No emoji as icons.

## Per-page allowances
- App pages MUST NOT use enrichment. Function carries the page.
- Coin pictures are content. A coin without one gets a generated picture; those are images
  with their own fixed inks, not interface colour.

## What pages MUST share
- The wordmark, the rail, the status bar.
- The accent and where it goes (selection, focus, links, AI activity).
- The two faces and the label style (small capitals, +0.045em).
- The control shapes: 6 px controls, 8 px cards, 4 px chips.

## What pages MAY differ on
- The work area: columns, a ledger, a feed beside a table, a form.

## Known gaps
- Paddings in the older part of `styles.css` are not on the named scale yet.
- The generated coin pictures use fixed colours inside SVG data (see allowances).
- Coin pictures are served at their original size; large originals load slowly.

## Exports

### tokens.css
The live file is `public/tokens.css`. It is the source of truth.

### Tailwind v4 `@theme`
```css
@theme {
  --color-paper: oklch(15.5% 0.008 258);
  --color-ink: oklch(93% 0.006 258);
  --color-accent: oklch(70% 0.15 255);
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-body: system-ui, "Segoe UI Variable Text", sans-serif;
  --spacing-md: 1rem;
  --text-md: 0.875rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`
```json
{
  "color": {
    "paper": { "$value": "oklch(15.5% 0.008 258)", "$type": "color" },
    "ink": { "$value": "oklch(93% 0.006 258)", "$type": "color" },
    "accent": { "$value": "oklch(70% 0.15 255)", "$type": "color" },
    "up": { "$value": "oklch(74% 0.15 160)", "$type": "color" },
    "down": { "$value": "oklch(67% 0.20 18)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk", "$type": "fontFamily" },
    "body": { "$value": "system-ui", "$type": "fontFamily" }
  },
  "space": { "md": { "$value": "1rem", "$type": "dimension" } }
}
```

### shadcn/ui CSS variables
```css
:root {
  --background: 15.5% 0.008 258;
  --foreground: 93% 0.006 258;
  --primary: 70% 0.15 255;
  --primary-foreground: 16% 0.03 255;
  --muted: 25% 0.012 258;
  --muted-foreground: 67% 0.014 258;
  --border: 25% 0.012 258;
  --input: 33% 0.014 258;
  --ring: 74% 0.15 255;
  --radius: 6px;
}
```

## Pulse rows (v8, 2026-10-02)
A row is four fixed lines beside a 44px picture with the bonding ring:
1. ticker (650) · name (muted, ellipsis) … **market cap** (650)
2. age (up colour, live dot) · launchpad (small coloured square + lowercase name) · venue after bonding · links · contract … volume · 1m change
3. the stat strip: holders · top 10 % · dev % · DEV SOLD · snipers % · bundle % · dev ×N · TX · 5m window. Labels muted, values ink-2, a bad value in the down colour. No borders.
4. **rank** (traction 0–100: a small filled square, up colour at 60+) · triage word · AI call (grade colour, no pill) · verdict (muted, one line) … actions: `B 0.25` (outlined, fills on hover), `read ›` (accent link), `Fomo` (muted link).

Nothing in a row is a bordered chip; the only controls are the three actions. Compact mode drops the verdict text and the contract. Column headers are 32px, small capitals, hairline-separated; columns have no radius.

## Shell and Pulse rows (v9, 2026-10-04): the owner's mockup. This supersedes the earlier "Pulse rows" and "Nav: N3 side rail".
The owner sent a full-page mockup (a trading terminal in the Axiom layout, with the chrome BLIX wordmark) and said: "it should look exactly like this but for solana only". Do not simplify this back to plain text rows or a side rail unless he asks.

**Shell (new front end, `web/src/shell/Rail.tsx`)**
- Top bar, 60px: wordmark · page links (Discover, Pulse, Trackers, Signals, Picks, Research, Portfolio, More) with an ink underline on the current page · search pill ("Search by token or CA", `/` focuses it) · SOL pill · white `Deposit` pill · wallet pill (SOL balance, or "Sign in") · account circle.
- Tape, 32px: what is running now (picture, ticker, market cap, 1m change).
- Status bar, 36px, along the bottom: Wallet · Pulse · PnL · Health, then SOL price, launches/min, trades/sec, AI queue, the background effect switch, and the LIVE pill.
- Solana only: no chain switcher.

**Pulse**
- Three columns in one panel, divided by hairlines: New Pairs, Final Stretch, Migrated. No "Running now".
- Column header, 48px: title (18px, 600) · search pill · quick-buy pill (lightning, size in SOL, P1 P2 P3 presets kept per column).

**Row, 116px**
- Left: 68px picture framed by bonding progress (up colour), launchpad dot on its corner, short contract under it.
- Line 1: ticker (18px, 600) · name (muted, same size) · copy … `V` volume · `MC` market cap. Market cap is coloured by size: info under $30K, warn under $150K, up above.
- Line 2: age (up colour) · icon links (launchpad, website, Telegram, search on X) · icon + number for holders, live traders, rank … 1m change · `TX` count with the buy/sell bar.
- Line 3: `@handle` (info colour) · the AI call with its icon · its one-line verdict (muted).
- Line 4: audit pills (icon + figure, up = pass, down = fail): top-10 share, dev share or `DS`, snipers, bundle, serial-dev count, 5-minute net SOL, and a red pill when the price is stale or the pool is emptied … the quick-buy pill (chrome fill, lightning, size + SOL).
- A figure Blix has no source for (X followers, watchers, fees paid, insiders) is left out, never faked.

**Shell amendment (2026-10-04, later the same day):** after seeing the top nav the owner said "I like it with the side part better". The new front end is back on the N3 side rail, in classic Blix's order (Pulse, Signals, Picks, Research, Narratives, Coins, Wallets, Briefs, Track record, Health, API, MCP, Account; Settings at the bottom with the connection state). The strip across the top of the page keeps the tape, search, Deposit and the wallet. The three-column Pulse and its rows are unchanged.

## Wallet tracker palette (2026-10-12)

The tracker uses a scoped, Axiom-inspired terminal palette at the user's request: graphite `#101218` / `#151820`, restrained sapphire selection `#a5baff`, mint buys `#65deb3`, and pink sells `#ff899c`. Priority groups carry blue, amber, and lilac markers plus P1/P2/P3 labels. User-selected wallet colors and emoji identify wallets consistently in Manager and the live feed; they are content, not general UI icons.

The palette is defined in `web/src/components/wallet-tracker.css` under `.wt-theme`; the surrounding app retains its theme. Tracker body text stays 12–14 px regardless of the page's automatic density setting. The title bar and enlarged corner handle remain draggable; compact layouts use container queries so they respond to the window's size as well as the screen.
