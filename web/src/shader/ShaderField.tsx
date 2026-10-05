import { useEffect, useRef } from "react";
import { create } from "zustand";
import { usePulse } from "@/lib/pulse";
import { store } from "@/lib/utils";

// The light behind the instrument: a few large folds of dark liquid chrome drifting slowly, lit from the brand
// corner, never brighter than a sheen (the data sits on top of it). It answers the market: more launches make it
// a little brighter and faster, net buying or selling changes which way it drifts.
//
// GPU budget (this runs all day on a small card): half resolution, 30 frames a second, stopped while the
// tab is hidden or the window is not focused, one still frame under reduced motion, and it drops itself
// to a still frame if frames start running long.
export type FxMode = "full" | "static" | "off";
export const useFx = create<{ mode: FxMode; auto: boolean; set: (m: FxMode) => void }>((set) => ({
  mode: store.get<FxMode>("fx", "full"), auto: false,
  set: (mode) => { store.set("fx", mode); set({ mode, auto: false }); },
}));

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_heat; uniform float u_flow; uniform vec2 u_ptr;
out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + vec2(11.7, 3.1); a *= .5; } return s; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float ar = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * ar, uv.y);
  float t = u_time * (.008 + .012 * u_heat);
  // A few large, slow folds of liquid chrome: a gently warped height field ...
  vec2 q = vec2(fbm(p * .48 + vec2(0., t)), fbm(p * .48 + vec2(5.2, -t * .7)));
  vec2 s = p * .6 + 1.6 * q + vec2(t * .35, u_flow * t * .5);
  // ... its slope from finite differences in the surface's own units (the same at any resolution) ...
  float e = .02, h0 = fbm(s);
  vec2 g = vec2(fbm(s + vec2(e, 0.)) - h0, fbm(s + vec2(0., e)) - h0) / e;
  vec3 n = normalize(vec3(-g * 1.2, 1.));
  // ... reflecting one broad, soft band of sky (no horizon line), with a faint glint where it faces the light.
  vec3 r = reflect(vec3(0., 0., -1.), n);
  float y = r.y + .35 * r.x;
  float z = (y - .25) / .45, band = exp(-z * z);           // a square, not pow(): pow() of a negative is undefined in GLSL
  vec3 L = normalize(vec3(-.5, .6, .65));
  float spec = pow(max(dot(n, normalize(L + vec3(0., 0., 1.))), 0.), 30.);
  float key = exp(-distance(p, vec2(0., 1.)) * .95);       // lit from the brand corner, top left
  float ptr = exp(-distance(p, vec2(u_ptr.x * ar, u_ptr.y)) * 3.5) * .04;
  float light = (.03 + .28 * key + ptr) * (.85 + .15 * u_heat);
  vec3 col = vec3(.84, .87, .94) * (band * .7 + spec * .6) * light;
  col += vec3(.082, .085, .094);   // the floor: very dark grey, the same as --color-paper
  col += (hash(gl_FragCoord.xy + fract(u_time) * 61.) - .5) * .008;   // a little grain to hide banding
  o = vec4(col, 1.);
}`;

const SCALE = 0.5, FRAME_MS = 1000 / 30, SLOW_MS = 55;

export function ShaderField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mode = useFx((s) => s.mode);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || mode === "off") return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    if (!gl) return;
    const still = mode === "static" || matchMedia("(prefers-reduced-motion: reduce)").matches;

    const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!, vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) console.warn("Blix field shader failed:", gl.getProgramInfoLog(prog), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U("u_res"), uTime = U("u_time"), uHeat = U("u_heat"), uFlow = U("u_flow"), uPtr = U("u_ptr");

    let raf = 0, last = 0, clock = 0, heat = 0.3, flow = 0, slow = 0, lost = false;
    const ptr = { x: 0.2, y: 0.8, tx: 0.2, ty: 0.8 };

    const resize = () => {
      const w = Math.max(2, Math.round(innerWidth * SCALE)), h = Math.max(2, Math.round(innerHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    };
    const draw = () => {
      const s = usePulse.getState();
      // launches a minute, eased toward: about 25 a minute reads as a hot market
      const targetHeat = Math.min(1, (s.live.launchesPerMin ?? 8) / 25);
      heat += (targetHeat - heat) * 0.03; flow += (s.pressure - flow) * 0.03;
      ptr.x += (ptr.tx - ptr.x) * 0.06; ptr.y += (ptr.ty - ptr.y) * 0.06;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, clock); gl.uniform1f(uHeat, heat); gl.uniform1f(uFlow, flow); gl.uniform2f(uPtr, ptr.x, ptr.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      if (dt < FRAME_MS - 2) return;
      // A run of long frames means the card is busy with something else: stop moving.
      slow = last && dt > SLOW_MS && dt < 500 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 90) { stop(); useFx.setState({ mode: "static", auto: true }); return; }
      last = now; clock += Math.min(dt, 100) / 1000;
      draw();
    };
    const running = () => raf !== 0;
    const start = () => { if (!still && !lost && !running() && !document.hidden && document.hasFocus()) { last = 0; raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const sync = () => (document.hidden || !document.hasFocus() ? stop() : start());
    const onResize = () => { resize(); if (!running()) draw(); };
    const onMove = (e: PointerEvent) => { ptr.tx = e.clientX / innerWidth; ptr.ty = 1 - e.clientY / innerHeight; };
    const onLost = (e: Event) => { e.preventDefault(); lost = true; stop(); };

    resize(); clock = 40; draw();
    start();
    document.addEventListener("visibilitychange", sync);
    addEventListener("focus", sync); addEventListener("blur", sync);
    addEventListener("resize", onResize);
    addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
      removeEventListener("focus", sync); removeEventListener("blur", sync);
      removeEventListener("resize", onResize);
      removeEventListener("pointermove", onMove);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteProgram(prog);   // the context itself goes with its canvas (see key below)
    };
  }, [mode]);

  if (mode === "off") return null;
  // key: a fresh canvas (and so a fresh context) per mode
  return <canvas key={mode} ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
