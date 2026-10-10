// How to load each page's code, by the first word of its address ("coins", "coin", "feed", "" for Pulse...).
// main.tsx fills this in; anything that can tell a page is about to be opened (a link under the pointer,
// lib/coin.ts) calls it, so the page's code is in hand before the click.
export const pageCode: Record<string, () => Promise<void>> = {};
