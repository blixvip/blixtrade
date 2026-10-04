import type { ReactNode, SVGProps } from "react";

// One hand-drawn line set, carried over from the classic rail. No icon library, no emoji.
const I = (d: ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>{d}</svg>
);

export const Icon = {
  pulse: I(<path d="M3 12h4l2.5-7 4 14 2.5-7h5" />),
  signals: I(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6" /></>),
  picks: I(<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />),
  research: I(<><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>),
  narratives: I(<path d="M12 3c1 3.5 5 5 5 9.5A5 5 0 0 1 7 12.5c0-2 1-3.2 2-4 0 2 1 3 2 3 0-3-1-5.5 1-8.5z" />),
  coins: I(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>),
  wallets: I(<><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 14.5h2" /></>),
  briefs: I(<><path d="M6 3h9l4 4v14H6z" /><path d="M9 11h7M9 15h7M14 3v5h5" /></>),
  record: I(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  health: I(<><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z" /><path d="M8 12h2l1.5-2.5 2 5L15 12h1.5" /></>),
  api: I(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />),
  mcp: I(<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" />),
  settings: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>),
  star: I(<path d="M12 4l2.3 4.9 5.3.6-3.9 3.7 1 5.3L12 15.9l-4.7 2.6 1-5.3-3.9-3.7 5.3-.6z" />),
  users: I(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.9 3 2.9 3 5.6" /></>),
  crown: I(<path d="M4 18h16M4 18l-1-10 5 4 4-7 4 7 5-4-1 10" />),
  dev: I(<path d="M7 14a4 4 0 0 1-1-7.9A5 5 0 0 1 16 5a4 4 0 0 1 1 9M7 14v6h10v-6M7 17h10" />),
  x: I(<path d="M5 4l14 16M19 4L5 20" />),
  web: I(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>),
  tg: I(<path d="M21 4L3 11l6 2.5M21 4l-3 16-9-6.5M21 4L9 13.5V19l3-3" />),
  copy: I(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  link: I(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />),
  candles: I(<><path d="M8 3v3M8 16v5M16 3v5M16 18v3" /><rect x="5.5" y="6" width="5" height="10" rx="1" /><rect x="13.5" y="8" width="5" height="10" rx="1" /></>),
  curve: I(<><circle cx="12" cy="12" r="9" /><path d="M12 12V3M12 12l6.4 6.4" /></>),
  rank: I(<path d="M4 20h4v-7H4zM10 20h4V4h-4zM16 20h4v-10h-4z" />),
  userStar: I(<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6 1 0 2 .3 2.8.7M17.5 13l1.2 2.5 2.8.4-2 1.9.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.9 2.8-.4z" /></>),
  chef: I(<path d="M7 14a4 4 0 0 1-1-7.9A5 5 0 0 1 16 5a4 4 0 0 1 1 9M7 14v6h10v-6M7 17h10" />),
  crosshair: I(<><circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /><circle cx="12" cy="12" r="1" /></>),
  ghost: I(<><path d="M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.2 2-2.3-2-2.3 2-2.2-2z" /><path d="M9.5 10.5h.01M14.5 10.5h.01" /></>),
  boxes: I(<><rect x="8.5" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="13" width="7" height="7" rx="1.5" /><rect x="14" y="13" width="7" height="7" rx="1.5" /></>),
  bolt: I(<path d="M13 2L5 13.5h6L10 22l9-12h-6.5z" />),
  ai: I(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>),
  user: I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.400 3.600-8 8-8s8 3.600 8 8" /></>),
  refresh: I(<path d="M20 11a8 8 0 0 0-14.500-4M4 4v4h4M4 13a8 8 0 0 0 14.500 4M20 20v-4h-4" />),
  send: I(<path d="M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />),
  key: I(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>),
  search: I(<><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>),
};
