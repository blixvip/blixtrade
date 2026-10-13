// The Forge's runtime binaries, fetched once: the ONNX runtime and the two cutout models (~106 MB of third-party
// bytes, kept out of git; forge/vendor and forge/models are ignored). After this the editor works with no network.
//   node forge/setup.mjs            fetch what is missing
//   node forge/setup.mjs --force    fetch again
// Adapted from blixvip/photo-editor setup.mjs (see forge/UPSTREAM for the commit).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");
const ORT = "1.23.0";
const ORT_BASE = `https://unpkg.com/onnxruntime-web@${ORT}/dist/`;
const MODEL_BASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/";
const FILES = [
  ...["ort.webgpu.bundle.min.mjs", "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"].map((f) => ({ url: ORT_BASE + f, to: path.join("vendor", "ort", f) })),
  { url: MODEL_BASE + "u2netp.onnx", to: path.join("models", "u2netp.onnx"), min: 4e6 },
  { url: MODEL_BASE + "silueta.onnx", to: path.join("models", "silueta.onnx"), min: 4e7 },
];
const MB = (n) => (n / 1048576).toFixed(1) + "MB";
const already = async (abs, min) => { try { return (await fs.stat(abs)).size > (min || 1000); } catch { return false; } };
let fetched = 0, skipped = 0, failed = 0;
for (const f of FILES) {
  const abs = path.join(ROOT, f.to);
  if (!FORCE && await already(abs, f.min)) { skipped++; continue; }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  process.stdout.write(`  ${f.to.padEnd(52)}`);
  try {
    const res = await fetch(f.url, { redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (f.min && buf.length < f.min) throw new Error(`short read, ${MB(buf.length)}`);
    await fs.writeFile(abs, buf);
    console.log(MB(buf.length)); fetched++;
  } catch (e) { console.log("FAILED: " + e.message); failed++; }
}
console.log(`${fetched} fetched, ${skipped} already present${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
