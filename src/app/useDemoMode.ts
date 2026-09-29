import { useCallback, useEffect, useRef, useState } from "react";
import { entryId as entryIdOf } from "../engine/registry";
import type { ShapeEntry } from "../engine/types";

/**
 * Demo mode: cycle the shapes of the active category ("All" = the whole
 * registry) every `dwell` seconds. stopDemo() is synchronous (ref write) so
 * journaling and other state updates see the stop immediately.
 */
export function useDemoMode({
  curRef,
  applyEntry,
  visibleEntries,
  dwell,
}: {
  curRef: React.MutableRefObject<{ entryId: string }>;
  applyEntry: (e: ShapeEntry) => void;
  visibleEntries: ShapeEntry[];
  dwell: number;
}) {
  const [demo, setDemo] = useState(false);
  const demoIdx = useRef(0);
  const demoRef = useRef(demo); // synchronous read for journaling while setDemo is in flight
  demoRef.current = demo;

  // stable identity: reads/writes only the demoRef and the demo setter, so the
  // callbacks in App can list stopDemo as a dep without re-creating each render
  const stopDemo = useCallback(() => {
    demoRef.current = false;
    setDemo(false);
  }, []);

  useEffect(() => {
    if (!demo || visibleEntries.length === 0) return;
    const list = visibleEntries;
    const idx = list.findIndex((s) => entryIdOf(s) === curRef.current.entryId);
    demoIdx.current = idx >= 0 ? idx : 0;
    const iv = window.setInterval(
      () => {
        demoIdx.current = (demoIdx.current + 1) % list.length;
        applyEntry(list[demoIdx.current]);
      },
      Math.max(1, dwell) * 1000,
    );
    return () => window.clearInterval(iv);
  }, [demo, dwell, applyEntry, visibleEntries, curRef]);

  return { demo, setDemo, demoRef, stopDemo, demoIdx };
}
