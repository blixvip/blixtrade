// Loaded before everything else: every repeating job the radar starts is timed and named by where it was
// started, so the Health page can say which one held the radar up. Nothing else about the job changes.
import { timed } from "./health.js";

const realInterval = globalThis.setInterval;
globalThis.setInterval = function (fn, ms, ...rest) {
  if (typeof fn !== "function") return realInterval(fn, ms, ...rest);
  const at = (new Error().stack.split("\n")[2] || "").match(/([\w.-]+\.m?js):(\d+)/);
  const every = ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
  return realInterval(timed(`${fn.name || "job"} (${at ? `${at[1]}:${at[2]}` : "unknown"}, every ${every})`, fn), ms, ...rest);
};
