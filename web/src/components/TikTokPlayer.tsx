import { useEffect, useRef, useState } from "react";
import type { TikTokVideo } from "@/lib/tiktok";

export function TikTokPlayer({ video, auto, next }: { video: TikTokVideo; auto: boolean; next: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const handlers = useRef({ auto, next }); handlers.current = { auto, next };
  useEffect(() => {
    setState("loading");
    const timer = setTimeout(() => setState(s => s === "loading" ? "error" : s), 18000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== "https://www.tiktok.com" || event.source !== frame.current?.contentWindow || event.data?.["x-tiktok-player"] !== true) return;
      const { type, value } = event.data;
      if (type === "onPlayerReady" || type === "onStateChange") { clearTimeout(timer); setState("ready"); }
      if (type === "onPlayerError" || type === "onError") {
        clearTimeout(timer);
        // Browser autoplay restrictions leave a working player: the user can press Play.
        setState(value?.errorCode === 3002 ? "ready" : "error");
      }
      if (type === "onStateChange" && value === 0 && handlers.current.auto) handlers.current.next();
    };
    const pauseHidden = () => { if (document.hidden) frame.current?.contentWindow?.postMessage({ "x-tiktok-player": true, type: "pause" }, "https://www.tiktok.com"); };
    window.addEventListener("message", receive); document.addEventListener("visibilitychange", pauseHidden);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); document.removeEventListener("visibilitychange", pauseHidden); };
  }, [video.id, attempt]);
  return <div className="tt-player">
    <iframe key={`${video.id}:${attempt}`} ref={frame} title={`TikTok video by @${video.creator}`}
      src={`https://www.tiktok.com/player/v1/${video.id}?autoplay=1&controls=1&description=1&music_info=1&rel=1`}
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={() => setState("error")} />
    {state === "loading" && <div className="tt-player-note" role="status">Loading TikTok…</div>}
    {state === "error" && <div className="tt-player-note tt-player-error" role="status"><b>This video couldn’t load</b><span>It may be unavailable, or TikTok may be blocked.</span><div><button onClick={() => setAttempt(n => n + 1)}>Retry</button><a href={video.url} target="_blank" rel="noopener noreferrer">Open TikTok ↗</a></div></div>}
  </div>;
}
