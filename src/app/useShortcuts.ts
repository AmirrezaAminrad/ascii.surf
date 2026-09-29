import { useEffect } from "react";
import { clampZoom } from "../view";
import { SHAPES, entryName } from "../engine/registry";
import type { ShapeEntry } from "../engine/types";
import type { ViewApi, ViewSettings } from "../types";

/**
 * Global keyboard shortcuts (ignored while typing in inputs). The listener is
 * bound once — handlers are captured on mount and stay valid because they read
 * through refs (curRef, apiRef, hist) and stable setters.
 */
export function useShortcuts(h: {
  curRef: React.MutableRefObject<{ settings: ViewSettings }>;
  apiRef: React.MutableRefObject<ViewApi | null>;
  undo: () => void;
  redo: () => void;
  patch: (p: Partial<ViewSettings>) => void;
  setSettings: React.Dispatch<React.SetStateAction<ViewSettings>>;
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDemo: React.Dispatch<React.SetStateAction<boolean>>;
  showFlash: (msg: string) => void;
  copyFrame: () => Promise<void>;
  copyPng: () => Promise<void>;
  copyAnsi: () => Promise<void>;
  exportPNG: () => void;
  exportSVG: () => void;
  exportTXT: () => void;
  toggleRecording: () => void;
  startGif: () => Promise<void>;
  toggleFullscreen: () => void;
  pickMesh: () => void;
  shareLink: () => Promise<void>;
  randomize: () => void;
  loadEntry: (e: ShapeEntry) => void;
}) {
  const {
    curRef,
    apiRef,
    undo,
    redo,
    patch,
    setSettings,
    setPaletteOpen,
    setHelpOpen,
    setPanelOpen,
    setDemo,
    showFlash,
    copyFrame,
    copyPng,
    copyAnsi,
    exportPNG,
    exportSVG,
    exportTXT,
    toggleRecording,
    startGif,
    toggleFullscreen,
    pickMesh,
    shareLink,
    randomize,
    loadEntry,
  } = h;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      // text fields keep native editing/undo; range sliders let ours through
      const inTextField =
        !!tgt &&
        (tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable ||
          (tgt.tagName === "INPUT" && (tgt as HTMLInputElement).type !== "range"));
      if (inTextField) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "k") {
          e.preventDefault();
          setPaletteOpen((o) => !o);
          return;
        }
        if (!e.altKey && (k === "z" || k === "y")) {
          e.preventDefault();
          if (k === "y" || e.shiftKey) redo();
          else undo();
        }
        return; // other browser shortcuts pass through untouched
      }
      if (e.altKey) return;
      switch (e.key) {
        case "Escape":
          setHelpOpen(false);
          break;
        case "?":
          setHelpOpen((h2) => !h2);
          break;
        case " ":
          e.preventDefault();
          if (!e.repeat) setSettings((s) => ({ ...s, paused: !s.paused }));
          break;
        case "ArrowLeft":
          e.preventDefault();
          apiRef.current?.nudge(-0.15, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          apiRef.current?.nudge(0.15, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          apiRef.current?.nudge(0, -0.15);
          break;
        case "ArrowDown":
          e.preventDefault();
          apiRef.current?.nudge(0, 0.15);
          break;
        case "+":
        case "=":
          patch({ zoom: clampZoom(curRef.current.settings.zoom * 1.12) });
          break;
        case "-":
        case "_":
          patch({ zoom: clampZoom(curRef.current.settings.zoom / 1.12) });
          break;
        case "r":
        case "R":
          apiRef.current?.resetView();
          showFlash("view reset");
          break;
        case "d":
        case "D":
          setDemo((v) => !v);
          showFlash("demo mode");
          break;
        case "o":
        case "O":
          patch({
            projection: curRef.current.settings.projection === "ortho" ? "perspective" : "ortho",
          });
          break;
        case "g":
        case "G":
          patch({ debug: !curRef.current.settings.debug });
          break;
        case "c":
          void copyFrame();
          break;
        case "C":
          if (e.shiftKey) void copyPng();
          else void copyFrame();
          break;
        case "a":
        case "A":
          void copyAnsi();
          break;
        case "p":
        case "P":
          exportPNG();
          break;
        case "s":
        case "S":
          exportSVG();
          break;
        case "t":
        case "T":
          exportTXT();
          break;
        case "v":
        case "V":
          toggleRecording();
          break;
        case "e":
        case "E":
          void startGif();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "m":
        case "M":
          pickMesh();
          break;
        case "l":
        case "L":
          void shareLink();
          break;
        case "x":
        case "X":
          randomize();
          break;
        case "h":
        case "H":
          setPanelOpen((o) => !o);
          break;
        default: {
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= 9 && SHAPES[n - 1]) {
            loadEntry(SHAPES[n - 1]);
            showFlash(`loaded ${entryName(SHAPES[n - 1])}`);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // bound once; handlers stay fresh through refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadEntry]);
}
