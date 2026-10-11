// The light show behind the leaderboard's podium: three soft beams from above (gold on first place in the middle,
// silver on the left, bronze on the right), slow drifting haze, and motes of dust rising through the light. One
// WebGL fragment shader on a quad; it draws in its own alpha so it sits on the page's background. Paused when it
// is off screen or the tab is hidden; one still frame when the person prefers reduced motion; nothing at all
// (the page's own gradient shows) without WebGL.
import { useEffect, useRef } from "react";

const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
const FRAG = `
precision mediump float;
uniform vec2 res; uniform float t;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
// A beam falling from the top at x = c, widening as it goes down, shimmering along its length.
float beam(vec2 uv, float c, float w, float seed) {
  float spread = w * (0.25 + (1.0 - uv.y) * 1.1);
  float d = (uv.x - c) / spread;
  float core = exp(-d * d * 2.6);
  float shimmer = 0.75 + 0.25 * fbm(vec2(d * 1.5 + seed, uv.y * 3.0 - t * 0.25));
  return core * shimmer * smoothstep(0.02, 0.55, uv.y + 0.25);
}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float aspect = res.x / res.y;
  float sway = sin(t * 0.35) * 0.006;
  vec3 gold = vec3(1.0, 0.78, 0.36), silver = vec3(0.74, 0.8, 0.92), bronze = vec3(0.92, 0.55, 0.32);
  vec3 col = gold * beam(uv, 0.5 + sway, 0.11, 1.0) * 0.42
           + silver * beam(uv, 0.18 - sway, 0.09, 4.0) * 0.32
           + bronze * beam(uv, 0.82 + sway, 0.09, 7.0) * 0.3;
  // Haze drifting across the whole stage, lit a little by the beams.
  float haze = fbm(vec2(uv.x * aspect * 1.6 + t * 0.03, uv.y * 2.2 - t * 0.015));
  col += vec3(0.55, 0.5, 0.42) * haze * haze * 0.10;
  // Motes rising slowly, twinkling, brightest inside the beams.
  vec2 g = vec2(uv.x * aspect, uv.y) * 26.0; g.y -= t * 0.35;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float h = hash(id);
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float mote = smoothstep(0.07, 0.0, length(f - o * 0.6)) * step(0.82, h) * (0.5 + 0.5 * sin(t * 2.0 + h * 40.0));
  float lit = clamp(beam(uv, 0.5, 0.14, 2.0) + beam(uv, 0.18, 0.12, 5.0) * 0.6 + beam(uv, 0.82, 0.12, 8.0) * 0.6, 0.0, 1.0);
  col += vec3(1.0, 0.93, 0.8) * mote * (0.15 + lit * 0.85) * 0.9;
  // Fade out toward the sides and the bottom so it melts into the page.
  float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x) * smoothstep(0.0, 0.3, uv.y);
  col *= edge;
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.1, 0.0, 1.0);
  gl_FragColor = vec4(min(col, vec3(a)), a);
}`;

export function PodiumLights({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const gl = cv?.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!cv || !gl) return;
    const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "res"), uT = gl.getUniformLocation(prog, "t");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0, seen = true;
    const t0 = performance.now() - 20_000 * Math.random();   // not every visit starts on the same frame
    const size = () => {
      const k = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(cv.clientWidth * k)), h = Math.max(1, Math.round(cv.clientHeight * k));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
    };
    const draw = (now: number) => {
      frame = 0;
      size();
      gl.uniform2f(uRes, cv.width, cv.height); gl.uniform1f(uT, (now - t0) / 1000);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!still && seen && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const go = () => { if (!frame && seen && !document.hidden) frame = requestAnimationFrame(draw); };
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; go(); });
    io.observe(cv);
    const ro = new ResizeObserver(() => { if (still) draw(performance.now()); });
    ro.observe(cv);
    document.addEventListener("visibilitychange", go);
    draw(performance.now());
    return () => { cancelAnimationFrame(frame); io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", go); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, []);
  return <canvas ref={ref} aria-hidden className={className} />;
}
