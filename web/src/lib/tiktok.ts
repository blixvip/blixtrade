// Only canonical public TikTok post URLs become frames. Never embed pasted HTML.
export type TikTokVideo = { id: string; url: string; creator: string };
export function parseTikTok(input: string): TikTokVideo | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || !["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    const match = url.pathname.match(/^\/@([\w.-]{1,40})\/(?:video|photo)\/(\d{15,25})\/?$/);
    return match ? { id: match[2], creator: match[1], url: `https://www.tiktok.com/@${match[1]}/${url.pathname.includes('/photo/') ? 'photo' : 'video'}/${match[2]}` } : null;
  } catch { return null; }
}
export function readTikTokQueue(value: unknown): TikTokVideo[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, TikTokVideo>();
  for (const item of value.slice(0, 200)) {
    const video = parseTikTok(typeof item === "string" ? item : item?.url ?? "");
    if (video) result.set(video.id, video);
  }
  return [...result.values()];
}
export interface VideoBox { x: number; y: number; w: number; h: number }
export function fitVideoBox(value: Partial<VideoBox> | null, width: number, height: number): VideoBox {
  const finite = (v: number | undefined, fallback: number) => Number.isFinite(v) ? v! : fallback;
  const maxW = Math.max(1, width - 16), maxH = Math.max(1, height - 80);
  const w = Math.max(Math.min(300, maxW), Math.min(finite(value?.w, 370), maxW));
  const h = Math.max(Math.min(400, maxH), Math.min(finite(value?.h, 650), maxH));
  return { w, h, x: Math.max(8, Math.min(finite(value?.x, width - w - 24), width - w - 8)), y: Math.max(8, Math.min(finite(value?.y, 64), height - h - 64)) };
}
