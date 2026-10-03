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
Custom, tuned: "cool engineered trading terminal, dark". Axes: dark / grotesk-sans / cool.

- `--color-paper`    oklch(15.5% 0.008 258)
- `--color-paper-2`  oklch(17.5% 0.009 258)  chrome: rail, headers, sheet
- `--color-paper-3`  oklch(19.5% 0.010 258)  cards
- `--color-paper-4`  oklch(22.5% 0.012 258)
- `--color-paper-5`  oklch(26% 0.014 258)    selected control
- `--color-ink`      oklch(93% 0.006 258)
- `--color-ink-2`    oklch(76% 0.012 258)
- `--color-muted`    oklch(67% 0.014 258)
- `--color-rule`     oklch(25% 0.012 258)
- `--color-rule-2`   oklch(33% 0.014 258)
- `--color-accent`   oklch(70% 0.15 255)     cobalt: selection, focus, links, the AI
- `--color-focus`    oklch(74% 0.15 255)

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
- Primary: ink fill, dark label, 6 px radius. One per view at most.
- Secondary: 1 px `--color-rule-2` outline on `--color-paper-4`, 6 px radius.
- Labels are verbs and stay on one line.

## Surfaces
- Solid only. No blur, no translucency, no glow, no decorative gradient.
- One layer of containment. Inside a card or the sheet, groups are separated by a
  hairline rule, not boxed again.
- No side stripes. A state is a tint plus a full hairline, or a small square beside the label.
- Gradients are allowed only where they carry data: the bonding-progress ring and the loading skeleton.

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
