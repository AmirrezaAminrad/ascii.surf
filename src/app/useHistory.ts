import { useCallback, useEffect, useRef, useState } from "react";
import type { Params, SurfaceDef } from "../engine/types";
import type { ViewSettings } from "../types";

/** A full-state snapshot the undo journal restores — the same atoms loadScene writes. */
export interface HistSnap {
  entryId: string;
  def: SurfaceDef;
  code: string;
  paramValues: Record<string, Params>;
  settings: ViewSettings;
}

/**
 * Undo/redo journal over the five state atoms. Post-edit snapshots are pushed
 * via pushSnap; same-key pushes inside the coalesce window merge into one
 * step, so a slider drag / wheel gesture / burst of typing is a single undo
 * step. Applying a snapshot is the caller's recipe (`apply`).
 */
export function useHistory({
  curRef,
  apply,
  showFlash,
}: {
  curRef: React.MutableRefObject<HistSnap>;
  apply: (s: HistSnap) => void;
  showFlash: (msg: string) => void;
}) {
  const hist = useRef<{ stack: HistSnap[]; idx: number }>({ stack: [], idx: -1 });
  const lastPush = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  const [, setHistVer] = useState(0); // re-render trigger for the undo/redo buttons

  // stable identity: reads only the curRef ref, so the callbacks in App can
  // list snapBase as a dep without re-creating each render
  const snapBase = useCallback((): HistSnap => {
    const { entryId, def, code, paramValues, settings } = curRef.current;
    return { entryId, def, code, paramValues, settings };
  }, [curRef]);

  // stable identity: reads/writes only the hist/lastPush refs and the re-render
  // setter, so the callbacks in App can list pushSnap as a dep without
  // re-creating each render
  const pushSnap = useCallback((snap: HistSnap, key: string, winMs = 900) => {
    const h = hist.current;
    if (h.idx < 0) return; // journal not seeded yet
    const now = Date.now();
    if (
      key !== "" &&
      h.idx === h.stack.length - 1 &&
      lastPush.current.key === key &&
      now - lastPush.current.t < winMs
    ) {
      h.stack[h.idx] = snap; // coalesce: the entry below still holds the pre-gesture state
    } else {
      h.stack.length = h.idx + 1; // drop the redo tail on a fresh edit
      h.stack.push(snap);
      if (h.stack.length > 100) h.stack.shift();
      h.idx = h.stack.length - 1;
    }
    lastPush.current = { key, t: now };
    setHistVer((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    if (h.idx <= 0) return;
    h.idx--;
    lastPush.current = { key: "", t: 0 };
    apply(h.stack[h.idx]);
    setHistVer((v) => v + 1);
    showFlash(`↶ undo · step ${h.idx}/${h.stack.length - 1}`);
  }, [apply, showFlash]);

  const redo = useCallback(() => {
    const h = hist.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    lastPush.current = { key: "", t: 0 };
    apply(h.stack[h.idx]);
    setHistVer((v) => v + 1);
    showFlash(`↷ redo · step ${h.idx}/${h.stack.length - 1}`);
  }, [apply, showFlash]);

  // seed the journal with the restored startup state (StrictMode double-run is a harmless reset)
  useEffect(() => {
    hist.current = { stack: [snapBase()], idx: 0 };
  }, [snapBase]);

  return { hist, snapBase, pushSnap, undo, redo };
}
