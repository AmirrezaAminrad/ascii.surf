import { useEffect, useRef, useState } from "react";
import { PANEL_W_MAX, PANEL_W_MIN, loadPanelW, persistPanelW } from "../state";

/**
 * Desktop side-panel drag-resize: width state (null = CSS default 320px),
 * pointer handlers for the edge handle, and the drag cursor/userSelect lock.
 */
export function usePanelResize() {
  const [panelW, setPanelW] = useState<number | null>(loadPanelW);
  const [panelResizing, setPanelResizing] = useState(false);
  const panelWRef = useRef(panelW);
  panelWRef.current = panelW;
  const panelDrag = useRef<{ startX: number; startW: number; lastW: number } | null>(null);

  const onPanelResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startW = panelWRef.current ?? 320;
    panelDrag.current = { startX: e.clientX, startW, lastW: startW };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanelResizing(true);
  };
  const onPanelResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = panelDrag.current;
    if (!d) return;
    // panel hugs the right edge: dragging left grows it
    const w = Math.round(d.startW + (d.startX - e.clientX));
    d.lastW = Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, w));
    setPanelW(d.lastW);
  };
  const onPanelResizeEnd = () => {
    const d = panelDrag.current;
    if (!d) return;
    panelDrag.current = null;
    setPanelResizing(false);
    persistPanelW(d.lastW); // not panelWRef — the final state update may still be batched
  };

  useEffect(() => {
    if (!panelResizing) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [panelResizing]);

  return {
    panelW,
    setPanelW,
    panelResizing,
    onPanelResizeStart,
    onPanelResizeMove,
    onPanelResizeEnd,
  };
}
