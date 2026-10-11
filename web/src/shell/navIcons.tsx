import type { ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

// The rail's icons: one set on a 24 px grid, all the same 1.75 stroke and round joins, drawn from Lucide's shapes
// (ISC licence) so they sit together. Each has a soft filled body (class "duo") that the rail shows only for the
// page you are on, so the current page reads as filled and the rest as outlines.
const N = (duo: ReactNode, line: ReactNode) => ({ className, ...p }: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0", className)} {...p}>
    <g className="duo" fill="currentColor" stroke="none" opacity="0">{duo}</g>
    {line}
  </svg>
);

const COMPASS = "m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z";
const ZAP = "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";
const BUBBLE_A = "M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z";
const PAPER = "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2";
const CUP = "M18 2H6v7a6 6 0 0 0 12 0V2Z";
const ROCKET = "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z";
const SPARK = "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z";
const GEAR = "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z";
const HEART = "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";

export const NavIcon = {
  // A compass: finding coins.
  discover: N(<circle cx="12" cy="12" r="10" />, <><circle cx="12" cy="12" r="10" /><path d={COMPASS} /></>),
  // A bolt: new coins, live, as they launch.
  pulse: N(<path d={ZAP} />, <path d={ZAP} />),
  // Two speech bubbles: the feed of trades and theses.
  feed: N(<path d={BUBBLE_A} />, <><path d={BUBBLE_A} /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" /></>),
  // A newspaper: the day's narratives.
  narratives: N(<path d={PAPER} />, <><path d={PAPER} /><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" /></>),
  // A trophy: the best traders.
  traders: N(<path d={CUP} />, <><path d={CUP} /><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /></>),
  // A rocket: launch a coin.
  launch: N(<path d={ROCKET} />, <><path d={ROCKET} /><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>),
  // Sparkles: the AI's early picks.
  picks: N(<path d={SPARK} />, <><path d={SPARK} /><path d="M20 3v4M22 5h-4M4 17v2M5 18H3" /></>),
  // A rewind loop around a play mark: practice on a replayed chart.
  replay: N(<path d="M10 8.75v6.5l5-3.25z" />, <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M10 8.75v6.5l5-3.25z" /></>),
  // Code brackets: the API.
  api: N(null, <path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" />),
  // A plug: connect an AI over MCP.
  mcp: N(<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />, <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />),
  // A person in a circle: your account.
  account: N(<circle cx="12" cy="12" r="10" />, <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66" /></>),
  // A gear.
  settings: N(<path d={GEAR} />, <><path d={GEAR} /><circle cx="12" cy="12" r="3" /></>),
  // A heart with a pulse: the radar's health.
  health: N(<path d={HEART} />, <><path d={HEART} /><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" /></>),
};
