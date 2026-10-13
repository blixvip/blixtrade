// A popup drawn over the page (createPortal into <body>) still sits inside whatever opened it in React's event
// tree, so React passes its events up to that component: a click on a tweet card opened the coin row behind it,
// moving over it opened that row's chart card, typing in a dialog reached the row's key handlers. Wrapping the
// popup's content in <Isolate> stops those events at the popup. Native listeners (the modal's Escape and focus trap
// on document, outside-click checks) are untouched, and handlers inside the popup still run first.
import type { ReactNode, SyntheticEvent } from "react";

const stop = (e: SyntheticEvent) => e.stopPropagation();

export function Isolate({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "contents" }}
      onClick={stop} onDoubleClick={stop} onAuxClick={stop} onContextMenu={stop}
      onPointerDown={stop} onPointerUp={stop} onPointerMove={stop} onPointerCancel={stop}
      onMouseDown={stop} onMouseUp={stop} onMouseMove={stop}
      onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onWheel={stop}
      onKeyDown={stop} onKeyUp={stop} onFocus={stop} onBlur={stop}
      onChange={stop} onInput={stop} onSubmit={stop}
      onDragStart={stop} onDragOver={stop} onDrop={stop}>
      {children}
    </div>
  );
}
