export interface TrackerBox { x: number; y: number; w: number; h: number }
export const TRACKER_DOCK_MIN_VIEWPORT = 960;
export function fitTrackerDockWidth(value: number, availableWidth: number) {
  return Math.round(Math.max(360, Math.min(Number.isFinite(value) ? value : 440, 640, availableWidth - 440)));
}
export const isTrackerDockTarget = (x: number, width: number) => width >= TRACKER_DOCK_MIN_VIEWPORT && x >= width - 72;
export type TrackerDockSide = "left" | "right";
export function trackerDockTarget(x: number, viewportWidth: number, workspaceLeft = 0): TrackerDockSide | null {
  if (viewportWidth < TRACKER_DOCK_MIN_VIEWPORT || !Number.isFinite(x)) return null;
  if (x <= workspaceLeft + 72) return "left";
  return isTrackerDockTarget(x, viewportWidth) ? "right" : null;
}
export function fitTrackerBox(box: Partial<TrackerBox> | null | undefined, width: number, height: number): TrackerBox {
  const maxW = Math.max(1, width - 16), maxH = Math.max(1, height - 80);
  const finite = (n: number | undefined, fallback: number) => typeof n === "number" && Number.isFinite(n) ? n : fallback;
  const w = Math.max(Math.min(400, maxW), Math.min(finite(box?.w, 620), maxW));
  const h = Math.max(Math.min(300, maxH), Math.min(finite(box?.h, 580), maxH));
  return { w, h, x: Math.round(Math.max(8, Math.min(finite(box?.x, width - w - 16), width - w - 8))), y: Math.round(Math.max(8, Math.min(finite(box?.y, 72), height - h - 56))) };
}
