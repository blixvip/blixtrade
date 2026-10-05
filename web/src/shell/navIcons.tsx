import type { ReactNode, SVGProps } from "react";

// The rail's icons: one two-tone set on a 24 px grid, all the same 1.8 stroke and round joins. Each has an
// outline and a soft filled body (class "duo"); the rail lights the body up for the page you are on.
// Shapes follow Lucide's metaphors (ISC licence) where one fits, redrawn to sit together.
const N = (duo: ReactNode, line: ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <g className="duo" fill="currentColor" stroke="none" opacity="0.16">{duo}</g>
    {line}
  </svg>
);

export const NavIcon = {
  // A stream of posts: the Fomo feed.
  feed: N(
    <rect x="3.25" y="3.75" width="17.5" height="16.5" rx="4" />,
    <><rect x="3.25" y="3.75" width="17.5" height="16.5" rx="4" /><circle cx="7.75" cy="8.6" r="1.35" fill="currentColor" stroke="none" /><path d="M11 8.6h5.75M7 15.4h9.75M7 12h6" /></>,
  ),
  // A compass: finding coins.
  discover: N(
    <circle cx="12" cy="12" r="9.25" />,
    <><circle cx="12" cy="12" r="9.25" /><path d="M15.6 8.4l-1.9 5.3-5.3 1.9 1.9-5.3z" fill="currentColor" fillOpacity="0.9" /></>,
  ),
  // A live heartbeat on a screen.
  pulse: N(
    <rect x="2.75" y="4.25" width="18.5" height="15.5" rx="4" />,
    <><rect x="2.75" y="4.25" width="18.5" height="15.5" rx="4" /><path d="M6 12h2.4l1.8-3.8 3.4 7.6 1.8-3.8H18" /></>,
  ),
  // A flame: what is running hot.
  narratives: N(
    <path d="M12 21.25a6.75 6.75 0 0 1-6.75-6.75c0-2.6 1.5-4.3 2.9-5.6.3 1.7 1.2 2.8 2.35 3.2-.4-3.1.9-6.4 3.9-8.85.3 2.9 2.05 4.7 3.6 6.5 1.4 1.6 2.75 3.1 2.75 4.75A6.75 6.75 0 0 1 12 21.25z" />,
    <><path d="M12 21.25a6.75 6.75 0 0 1-6.75-6.75c0-2.6 1.5-4.3 2.9-5.6.3 1.7 1.2 2.8 2.35 3.2-.4-3.1.9-6.4 3.9-8.85.3 2.9 2.05 4.7 3.6 6.5 1.4 1.6 2.75 3.1 2.75 4.75A6.75 6.75 0 0 1 12 21.25z" />
      <path d="M12 21.25c-1.8 0-3.1-1.3-3.1-2.95 0-1.7 1.4-2.6 2.2-3.9.4 1 1 1.5 1.7 1.7.7-.8 1-1.8 1-2.9 1.1 1.2 1.95 2.6 1.95 4.1 0 2.3-1.6 3.95-3.75 3.95z" /></>,
  ),
  // A star: the AI's picks.
  picks: N(
    <path d="M10.6 3.9a.7.7 0 0 1 1.25 0l2.05 4.15 4.6.67a.7.7 0 0 1 .39 1.2l-3.33 3.24.79 4.58a.7.7 0 0 1-1.02.74l-4.1-2.16-4.12 2.16a.7.7 0 0 1-1.01-.74l.78-4.58-3.33-3.24a.7.7 0 0 1 .39-1.2l4.6-.67z" />,
    <><path d="M10.6 3.9a.7.7 0 0 1 1.25 0l2.05 4.15 4.6.67a.7.7 0 0 1 .39 1.2l-3.33 3.24.79 4.58a.7.7 0 0 1-1.02.74l-4.1-2.16-4.12 2.16a.7.7 0 0 1-1.01-.74l.78-4.58-3.33-3.24a.7.7 0 0 1 .39-1.2l4.6-.67z" /></>,
  ),
  // A magnifier over a page of notes.
  research: N(
    <circle cx="10.5" cy="10.5" r="6.75" />,
    <><circle cx="10.5" cy="10.5" r="6.75" /><path d="M15.4 15.4l5.35 5.35M7.75 9h5.5M7.75 12h3.5" /></>,
  ),
  // A trophy: the best traders.
  traders: N(
    <path d="M7 3.75h10v5.5a5 5 0 0 1-10 0z" />,
    <><path d="M7 3.75h10v5.5a5 5 0 0 1-10 0z" /><path d="M7 5.5H5.25a2.5 2.5 0 0 0 0 5H7.4M17 5.5h1.75a2.5 2.5 0 0 1 0 5H16.6M12 14.25v3.25M8.5 20.25h7M9.5 20.25c0-1.6 1.1-2.75 2.5-2.75s2.5 1.15 2.5 2.75" /></>,
  ),
  // The X mark in a rounded square: the X tracker.
  xtracker: N(
    <rect x="3" y="3" width="18" height="18" rx="5" />,
    <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M8 8l8 8M16 8l-8 8" /></>,
  ),
  // Two people.
  people: N(
    <><circle cx="9" cy="8" r="3.75" /><path d="M2.75 20.25v-.75a5 5 0 0 1 5-5h2.5a5 5 0 0 1 5 5v.75z" /></>,
    <><circle cx="9" cy="8" r="3.75" /><path d="M2.75 20.25v-.75a5 5 0 0 1 5-5h2.5a5 5 0 0 1 5 5v.75M15.75 4.4a3.75 3.75 0 0 1 0 7.2M18.25 14.7a5 5 0 0 1 3 4.8v.75" /></>,
  ),
  // A coin with a plus: make a coin.
  launch: N(
    <circle cx="10" cy="14" r="7.25" />,
    <><circle cx="10" cy="14" r="7.25" /><circle cx="10" cy="14" r="3.75" /><path d="M19 2.75v5.5M16.25 5.5h5.5" /></>,
  ),
  // Code brackets in a window: the API.
  api: N(
    <rect x="2.75" y="4.25" width="18.5" height="15.5" rx="4" />,
    <><rect x="2.75" y="4.25" width="18.5" height="15.5" rx="4" /><path d="M9.25 9.5L6.75 12l2.5 2.5M14.75 9.5l2.5 2.5-2.5 2.5M12.75 8.75l-1.5 6.5" /></>,
  ),
  // A plug: connect an AI over MCP.
  mcp: N(
    <path d="M6.25 8.25h11.5v4a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5z" />,
    <><path d="M6.25 8.25h11.5v4a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5zM9 8.25V2.75M15 8.25V2.75M12 17.25v4" /></>,
  ),
  // A person in a circle: your account.
  account: N(
    <circle cx="12" cy="12" r="9.25" />,
    <><circle cx="12" cy="12" r="9.25" /><circle cx="12" cy="10" r="3.25" /><path d="M6.6 19.3a5.75 5.75 0 0 1 10.8 0" /></>,
  ),
  // A gear.
  settings: N(
    <path d="M10.3 2.75h3.4l.55 2.6 1.55.9 2.5-.85 1.7 2.95-2 1.75v1.8l2 1.75-1.7 2.95-2.5-.85-1.55.9-.55 2.6h-3.4l-.55-2.6-1.55-.9-2.5.85-1.7-2.95 2-1.75v-1.8l-2-1.75 1.7-2.95 2.5.85 1.55-.9z" />,
    <><path d="M10.3 2.75h3.4l.55 2.6 1.55.9 2.5-.85 1.7 2.95-2 1.75v1.8l2 1.75-1.7 2.95-2.5-.85-1.55.9-.55 2.6h-3.4l-.55-2.6-1.55-.9-2.5.85-1.7-2.95 2-1.75v-1.8l-2-1.75 1.7-2.95 2.5.85 1.55-.9z" />
      <circle cx="12" cy="12" r="3" /></>,
  ),
  // A heart with a pulse: the radar's health.
  health: N(
    <path d="M12 20.25s-8.25-4.75-8.25-11A4.5 4.5 0 0 1 12 6.9a4.5 4.5 0 0 1 8.25 2.35c0 6.25-8.25 11-8.25 11z" />,
    <><path d="M12 20.25s-8.25-4.75-8.25-11A4.5 4.5 0 0 1 12 6.9a4.5 4.5 0 0 1 8.25 2.35c0 6.25-8.25 11-8.25 11z" /><path d="M6.5 12.5h2.25l1.5-2.75 2.5 5 1.5-2.25h3.25" /></>,
  ),
};
