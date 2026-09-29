import { useSyncExternalStore } from "react";
import type { Stats } from "../types";

// Frame stats live outside React state: the render loop reports 4×/sec, and
// routing that through App state re-rendered the entire application (shape
// grid, every slider, all lists) each tick even when nothing else changed.
// A plain external store confines the update to components that subscribe.

interface StatsSnap {
  stats: Stats;
  hist: number[];
}

const HIST_LEN = 60;

let snap: StatsSnap = {
  stats: {
    fps: 0,
    ms: 0,
    engineMs: 0,
    drawMs: 0,
    points: 0,
    cols: 0,
    rows: 0,
    angles: [0, 0, 0],
    time: 0,
  },
  hist: [],
};

const listeners = new Set<() => void>();

/** Called by the render loop (throttled to 250 ms inside AsciiView). */
export function reportStats(s: Stats): void {
  const old = snap.hist;
  const hist = old.length < HIST_LEN ? [...old, s.fps] : [...old.slice(1), s.fps];
  snap = { stats: s, hist };
  for (const l of listeners) l();
}

export function useStats(): StatsSnap {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => snap,
  );
}

export const fpsColor = (fps: number): string =>
  fps >= 50 ? "#4ade80" : fps >= 30 ? "#facc15" : fps >= 15 ? "#fb923c" : "#f87171";
