import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { closeTikTokWindow } from "@/lib/tiktok-window";
import { fitVideoBox, parseTikTok, readTikTokQueue, type VideoBox } from "@/lib/tiktok";
import { store } from "@/lib/utils";
import { TikTokPlayer } from "./TikTokPlayer";
import "@/styles/tiktok.css";

export function TikTokPanel() {
  const [box, setBox] = useState(() => fitVideoBox(store.get<VideoBox | null>("tiktok:box", null), innerWidth, innerHeight));
  const [queue, setQueue] = useState(() => readTikTokQueue(store.get<unknown>("tiktok:queue", [])));
  const [selected, setSelected] = useState(() => store.get<string>("tiktok:selected", ""));
  const [auto, setAuto] = useState(() => store.get<boolean>("tiktok:auto", false) === true);
  const [edit, setEdit] = useState(false), [input, setInput] = useState(""), [error, setError] = useState("");
  const [mini, setMini] = useState(false), [moving, setMoving] = useState(false);
  const panel = useRef<HTMLDivElement>(null), rail = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; box: VideoBox; size: boolean } | null>(null);
  const swipe = useRef(0), wheel = useRef({ amount: 0, time: 0, last: 0 });
  const index = Math.max(0, queue.findIndex(v => v.id === selected)), video = queue[index];
  const fit = (b: VideoBox) => fitVideoBox(b, innerWidth, innerHeight);
  const saveBox = (b: VideoBox) => { const fitted = fit(b); setBox(fitted); store.set("tiktok:box", fitted); };
  const step = useCallback((direction: number) => {
    if (queue.length < 2) return;
    const i = Math.max(0, queue.findIndex(v => v.id === selected));
    setSelected(queue[(i + direction + queue.length) % queue.length].id);
  }, [queue, selected]);
  useEffect(() => { store.set("tiktok:queue", queue); }, [queue]);
  useEffect(() => { store.set("tiktok:selected", selected); }, [selected]);
  useEffect(() => { store.set("tiktok:auto", auto); }, [auto]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const resize = () => setBox(b => fitVideoBox(b, innerWidth, innerHeight));
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const el = rail.current; if (!el) return;
    const scroll = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const now = performance.now(), w = wheel.current;
      if (now - w.time < 500) return;
      if (now - w.last > 180) w.amount = 0;
      w.last = now; w.amount += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      if (Math.abs(w.amount) >= 45) { step(Math.sign(w.amount)); w.amount = 0; w.time = now; }
    };
    el.addEventListener("wheel", scroll, { passive: false });
    return () => el.removeEventListener("wheel", scroll);
  }, [step, mini, edit, queue.length]);
  const down = (size: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    gesture.current = { x: e.clientX, y: e.clientY, box, size }; setMoving(true);
    e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current; if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    setBox(fit(g.size ? { ...g.box, w: g.box.w + dx, h: g.box.h + dy } : { ...g.box, x: g.box.x + dx, y: g.box.y + dy }));
  };
  const end = (cancel = false) => {
    const g = gesture.current; if (!g) return;
    gesture.current = null; setMoving(false); if (cancel) saveBox(g.box); else saveBox(box);
  };
  const keyboard = (size: boolean) => (e: KeyboardEvent) => {
    const n = e.shiftKey ? 40 : 10, dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
    if (!dx && !dy) return; e.preventDefault(); e.stopPropagation();
    saveBox(size ? { ...box, w: box.w + dx, h: box.h + dy } : { ...box, x: box.x + dx, y: box.y + dy });
  };
  const dragProps = { onPointerMove: move, onPointerUp: () => end(), onPointerCancel: () => end(true), onLostPointerCapture: () => end(true) };
  const add = () => {
    const lines = input.trim().split(/\s+/).filter(Boolean), videos = lines.map(parseTikTok);
    if (!lines.length || videos.some(v => !v)) { setError("Paste full TikTok video links: tiktok.com/@name/video/… Short share links need to be opened first."); return; }
    const combined = new Map(queue.map(v => [v.id, v])); for (const v of videos) if (v) combined.set(v.id, v);
    if (combined.size > 200) { setError("Your queue holds 200 videos. Remove a few before adding more."); return; }
    setQueue([...combined.values()]); if (!video) setSelected(videos[0]!.id);
    setInput(""); setError(""); setEdit(false);
  };
  return <div ref={panel} role="dialog" aria-modal="false" aria-label="TikTok panel" tabIndex={-1} className="tt-panel" data-moving={moving} style={{ left: box.x, top: box.y, width: box.w, height: mini ? 48 : box.h }}
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); closeTikTokWindow(); } }}>
    <header className="tt-header">
      <button className="tt-grab" aria-label="Move TikTok panel" title="Drag to move. Arrow keys also work." onPointerDown={down(false)} {...dragProps} onKeyDown={keyboard(false)}><span className="tt-mark" aria-hidden>♪</span><b>TikTok</b><span className="tt-grip" aria-hidden>⠿</span></button>
      <button aria-label="Reset TikTok position" title="Reset size and position" onClick={() => saveBox(fitVideoBox(null, innerWidth, innerHeight))}>↺</button>
      <button aria-label={mini ? "Expand TikTok panel" : "Minimize TikTok panel"} onClick={() => setMini(!mini)}>{mini ? "□" : "−"}</button>
      <button aria-label="Close TikTok panel" onClick={closeTikTokWindow}>×</button>
    </header>
    {!mini && <>
      <div className="tt-toolbar"><span>{queue.length ? `${index + 1} / ${queue.length} videos` : "Your watch queue"}</span><button onClick={() => { setEdit(!edit); setError(""); }} aria-expanded={edit}>{edit ? "Done" : "+ Add videos"}</button></div>
      {!video || edit ? <div className="tt-editor">
        <h2>{video ? "Add to your queue" : "A little scroll on the side."}</h2><p>Paste TikTok video links. Your queue stays saved on this browser.</p>
        <form onSubmit={e => { e.preventDefault(); add(); }}><label htmlFor="tiktok-links">Video links</label><textarea id="tiktok-links" value={input} onChange={e => setInput(e.target.value)} placeholder="https://www.tiktok.com/@creator/video/…" rows={3} maxLength={40000} autoComplete="off" spellCheck={false} />
          {error && <p role="alert" className="tt-error">{error}</p>}<button className="tt-add" type="submit">Add to queue</button></form>
        {!video && <p className="tt-explainer">Official TikTok videos and recommendations. Your personal For You feed stays in TikTok.</p>}
        {queue.length > 0 && <ol className="tt-queue">{queue.map((v, i) => <li key={v.id}><button onClick={() => { setSelected(v.id); setEdit(false); }}><span>{i + 1}</span> @{v.creator}</button><button aria-label={`Remove video ${i + 1}`} onClick={() => setQueue(q => q.filter(row => row.id !== v.id))}>×</button></li>)}</ol>}
      </div> : <div className="tt-stage">
        <TikTokPlayer key={video.id} video={video} auto={auto} next={() => step(1)} />
        <div className="tt-scroll" ref={rail} role="group" aria-label="Scroll videos" onPointerDown={e => { if ((e.target as HTMLElement).closest("button")) return; swipe.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const dy = swipe.current - e.clientY; if (Math.abs(dy) > 35) step(Math.sign(dy)); }}>
          <button aria-label="Previous TikTok" disabled={queue.length < 2} onClick={() => step(-1)}>↑</button><span>Scroll / swipe</span><button aria-label="Next TikTok" disabled={queue.length < 2} onClick={() => step(1)}>↓</button>
        </div>
      </div>}
      <footer className="tt-footer"><label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />Auto-next</label>{video && <a href={video.url} target="_blank" rel="noopener noreferrer">Open TikTok ↗</a>}
        <button className="tt-resize" aria-label="Resize TikTok panel" title="Drag to resize. Arrow keys also work." onPointerDown={down(true)} {...dragProps} onKeyDown={keyboard(true)}>◢</button>
      </footer>
    </>}
  </div>;
}
