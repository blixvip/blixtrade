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
  const [notice, setNotice] = useState("");
  const [mini, setMini] = useState(false), [moving, setMoving] = useState(false);
  const panel = useRef<HTMLDivElement>(null), rail = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; box: VideoBox; size: boolean } | null>(null);
  const swipe = useRef(0), wheel = useRef({ amount: 0, time: 0, last: 0 });
  const index = Math.max(0, queue.findIndex(v => v.id === selected)), video = queue[index];
  const pending = new Set(input.trim().split(/\s+/).map(parseTikTok).filter(v => v && !queue.some(q => q.id === v.id)).map(v => v!.id)).size;
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
    if (!lines.length || videos.some(v => !v)) { setError("Use the full video address: tiktok.com/@name/video/… If you copied a short share link, open it in your browser first, then copy the address bar."); return; }
    const combined = new Map(queue.map(v => [v.id, v])); for (const v of videos) if (v) combined.set(v.id, v);
    if (combined.size > 200) { setError("Your queue holds 200 videos. Remove a few before adding more."); return; }
    const added = combined.size - queue.length;
    if (!added) { setError("These videos are already in your queue. Paste a different TikTok link to add more."); return; }
    setQueue([...combined.values()]); if (!video) setSelected(videos[0]!.id);
    setNotice(`${added} video${added === 1 ? "" : "s"} added to your queue.`);
    setInput(""); setError(""); setEdit(false);
  };
  return <div ref={panel} role="dialog" aria-modal="false" aria-label="TikTok panel" tabIndex={-1} className="tt-panel" data-moving={moving} style={{ left: box.x, top: box.y, width: box.w, height: mini ? 48 : box.h }}
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); closeTikTokWindow(); } }}>
    <header className="tt-header">
      <button className="tt-grab" aria-label="Move TikTok panel" title="Drag to move. Arrow keys also work." onPointerDown={down(false)} {...dragProps} onKeyDown={keyboard(false)}><span className="tt-mark" aria-hidden>♪</span><span className="tt-title"><b>Doom scroll</b><small>Your TikToks, on the side</small></span><span className="tt-grip" aria-hidden>⠿</span></button>
      <button aria-label="Reset TikTok position" title="Reset size and position" onClick={() => saveBox(fitVideoBox(null, innerWidth, innerHeight))}>↺</button>
      <button aria-label={mini ? "Expand TikTok panel" : "Minimize TikTok panel"} onClick={() => setMini(!mini)}>{mini ? "□" : "−"}</button>
      <button aria-label="Close TikTok panel" onClick={closeTikTokWindow}>×</button>
    </header>
    {!mini && <>
      <div className="tt-toolbar"><span>{queue.length ? `${index + 1} / ${queue.length} videos` : "YOUR OWN VIDEO QUEUE"}</span>{video ? <button onClick={() => { setEdit(!edit); setError(""); setNotice(""); }} aria-label={edit ? "Back to video" : "Manage your TikTok queue"} aria-expanded={edit}>{edit ? "Back to video" : "+ Add / queue"}</button> : <span className="tt-local">Saved here</span>}</div>
      {notice && !edit && video && <div className="tt-notice" role="status"><span><b>✓</b> {notice}</span><button aria-label="Dismiss queue confirmation" onClick={() => setNotice("")}>×</button></div>}
      {!video || edit ? <div className="tt-editor">
        {!video && <div className="tt-intro-art" aria-hidden><span /><span /><span>♪<i>＋</i></span></div>}
        <h2>{video ? "Add more of your TikToks" : "Add your own TikToks."}</h2><p className="tt-intro-copy">You choose what plays. Paste video links to build your own scroll queue.</p>
        {!video && <ol className="tt-steps"><li><span>1</span><div><b>Find a video you like</b><a href="https://www.tiktok.com/" target="_blank" rel="noopener noreferrer">Open TikTok in your browser ↗</a></div></li><li><span>2</span><div><b>Copy the full video address</b><small>Use the address bar on the video's page.</small></div></li><li><span>3</span><div><b>Paste below and start scrolling</b><small>Add several links, one per line.</small></div></li></ol>}
        <form onSubmit={e => { e.preventDefault(); add(); }}><div className="tt-field-heading"><label htmlFor="tiktok-links">Your TikTok links</label><span>{pending ? `${pending} new` : "One per line"}</span></div><textarea id="tiktok-links" value={input} onChange={e => { setInput(e.target.value); setError(""); }} placeholder="https://www.tiktok.com/@creator/video/…" rows={2} maxLength={40000} autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? "tiktok-link-error" : "tiktok-link-help"} />
          {error && <p id="tiktok-link-error" role="alert" className="tt-error">{error}</p>}<button className="tt-add" type="submit" aria-label="Add to queue">{pending ? `Add ${pending} video${pending === 1 ? "" : "s"} to queue` : "Add your TikToks"}<span aria-hidden>→</span></button></form>
        <p id="tiktok-link-help" className="tt-explainer">Your queue is saved on this browser. Your TikTok For You feed isn’t imported.</p>
        {queue.length > 0 && <><div className="tt-queue-heading"><b>Your videos</b><span>{queue.length} / 200</span></div><ol className="tt-queue">{queue.map((v, i) => <li key={v.id} data-selected={i === index}><button aria-label={`Play video ${i + 1} by @${v.creator}`} aria-current={i === index ? "true" : undefined} onClick={() => { setSelected(v.id); setEdit(false); }}><span className="tt-queue-number">{i === index ? "▶" : i + 1}</span><span className="tt-queue-caption"><b>@{v.creator}</b><small>Video · {v.id.slice(-6)}{i === index ? " · Selected" : ""}</small></span></button><button aria-label={`Remove video ${i + 1}`} title="Remove from your queue" onClick={() => { setQueue(q => q.filter(row => row.id !== v.id)); setNotice(""); }}>×</button></li>)}</ol></>}
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
