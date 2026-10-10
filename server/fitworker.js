// Fits the early radar's model on a thread of its own (logit.js), so the every-10-minutes training never takes
// time from the live feeds on the radar's thread. Messages in: { id, X: number[][], y: number[], opts }; out:
// { id, model } or { id, error }.
import { parentPort } from "node:worker_threads";
import { fit } from "./logit.js";

parentPort.on("message", ({ id, X, y, opts }) => {
  try { parentPort.postMessage({ id, model: fit(X, y, opts) }); }
  catch (e) { parentPort.postMessage({ id, error: e.message }); }
});
