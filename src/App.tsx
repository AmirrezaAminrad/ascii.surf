import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsciiView from "./components/AsciiView";
import type { ViewApi, ViewSettings } from "./types";
import { THEMES, shuffledDraft, type Theme } from "./themes";
import {
  DEFAULT_SETTINGS,
  encodeState,
  loadFavs,
  persistFavs,
  persistPanelW,
  persistState,
  restoreState,
  type StoredStateV2,
} from "./state";
import { copyText, download, downloadBlob } from "./utils";
import { useHistory, type HistSnap } from "./app/useHistory";
import { useDemoMode } from "./app/useDemoMode";
import { useRecorder } from "./app/useRecorder";
import { useScenes } from "./app/useScenes";
import { useCustomThemes } from "./app/useCustomThemes";
import { usePanelResize } from "./app/usePanelResize";
import { useShortcuts } from "./app/useShortcuts";
import { ScenesSection, ThemeSection, ViewSections } from "./components/SidebarSections";
import { reportStats } from "./components/statsStore";
import { frameAnsi, frameHtml, frameSvg, hexToRgb, trimFrame } from "./engine/exports";
import StatusBar from "./components/StatusBar";
import { NumInput, Section, Segmented, Slider } from "./components/Controls";
import { HelpOverlay } from "./components/HelpOverlay";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import BootRain from "./components/BootRain";
import { codeAnimated, compileSurface, renderFrame, validateCodeSurface } from "./engine/renderer";
import { CHARSETS, PRESETS } from "./engine/presets";
import { MESH_ID, meshShape, parseMeshFile } from "./engine/mesh";
import {
  SHAPES,
  entryCategory,
  entryDescription,
  entryId as entryIdOf,
  entryName,
  entriesInCategory,
  findEntry,
} from "./engine/registry";
import {
  CATEGORIES,
  defaultParams,
  type Category,
  type Params,
  type Renderable,
  type Shape,
  type ShapeEntry,
  type SurfaceDef,
  type SurfaceFn,
} from "./engine/types";

const KINDS = ["height", "parametric", "implicit", "generate", "sim", "planar"] as const;

/** Starter surfaces for the kind toggle — switching kinds always gives a working default. */
const KIND_TEMPLATES: Record<SurfaceDef["kind"], SurfaceDef> = {
  height: {
    id: "custom",
    name: "Custom",
    kind: "height",
    code: "0.5 * sin(3*x + 2*t) * cos(3*y)",
    uRange: [-2, 2],
    vRange: [-2, 2],
    scale: 0.7,
    description: "Custom height field",
  },
  parametric: {
    id: "custom",
    name: "Custom",
    kind: "parametric",
    code: "return [cos(u)*(1+0.4*cos(v)), sin(u)*(1+0.4*cos(v)), 0.4*sin(v)];",
    uRange: [0, Math.PI * 2],
    vRange: [0, Math.PI * 2],
    scale: 1.1,
    description: "Custom parametric surface",
  },
  implicit: {
    id: "custom",
    name: "Custom",
    kind: "implicit",
    // bumpy sphere: bare expressions are auto-wrapped into a function body
    code: "x*x + y*y + z*z - 2.6 + 0.45*sin(4*x)*sin(4*y)*sin(4*z)",
    bound: 2,
    iso: 0,
    quality: 40,
    description: "Custom implicit surface F(x, y, z) = iso",
  },
  generate: {
    id: "custom",
    name: "Custom",
    kind: "generate",
    code: `// Fibonacci sphere — push(x, y, z, nx, ny, nz)
const N = 4000, g = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = g * i;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  push(x, y, z, x, y, z);
}`,
    description: "Custom generated point cloud",
  },
  sim: {
    id: "custom",
    name: "Custom",
    kind: "sim",
    code: `// glowing wave ring — state lives in this closure
const N = 240;
const phase = new Float32Array(N);
for (let i = 0; i < N; i++) phase[i] = (i / N) * Math.PI * 2;
return {
  step(dt, time) {
    for (let i = 0; i < N; i++) {
      const a = phase[i] + time * 1.2;
      const r = 1.3 + 0.35 * Math.sin(time * 1.7 + i * 0.25);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const z = 0.35 * Math.sin(time * 2.2 + phase[i] * 3);
      glow(x, y, z, 0.55 + 0.45 * Math.sin(time * 3 + i));
    }
  },
};`,
    description: "Custom simulation",
  },
  planar: {
    id: "custom",
    name: "Custom",
    kind: "planar",
    code: `// ASCII shader — return luminance 0..1 per cell (NaN = empty cell)
// in scope: u, v, t · mx, my (mouse) · zoom · cols, rows, aspect · prev(u, v)
const d = hypot(u - mx, v - my);
return 0.5 + 0.5 * cos(12 * d - 4 * t);`,
    span: 4,
    description: "Custom shader",
  },
};

function codeTitle(kind: SurfaceDef["kind"]): string {
  switch (kind) {
    case "height":
      return "z = f(x, y, t)";
    case "implicit":
      return "F(x, y, z, t) = level";
    case "generate":
      return "generate(push, glow, time)";
    case "sim":
      return "return { step(dt, time) }";
    case "planar":
      return "shader (u, v, t) → luminance";
    default:
      return "(u, v, t) → [x, y, z]";
  }
}

/** Settings toggles that are playback/debug state, not edits — never journaled. */
const TRANSIENT_SETTINGS = new Set(["paused", "debug"]);

/** Thin vertical separator between header button groups. */
function Divider({ accent }: { accent: string }) {
  return (
    <span
      aria-hidden="true"
      className="mx-0.5 hidden h-4 w-px sm:inline-block"
      style={{ background: accent + "30" }}
    />
  );
}

export default function App() {
  const { restored, sharedLinkInvalid } = useMemo(restoreState, []);
  const [entryId, setEntryId] = useState(() => restored?.entryId ?? PRESETS[0].id);
  const [def, setDef] = useState<SurfaceDef>(() => restored?.def ?? PRESETS[0]);
  const [code, setCode] = useState(() => restored?.code ?? PRESETS[0].code);
  const [error, setError] = useState<string | null>(null); // compile-time
  const [rtError, setRtError] = useState<string | null>(null); // render-time
  const [fn, setFn] = useState<SurfaceFn | null>(() => {
    const startDef = { ...(restored?.def ?? PRESETS[0]), code: restored?.code ?? PRESETS[0].code };
    try {
      return compileSurface(startDef);
    } catch {
      return null;
    }
  });
  const [paramValues, setParamValues] = useState<Record<string, Params>>(
    () => restored?.paramValues ?? {},
  );
  const [settings, setSettings] = useState<ViewSettings>(
    () => restored?.settings ?? DEFAULT_SETTINGS,
  );
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [cat, setCat] = useState<Category | "All" | "★">("All");
  const [favs, setFavs] = useState<Set<string>>(loadFavs); // ★ pinned shape ids (registry only)
  const [mesh, setMesh] = useState<Shape | null>(null); // runtime-imported STL/OBJ
  const [dragOver, setDragOver] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [query, setQuery] = useState(""); // shape-grid text filter
  const frameRef = useRef<string[]>([]);
  const lumRef = useRef<Float32Array>(new Float32Array(0));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<ViewApi | null>(null);
  const copyTimer = useRef(0);
  const flashTimer = useRef(0);
  const meshInputRef = useRef<HTMLInputElement | null>(null);
  const sceneInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const curRef = useRef({ entryId, def, settings, paramValues, code });
  curRef.current = { entryId, def, settings, paramValues, code };

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, []);

  const applyEntry = useCallback((e: ShapeEntry) => {
    setEntryId(entryIdOf(e));
    if (e.tag === "code") {
      setDef(e.def);
      setCode(e.def.code);
    }
  }, []);

  // shapes visible in the grid / driven by demo mode (memoized: the demo effect
  // depends on the list identity, and entriesInCategory filters a fresh array;
  // "★" scopes both to the pinned favorites)
  const visibleEntries = useMemo(
    () => (cat === "★" ? SHAPES.filter((e) => favs.has(entryIdOf(e))) : entriesInCategory(cat)),
    [cat, favs],
  );

  const { demo, setDemo, stopDemo, demoIdx } = useDemoMode({
    curRef,
    applyEntry,
    visibleEntries,
    dwell: settings.demoDwell,
  });

  const restoreSnap = (s: HistSnap) => {
    stopDemo();
    setEntryId(s.entryId);
    setDef(s.def);
    setCode(s.code);
    setSettings(s.settings);
    setParamValues(s.paramValues);
  };

  const { hist, snapBase, pushSnap, undo, redo } = useHistory({
    curRef,
    apply: restoreSnap,
    showFlash,
  });

  // a shared link that failed to decode — explain why the shared view didn't load
  // (sharedLinkInvalid is fixed at mount by useMemo(restoreState, []), so this runs once)
  useEffect(() => {
    if (sharedLinkInvalid) showFlash("couldn't read the shared link — showing the saved view");
  }, [showFlash, sharedLinkInvalid]);

  const patch = (p: Partial<ViewSettings>) => {
    const next = { ...curRef.current.settings, ...p };
    setSettings(next);
    const keys = Object.keys(p);
    if (!keys.every((k) => TRANSIENT_SETTINGS.has(k))) {
      pushSnap({ ...snapBase(), settings: next }, "set:" + keys.sort().join("+"));
    }
  };

  // a registry entry, the imported mesh, or the virtual "custom" entry backed by the edited def
  const entry: ShapeEntry = useMemo(() => {
    if (entryId === MESH_ID && mesh) return { tag: "native", shape: mesh };
    return findEntry(entryId) ?? { tag: "code", def };
  }, [entryId, def, mesh]);
  const activeShape = entry.tag === "native" ? entry.shape : null;
  const isCode = entry.tag === "code";

  const activeDef = useMemo(() => ({ ...def, code }), [def, code]);

  // recompile on code / def change (debounced) — code-string surfaces only
  useEffect(() => {
    if (!isCode) return;
    const t = setTimeout(() => {
      try {
        const next = { ...def, code };
        if (
          next.kind === "implicit" ||
          next.kind === "generate" ||
          next.kind === "sim" ||
          next.kind === "planar"
        ) {
          // kind-aware smoke test; geometry compiles lazily inside renderFrame
          validateCodeSurface(next);
          setFn(null);
        } else {
          const compiled = compileSurface(next);
          // smoke test: center + corners of the domain
          const uR = next.uRange ?? [-2, 2];
          const vR = next.vRange ?? [-2, 2];
          for (const [u, v] of [
            [(uR[0] + uR[1]) / 2, (vR[0] + vR[1]) / 2],
            [uR[0], vR[0]],
            [uR[1], vR[1]],
            [uR[0], vR[1]],
            [uR[1], vR[0]],
          ]) {
            const p = compiled(u, v, 0);
            if (!Array.isArray(p) || p.length < 3)
              throw new Error("Function must return [x, y, z]");
          }
          setFn(() => compiled);
        }
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [code, def, isCode]);

  // persist state (localStorage) — URL hash is only written by the share button
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const payload: StoredStateV2 = {
          v: 2,
          entryId,
          settings: { ...settings, themeName: settings.theme.name },
          paramValues,
        };
        if (isCode) {
          payload.def = activeDef;
          payload.code = code;
        }
        persistState(payload);
      } catch {
        /* storage blocked or full */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [entryId, isCode, activeDef, code, settings, paramValues]);

  // keep a native def/code pair valid even while a native shape is active
  useEffect(() => {
    if (!isCode && def.id !== PRESETS[0].id) {
      setDef(PRESETS[0]);
      setCode(PRESETS[0].code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCode]);

  // persist the favorites pin set
  useEffect(() => {
    persistFavs(favs);
  }, [favs]);

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // every selectable theme, built-ins first — drives the picker, the randomizer
  // and the name → theme resolution for restored scenes / share links
  const { customThemes, themeDraft, setThemeDraft, allThemesList, saveTheme, deleteTheme } =
    useCustomThemes({ curRef, patch, showFlash });

  // randomize is captured at mount by useShortcuts (bound once), so it reads the
  // theme pool through this ref — themes saved mid-session are picked up without
  // re-registering the keydown listener
  const allThemesRef = useRef(allThemesList);
  allThemesRef.current = allThemesList;

  /** Switch theme — colors only; the charset is left untouched. */
  const applyTheme = (t: Theme) => {
    patch({ theme: t });
  };

  // --- desktop panel drag-resize ----------------------------------------------
  const {
    panelW,
    setPanelW,
    panelResizing,
    onPanelResizeStart,
    onPanelResizeMove,
    onPanelResizeEnd,
  } = usePanelResize();

  const loadEntry = useCallback(
    (e: ShapeEntry) => {
      stopDemo();
      const nextDef = e.tag === "code" ? e.def : curRef.current.def;
      const nextCode = e.tag === "code" ? e.def.code : curRef.current.code;
      applyEntry(e);
      pushSnap(
        {
          entryId: entryIdOf(e),
          def: nextDef,
          code: nextCode,
          paramValues: curRef.current.paramValues,
          settings: curRef.current.settings,
        },
        "",
      );
    },
    [applyEntry, stopDemo, pushSnap],
  );

  const switchKind = (k: SurfaceDef["kind"]) => {
    if (def.kind === k && isCode) return;
    const next = { ...KIND_TEMPLATES[k] };
    stopDemo();
    setEntryId("custom");
    setDef(next);
    setCode(next.code);
    pushSnap(
      {
        entryId: "custom",
        def: next,
        code: next.code,
        paramValues: curRef.current.paramValues,
        settings: curRef.current.settings,
      },
      "",
    );
  };

  // editing a native shape's generated code converts it into a custom code surface
  const convertNativeToCustom = (codeText: string) => {
    if (!generatedDef) return;
    stopDemo();
    const nextDef: SurfaceDef = {
      ...generatedDef,
      code: codeText,
      name: "Custom " + (activeShape?.name ?? "shape"),
      description: "Edited code — based on " + (activeShape?.name ?? "a registry shape"),
    };
    setEntryId("custom");
    setDef(nextDef);
    setCode(codeText);
    pushSnap(
      {
        entryId: "custom",
        def: nextDef,
        code: codeText,
        paramValues: curRef.current.paramValues,
        settings: curRef.current.settings,
      },
      "code",
      1500,
    );
  };

  // per-shape parameters
  const curParams: Params = useMemo(() => {
    if (!activeShape) return {};
    return { ...defaultParams(activeShape.params), ...(paramValues[activeShape.id] ?? {}) };
  }, [activeShape, paramValues]);
  const patchParam = (key: string, v: number) => {
    if (!activeShape) return;
    const nextPv = { ...curRef.current.paramValues, [activeShape.id]: { ...curParams, [key]: v } };
    setParamValues(nextPv);
    pushSnap({ ...snapBase(), paramValues: nextPv }, `param:${activeShape.id}:${key}`);
  };
  const resetParams = () => {
    if (!activeShape) return;
    const nextPv = {
      ...curRef.current.paramValues,
      [activeShape.id]: defaultParams(activeShape.params),
    };
    setParamValues(nextPv);
    pushSnap({ ...snapBase(), paramValues: nextPv }, "");
  };

  // surface-def edits (bound / iso / quality / ranges / scale) — journaled like params
  const editDef = (next: SurfaceDef, key: string) => {
    setDef(next);
    pushSnap({ ...snapBase(), def: next }, "def:" + key);
  };

  /** Uniform in-range sample per param spec, snapped to step (or integer). */
  const randomParamValues = (shape: Shape): Params => {
    const vals: Params = {};
    for (const spec of shape.params) {
      const raw = spec.min + Math.random() * (spec.max - spec.min);
      const stepped = spec.int ? Math.round(raw) : Math.round(raw / spec.step) * spec.step;
      vals[spec.key] = Math.max(spec.min, Math.min(spec.max, stepped));
    }
    return vals;
  };

  /** Re-roll only the current shape's parameters (shape/theme untouched). */
  const rerollParams = () => {
    if (!activeShape) {
      showFlash("re-roll needs a native shape");
      return;
    }
    const nextPv = {
      ...curRef.current.paramValues,
      [activeShape.id]: randomParamValues(activeShape),
    };
    setParamValues(nextPv);
    pushSnap({ ...snapBase(), paramValues: nextPv }, "param-reroll");
    showFlash(`🎲 re-rolled ${activeShape.name}`);
  };

  // --- randomizer: surprise shape + in-range params + theme + spin -----------
  const randomize = useCallback(() => {
    const pick = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    let pv = curRef.current.paramValues;
    if (pick.tag === "native") {
      pv = { ...pv, [pick.shape.id]: randomParamValues(pick.shape) };
      setParamValues(pv);
    }
    const themes = allThemesRef.current;
    const theme = themes[Math.floor(Math.random() * themes.length)];
    const spin = () => (Math.random() * 2 - 1) * 1.1;
    const nextSettings: ViewSettings = {
      ...curRef.current.settings,
      theme,
      spin: [spin(), spin(), spin()],
    };
    setSettings(nextSettings);
    stopDemo();
    applyEntry(pick);
    pushSnap(
      {
        entryId: entryIdOf(pick),
        def: pick.tag === "code" ? pick.def : curRef.current.def,
        code: pick.tag === "code" ? pick.def.code : curRef.current.code,
        paramValues: pv,
        settings: nextSettings,
      },
      "",
    );
    showFlash(`🎲 ${entryName(pick)} · ${theme.name}`);
  }, [applyEntry, showFlash, stopDemo, pushSnap]);

  const renderable: Renderable = useMemo(
    () =>
      entry.tag === "code"
        ? { tag: "code", def: activeDef, fn }
        : { tag: "native", shape: entry.shape, params: curParams },
    [entry, activeDef, fn, curParams],
  );

  const onRtError = useCallback((msg: string | null) => setRtError(msg), []);

  // keep the browser chrome tint in sync with the active theme
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", settings.theme.bg);
  }, [settings.theme]);

  // keep the favicon in sync with the active theme (terminal `>_` glyph, same design as index.html)
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const x = c.getContext("2d");
      if (!x) return;
      x.fillStyle = settings.theme.bg;
      if (typeof x.roundRect === "function") {
        x.beginPath();
        x.roundRect(0, 0, 32, 32, 6);
        x.fill();
      } else {
        x.fillRect(0, 0, 32, 32);
      }
      x.fillStyle = settings.theme.fg;
      x.font = "18px monospace";
      x.textAlign = "center";
      x.fillText(">_", 16, 22);
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.type = "image/png";
      link.href = c.toDataURL("image/png");
    } catch {
      /* canvas blocked */
    }
  }, [settings.theme]);

  // dev-only console hook for QA: window.__asciiDebug.renderFrame(...)
  useEffect(() => {
    const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    if (isDev) {
      (window as unknown as Record<string, unknown>).__asciiDebug = {
        renderable,
        renderFrame,
        SHAPES,
      };
    }
  }, [renderable]);

  // --- mesh import (STL / OBJ), via button, shortcut or drag & drop ----------
  const importMeshFile = useCallback(async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const data = await parseMeshFile(file, buf);
      setMesh(meshShape(data));
      stopDemo();
      setEntryId(MESH_ID);
      pushSnap({ ...snapBase(), entryId: MESH_ID }, "");
      showFlash(`mesh "${data.name}" — ${data.triCount.toLocaleString()} triangles`);
    } catch (e) {
      showFlash(`mesh import failed: ${(e as Error)?.message ?? "unknown error"}`);
    }
  }, [pushSnap, snapBase, showFlash, stopDemo]);

  const pickMesh = useCallback(() => meshInputRef.current?.click(), []);

  // --- canvas capture: webm recording + animated GIF export -------------------
  const {
    recording,
    recLeft,
    recDur,
    setRecDur,
    toggleRecording,
    startGif,
    gifLeft,
    gifTotal,
    gifCancel,
  } = useRecorder({
    canvasRef,
    curRef,
    showFlash,
  });

  // --- fullscreen ------------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => showFlash("fullscreen blocked"));
  }, [showFlash]);
  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // --- ANSI truecolor export: fg-colored glyphs for terminal pasting ---------
  const copyAnsi = async () => {
    const { theme, colorMode } = curRef.current.settings;
    const s = frameAnsi(frameRef.current, lumRef.current, { ...theme, colorMode });
    if (!s) return;
    const ok = await copyText(s);
    showFlash(ok ? "ANSI frame copied ✓ (paste in a terminal)" : "ANSI copy blocked");
  };

  // --- HTML export: self-contained colorized <pre> (web/email embedding) -----
  const copyHtml = async () => {
    const { theme, colorMode } = curRef.current.settings;
    const t = frameHtml(frameRef.current, lumRef.current, { ...theme, colorMode });
    if (!t) return;
    const ok = await copyText(t);
    showFlash(ok ? "HTML frame copied ✓ (paste anywhere)" : "HTML copy blocked");
  };

  // --- SVG export: trimmed vector frame with per-run colored tspans ------------
  const exportSVG = () => {
    const { theme, colorMode } = curRef.current.settings;
    const s = frameSvg(frameRef.current, lumRef.current, { ...theme, colorMode });
    if (!s) return;
    const name = `ascii-surf-${curRef.current.entryId}.svg`;
    const blob = new Blob([s], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(name, blob);
    showFlash(`saved ${name}`);
  };

  const copyFrame = async () => {
    const lines = frameRef.current;
    if (lines.length === 0) return;
    const ok = await copyText(trimFrame(lines));
    setCopied(ok);
    setCopyFailed(!ok);
    clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1200);
  };

  // Copy the live viewport canvas as a PNG image (clipboard image paste).
  const copyPng = async () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
        throw new Error("unsupported");
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
      if (!blob) throw new Error("encode failed");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showFlash("PNG copied ✓ — paste as an image");
    } catch {
      showFlash("PNG copy not supported here — use save PNG");
    }
  };

  const exportPNG = () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const scale = Math.max(1, Math.min(3, Math.round(curRef.current.settings.pngScale || 1)));
      const transparent = curRef.current.settings.pngTransparent;
      const name = `ascii-surf-${curRef.current.entryId}${scale > 1 ? `@${scale}x` : ""}${transparent ? "-alpha" : ""}.png`;
      if (scale === 1 && !transparent) {
        download(name, c.toDataURL("image/png"));
      } else {
        const off = document.createElement("canvas");
        off.width = c.width * scale;
        off.height = c.height * scale;
        const octx = off.getContext("2d");
        if (!octx) throw new Error("no 2d context");
        octx.imageSmoothingEnabled = false; // keep glyph edges crisp
        octx.drawImage(c, 0, 0, off.width, off.height);
        if (transparent) {
          // pixels within ~30 rgb-distance of the theme background become see-through
          const [br, bg, bb] = hexToRgb(curRef.current.settings.theme.bg);
          const img = octx.getImageData(0, 0, off.width, off.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const dr = d[i] - br,
              dg = d[i + 1] - bg,
              db = d[i + 2] - bb;
            if (dr * dr + dg * dg + db * db < 900) d[i + 3] = 0;
          }
          octx.putImageData(img, 0, 0);
        }
        download(name, off.toDataURL("image/png"));
      }
      showFlash(`saved ${name}`);
    } catch {
      showFlash("png export failed");
    }
  };

  const exportTXT = () => {
    const lines = frameRef.current;
    if (lines.length === 0) return;
    const name = `ascii-surf-${curRef.current.entryId}.txt`;
    const blob = new Blob([trimFrame(lines) + "\n"], { type: "text/plain;charset=utf-8" });
    downloadBlob(name, blob);
    showFlash(`saved ${name}`);
  };

  // --- scenes: named snapshots of the full state ------------------------------
  const activeName = entry.tag === "code" ? activeDef.name : entry.shape.name;
  const {
    scenes,
    sceneName,
    setSceneName,
    saveScene,
    loadScene,
    deleteScene,
    exportScene,
    importSceneFile,
  } = useScenes({
    curRef,
    allThemesList,
    activeName,
    stopDemo,
    showFlash,
    pushSnap,
    atoms: { setEntryId, setDef, setCode, setSettings, setParamValues },
  });

  const shareLink = async () => {
    const { settings: s, entryId: id, paramValues: pv } = curRef.current;
    const payload: StoredStateV2 = {
      v: 2,
      entryId: id,
      settings: { ...s, themeName: s.theme.name },
      paramValues: pv,
    };
    if (isCode) {
      payload.def = activeDef;
      payload.code = code;
    }
    const hash = `#s=${encodeState(payload)}`;
    window.history.replaceState(null, "", hash);
    const ok = await copyText(window.location.href);
    showFlash(
      ok ? "share link copied (survives reload)" : "link is in the address bar (clipboard blocked)",
    );
  };

  // global keyboard shortcuts (ignored while typing in inputs)
  useShortcuts({
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
  });

  const accent = settings.theme.fg;
  const activeDesc = entry.tag === "code" ? activeDef.description : entry.shape.description;
  const animated = isCode ? codeAnimated(activeDef) : entry.shape.animated;
  const isHeight = activeDef.kind === "height";
  // classic parametric/height surfaces expose range + scale editing
  const isCodeKind = activeDef.kind === "parametric" || activeDef.kind === "height";
  const generatedDef = activeShape?.toCode ? activeShape.toCode(curParams) : null;
  // Paper theme gets a light glass panel; the dark themes keep the black glass one
  const lightPanel = settings.theme.name === "Paper";
  const panelVars = (
    lightPanel
      ? {
          "--panel-line": "rgba(0,0,0,0.15)",
          "--panel-chip": "rgba(0,0,0,0.13)",
          "--panel-dim": "rgba(0,0,0,0.52)",
          "--panel-dimmer": "rgba(0,0,0,0.4)",
          "--panel-text": "rgba(0,0,0,0.88)",
          "--panel-head": "rgba(0,0,0,0.48)",
          "--panel-track": "rgba(0,0,0,0.12)",
          "--panel-input": "rgba(255,255,255,0.65)",
          "--panel-off": "rgba(0,0,0,0.3)",
          "--panel-hi": "rgba(0,0,0,0.72)",
        }
      : {
          "--panel-line": "rgba(255,255,255,0.1)",
          "--panel-chip": "rgba(255,255,255,0.1)",
          "--panel-dim": "rgba(255,255,255,0.5)",
          "--panel-dimmer": "rgba(255,255,255,0.35)",
          "--panel-text": "rgba(255,255,255,0.85)",
          "--panel-head": "rgba(255,255,255,0.4)",
          "--panel-track": "rgba(255,255,255,0.07)",
          "--panel-input": "rgba(0,0,0,0.4)",
          "--panel-off": "rgba(255,255,255,0.25)",
          "--panel-hi": "rgba(255,255,255,0.8)",
        }
  ) as React.CSSProperties;
  const rootStyle = {
    background: settings.theme.bg,
    color: accent,
    "--acc": accent,
    "--panel-w": `${panelW ?? 320}px`,
    transition: "background-color 0.4s ease, color 0.4s ease",
    ...panelVars,
  } as React.CSSProperties;
  const hbtn =
    "hbtn rounded border px-2 py-1.5 text-[11px] uppercase tracking-wider opacity-80 transition-all duration-150 hover:-translate-y-px hover:opacity-100 active:translate-y-0 sm:px-2 sm:py-1 sm:text-[10px]";

  // text filter on top of the category filter (name / description / category)
  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleEntries;
    return visibleEntries.filter((e) =>
      `${entryName(e)} ${entryDescription(e)} ${entryCategory(e)}`.toLowerCase().includes(q),
    );
  }, [visibleEntries, query]);

  // command palette contents: everything reachable, one list
  const paletteItems: CommandItem[] = [
    ...SHAPES.map((e): CommandItem => ({
      id: "shape:" + entryIdOf(e),
      label: entryName(e),
      hint: entryCategory(e),
      section: "Shapes",
      keywords: entryDescription(e),
      run: () => {
        loadEntry(e);
        showFlash(`loaded ${entryName(e)}`);
      },
    })),
    ...allThemesList.map((t): CommandItem => ({
      id: "theme:" + t.name,
      label: t.name,
      hint: t.mode,
      section: "Themes",
      run: () => applyTheme(t),
    })),
    ...CHARSETS.map((c): CommandItem => ({
      id: "charset:" + c.name,
      label: c.name,
      hint: c.chars.length > 18 ? c.chars.slice(0, 18) + "…" : c.chars,
      section: "Charsets",
      run: () => {
        patch({ charset: c.chars });
        showFlash(`charset: ${c.name}`);
      },
    })),
    ...((): CommandItem[] => {
      const paused = settings.paused;
      return [
        {
          id: "act:pause",
          label: paused ? "resume time" : "pause time",
          keys: "Space",
          section: "Actions",
          run: () => patch({ paused: !paused }),
        },
        {
          id: "act:demo",
          label: demo ? "stop demo mode" : "start demo mode",
          keys: "D",
          section: "Actions",
          run: () => {
            setDemo(!demo);
            showFlash("demo mode");
          },
        },
        {
          id: "act:random",
          label: "randomize everything",
          keys: "X",
          section: "Actions",
          keywords: "surprise dice shuffle",
          run: randomize,
        },
        {
          id: "act:reroll",
          label: "re-roll parameters",
          section: "Actions",
          keywords: "random params dice",
          run: rerollParams,
        },
        { id: "act:resetparams", label: "reset parameters", section: "Actions", run: resetParams },
        {
          id: "act:resetview",
          label: "reset view",
          keys: "R",
          section: "Actions",
          run: () => {
            apiRef.current?.resetView();
            showFlash("view reset");
          },
        },
        {
          id: "act:resettime",
          label: "reset time",
          section: "Actions",
          run: () => apiRef.current?.resetTime(),
        },
        {
          id: "act:proj",
          label: `projection: ${settings.projection === "ortho" ? "perspective" : "ortho"}`,
          keys: "O",
          section: "Actions",
          run: () =>
            patch({ projection: settings.projection === "ortho" ? "perspective" : "ortho" }),
        },
        {
          id: "act:full",
          label: isFull ? "leave fullscreen" : "enter fullscreen",
          keys: "F",
          section: "Actions",
          run: toggleFullscreen,
        },
        {
          id: "act:panel",
          label: panelOpen ? "hide control panel" : "show control panel",
          keys: "H",
          section: "Actions",
          run: () => setPanelOpen(!panelOpen),
        },
        {
          id: "act:debug",
          label: settings.debug ? "hide debug readout" : "show debug readout",
          keys: "G",
          section: "Actions",
          run: () => patch({ debug: !settings.debug }),
        },
        {
          id: "act:grid",
          label: settings.gridOverlay ? "hide cell grid overlay" : "show cell grid overlay",
          section: "Actions",
          run: () => patch({ gridOverlay: !settings.gridOverlay }),
        },
        {
          id: "act:cm-ramp",
          label: "color mode: theme ramp",
          section: "Color",
          run: () => patch({ colorMode: "ramp" }),
        },
        {
          id: "act:cm-rainbow",
          label: "color mode: rainbow",
          section: "Color",
          run: () => patch({ colorMode: "rainbow" }),
        },
        {
          id: "act:cm-plasma",
          label: "color mode: plasma",
          section: "Color",
          run: () => patch({ colorMode: "plasma" }),
        },
        {
          id: "act:share",
          label: "copy share link",
          keys: "L",
          section: "Actions",
          run: () => void shareLink(),
        },
        {
          id: "act:copy",
          label: "copy frame as text",
          keys: "C",
          section: "Actions",
          run: () => void copyFrame(),
        },
        {
          id: "act:copypng",
          label: "copy frame as PNG image",
          keys: "⇧C",
          section: "Actions",
          run: () => void copyPng(),
        },
        {
          id: "act:ansi",
          label: "copy ANSI truecolor frame",
          keys: "A",
          section: "Actions",
          run: () => void copyAnsi(),
        },
        {
          id: "act:html",
          label: "copy HTML <pre> frame",
          section: "Actions",
          run: () => void copyHtml(),
        },
        { id: "act:png", label: "save PNG", keys: "P", section: "Actions", run: exportPNG },
        { id: "act:txt", label: "save frame .txt", keys: "T", section: "Actions", run: exportTXT },
        { id: "act:svg", label: "save vector .svg", keys: "S", section: "Actions", run: exportSVG },
        {
          id: "act:gif",
          label: "render animated GIF",
          keys: "E",
          section: "Actions",
          run: () => void startGif(),
        },
        {
          id: "act:rec",
          label: recording ? "stop webm recording" : `record ${recDur}s webm`,
          keys: "V",
          section: "Actions",
          run: toggleRecording,
        },
        {
          id: "act:mesh",
          label: "import STL / OBJ mesh",
          keys: "M",
          section: "Actions",
          run: pickMesh,
        },
        { id: "act:savescene", label: "save scene snapshot", section: "Actions", run: saveScene },
        {
          id: "act:newtheme",
          label: "shuffle a new custom theme",
          section: "Themes",
          keywords: "random palette dice",
          run: () => {
            setPanelOpen(true);
            setThemeDraft(shuffledDraft());
          },
        },
        {
          id: "act:help",
          label: "keyboard shortcuts",
          keys: "?",
          section: "Actions",
          run: () => setHelpOpen(true),
        },
      ];
    })(),
  ];

  return (
    <div
      data-panel={lightPanel ? "light" : "dark"}
      className="flex h-dvh w-screen overflow-hidden font-mono text-white"
      style={rootStyle}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current--;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        if (/\.json$/i.test(f.name) || f.type === "application/json") void importSceneFile(f);
        else if (/\.(stl|obj)$/i.test(f.name)) void importMeshFile(f);
        else showFlash(`can't open "${f.name}" — drop a .json scene or an .stl / .obj mesh`);
      }}
    >
      {/* hidden scene import input — triggered from the Scenes section */}
      <input
        ref={sceneInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importSceneFile(f);
          e.target.value = "";
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* hidden mesh file input — triggered by the Shape-section button or the M key */}
      <input
        ref={meshInputRef}
        type="file"
        accept=".stl,.obj,model/stl,model/obj,application/sla"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importMeshFile(f);
          e.target.value = "";
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* Viewport */}
      <div className="relative min-w-0 flex-1">
        <AsciiView
          name={activeName}
          entryKey={entryId}
          renderable={renderable}
          settings={settings}
          frameRef={frameRef}
          lumRef={lumRef}
          canvasRef={canvasRef}
          apiRef={apiRef}
          onZoom={(v) => patch({ zoom: v })}
          onStats={reportStats}
          onError={onRtError}
        />

        {/* drag & drop target hint */}
        {dragOver && (
          <div
            className="anim-fade pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed"
            style={{
              borderColor: accent,
              background: `color-mix(in srgb, ${settings.theme.bg} 72%, transparent)`,
            }}
          >
            <div
              className="rounded border px-4 py-2 text-[12px] uppercase tracking-[0.3em]"
              style={{ borderColor: accent, color: accent, textShadow: `0 0 12px ${accent}88` }}
            >
              drop stl / obj
            </div>
          </div>
        )}

        {/* scanline overlay for heat themes */}
        {settings.theme.mode === "heat" && (
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,.9) 2px 3px)",
            }}
          />
        )}
        {/* subtle CRT vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${settings.theme.mode === "heat" ? 0.42 : 0.22}))`,
          }}
        />
        {/* optional character-cell grid overlay */}
        {settings.gridOverlay && (
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: `repeating-linear-gradient(0deg, ${accent} 0 1px, transparent 1px ${Math.max(6, Math.round(settings.fontSize * 1.2))}px), repeating-linear-gradient(90deg, ${accent} 0 1px, transparent 1px ${Math.max(6, Math.round(settings.fontSize * 0.6))}px)`,
            }}
          />
        )}

        {/* header */}
        <div className="pointer-events-none absolute left-0 top-0 flex w-full items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.35em] opacity-60">
              <span
                className="inline-block h-2 w-2 rotate-45 border"
                style={{ borderColor: accent }}
              />
              ascii.surf
              <span
                aria-hidden="true"
                className="anim-blink -ml-1 inline-block h-3 w-1.5"
                style={{ background: accent, opacity: 0.55 }}
              />
              {demo && (
                <span
                  className="anim-blink rounded border px-1.5 py-0.5 text-[9px] tracking-[0.2em]"
                  style={{ borderColor: accent, color: accent }}
                >
                  demo
                </span>
              )}
            </div>
            <h1
              className="mt-1 truncate text-lg font-semibold leading-tight tracking-tight"
              style={{ textShadow: `0 0 18px ${accent}55` }}
            >
              {activeName}
            </h1>
            <p className="mt-0.5 hidden max-w-md text-[11px] opacity-60 sm:block">{activeDesc}</p>
          </div>
          <div className="scrollbar-none pointer-events-auto flex max-w-[82%] shrink-0 items-center justify-end gap-1 overflow-x-auto py-0.5 sm:max-w-[70%] sm:flex-wrap sm:gap-1.5 sm:overflow-visible">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                onClick={() => setPaletteOpen(true)}
                title="command palette (Ctrl+K) — jump to shapes, themes, actions"
                aria-label="open command palette"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">⌘k</span>
                <span aria-hidden="true" className="sm:hidden">
                  ⌘
                </span>
              </button>
              <button
                onClick={() => patch({ paused: !settings.paused })}
                title={settings.paused ? "resume time (Space)" : "pause time (Space)"}
                aria-label={settings.paused ? "resume time" : "pause time"}
                aria-pressed={settings.paused}
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                {settings.paused ? "▶" : "⏸"}
              </button>
              <button
                onClick={randomize}
                title="randomize: surprise shape + params + theme (X)"
                aria-label="randomize shape, parameters and theme"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                ⚄
              </button>
              <button
                onClick={() => setDemo((d) => !d)}
                title="cycle shapes in the current category (D)"
                aria-pressed={demo}
                className={hbtn}
                style={{
                  borderColor: demo ? accent : accent + "66",
                  opacity: demo ? 1 : undefined,
                  color: demo ? accent : undefined,
                  background: demo ? `color-mix(in srgb, ${accent} 14%, transparent)` : undefined,
                }}
              >
                {demo ? "⏹" : "demo"}
              </button>
              <button
                onClick={undo}
                disabled={hist.current.idx <= 0}
                title="undo the last tweak — params, settings, shape (Ctrl+Z)"
                aria-label="undo"
                className={`${hbtn} px-2 disabled:pointer-events-none disabled:opacity-30`}
                style={{ borderColor: accent + "66" }}
              >
                ↶
              </button>
              <button
                onClick={redo}
                disabled={hist.current.idx >= hist.current.stack.length - 1}
                title="redo (Ctrl+Shift+Z / Ctrl+Y)"
                aria-label="redo"
                className={`${hbtn} px-2 disabled:pointer-events-none disabled:opacity-30`}
                style={{ borderColor: accent + "66" }}
              >
                ↷
              </button>
            </div>
            <Divider accent={accent} />
            <div className="flex items-center gap-1.5">
              <button
                onClick={copyFrame}
                title="copy current frame as text (C)"
                aria-label="copy frame as text"
                className={`${hbtn} sm:min-w-[64px]`}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">
                  {copied ? "copied ✓" : copyFailed ? "failed ✗" : "copy"}
                </span>
                <span aria-hidden="true" className="sm:hidden">
                  {copied ? "✓" : copyFailed ? "✗" : "⧉"}
                </span>
              </button>
              <button
                onClick={exportPNG}
                title={`save viewport as PNG at ${settings.pngScale}×${settings.pngTransparent ? " transparent" : ""} (P)`}
                aria-label="save PNG"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">png</span>
                <span aria-hidden="true" className="sm:hidden">
                  p
                </span>
              </button>
              <button
                onClick={exportTXT}
                title="save current frame as .txt (T)"
                aria-label="save txt"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">txt</span>
                <span aria-hidden="true" className="sm:hidden">
                  t
                </span>
              </button>
              <button
                onClick={() => void copyAnsi()}
                title="copy frame with ANSI truecolor codes for terminals (A)"
                aria-label="copy ANSI"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">ansi</span>
                <span aria-hidden="true" className="sm:hidden">
                  a
                </span>
              </button>
              <button
                onClick={() => void copyHtml()}
                title="copy frame as a self-contained colorized HTML <pre> (no shortcut)"
                aria-label="copy HTML"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">html</span>
                <span aria-hidden="true" className="sm:hidden">
                  h
                </span>
              </button>
              <button
                onClick={exportSVG}
                title="save the frame as a vector .svg (S)"
                aria-label="save SVG"
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">svg</span>
                <span aria-hidden="true" className="sm:hidden">
                  s
                </span>
              </button>
            </div>
            <Divider accent={accent} />
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                onClick={toggleRecording}
                title={
                  recording
                    ? `stop recording (${recLeft}s left) — V`
                    : `record ${recDur}s webm video (V)`
                }
                aria-label={recording ? "stop webm recording" : "record webm video"}
                aria-pressed={recording}
                className={`${hbtn} sm:min-w-[56px]`}
                style={
                  recording
                    ? { borderColor: "#f87171", color: "#fca5a5", opacity: 1 }
                    : { borderColor: accent + "66" }
                }
              >
                {recording ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="anim-blink inline-block h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_6px_#f87171]" />
                    {recLeft}s
                  </span>
                ) : (
                  <>
                    <span className="hidden sm:inline">⏺ rec</span>
                    <span aria-hidden="true" className="sm:hidden">
                      ⏺
                    </span>
                  </>
                )}
              </button>
              <button
                onClick={() =>
                  gifTotal > 0 ? ((gifCancel.current = true), undefined) : void startGif()
                }
                title={
                  gifTotal > 0
                    ? `encoding GIF… click to cancel (${gifTotal - gifLeft}/${gifTotal})`
                    : `render ${recDur}s animated GIF (E)`
                }
                aria-label={gifTotal > 0 ? "cancel gif encoding" : "save animated gif"}
                className={hbtn}
                style={
                  gifTotal > 0
                    ? { borderColor: "#f87171", color: "#fca5a5", opacity: 1 }
                    : { borderColor: accent + "66" }
                }
              >
                {gifTotal > 0 ? (
                  `◈ ${gifTotal - gifLeft}/${gifTotal} ✕`
                ) : (
                  <>
                    <span className="hidden sm:inline">gif</span>
                    <span aria-hidden="true" className="sm:hidden">
                      g
                    </span>
                  </>
                )}
              </button>
            </div>
            <Divider accent={accent} />
            <button
              onClick={() => void shareLink()}
              title="copy a link that restores this exact view (L)"
              aria-label="copy share link"
              className={hbtn}
              style={{ borderColor: accent + "66" }}
            >
              <span className="hidden sm:inline">share</span>
              <span aria-hidden="true" className="sm:hidden">
                ⇗
              </span>
            </button>
            <Divider accent={accent} />
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                onClick={toggleFullscreen}
                title={isFull ? "leave fullscreen (F)" : "fullscreen (F)"}
                aria-label={isFull ? "leave fullscreen" : "enter fullscreen"}
                aria-pressed={isFull}
                className={`${hbtn} px-2.5`}
                style={{ borderColor: isFull ? accent : accent + "66" }}
              >
                {isFull ? "⤡" : "⛶"}
              </button>
              <button
                onClick={() => setHelpOpen((h) => !h)}
                title="keyboard shortcuts (?)"
                aria-label="keyboard shortcuts"
                className={`${hbtn} px-2.5`}
                style={{ borderColor: accent + "66" }}
              >
                ?
              </button>
              <button
                onClick={() => setPanelOpen((o) => !o)}
                title="toggle control panel (H)"
                aria-label={panelOpen ? "hide control panel" : "show control panel"}
                aria-pressed={panelOpen}
                className={hbtn}
                style={{ borderColor: accent + "66" }}
              >
                <span className="hidden sm:inline">{panelOpen ? "hide" : "panel"}</span>
                <span aria-hidden="true" className="sm:hidden">
                  ▤
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* status bar */}
        <StatusBar
          settings={settings}
          accent={accent}
          demo={demo}
          demoIdx={demoIdx.current}
          demoCount={visibleEntries.length}
          recording={recording}
          recLeft={recLeft}
          animated={animated}
          isCode={isCode}
          gifLeft={gifLeft}
          gifTotal={gifTotal}
        />

        {/* toasts: runtime error (amber), compile error (red), action flash (accent) */}
        <div className="absolute bottom-10 left-4 flex max-w-[calc(100%-2rem)] flex-col items-stretch gap-2">
          {rtError && (
            <div
              role="status"
              className="anim-toast flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-950/85 px-3 py-2 text-[11px] text-amber-200 shadow-lg backdrop-blur-sm"
            >
              <span aria-hidden="true" className="mt-px shrink-0 text-amber-400">
                ⚠
              </span>
              <span className="min-w-0">{rtError}</span>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="anim-toast flex items-start gap-2 rounded-md border border-red-500/50 bg-red-950/85 px-3 py-2 text-[11px] text-red-300 shadow-lg backdrop-blur-sm"
            >
              <span aria-hidden="true" className="mt-px shrink-0 text-red-400">
                ✗
              </span>
              <span className="min-w-0">{error}</span>
            </div>
          )}
          {flash && (
            <div
              className="anim-toast relative overflow-hidden rounded-md border px-3 py-1.5 text-[11px] shadow-lg backdrop-blur-sm"
              style={{
                borderColor: accent + "66",
                borderLeftWidth: "2px",
                background: `color-mix(in srgb, ${settings.theme.bg} 82%, transparent)`,
                color: accent,
              }}
            >
              <span aria-hidden="true" className="mr-1.5 opacity-70">
                ◈
              </span>
              {flash}
              <span
                key={flash}
                aria-hidden="true"
                className="toast-progress absolute bottom-0 left-0 h-px"
                style={{ background: accent, boxShadow: `0 0 6px ${accent}`, opacity: 0.7 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* mobile backdrop + panel */}
      {panelOpen && (
        <>
          <div
            className="anim-fade fixed inset-0 z-20 bg-black/50 backdrop-blur-[2px] md:hidden"
            onClick={() => setPanelOpen(false)}
          />
          {/* desktop drag-resize handle: fixed to the aside's left edge (escapes the scroll container) */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="drag to resize the panel — double-click to reset"
            onPointerDown={onPanelResizeStart}
            onPointerMove={onPanelResizeMove}
            onPointerUp={onPanelResizeEnd}
            onPointerCancel={onPanelResizeEnd}
            onDoubleClick={() => {
              setPanelW(null);
              persistPanelW(null);
            }}
            className={`panel-resize group fixed inset-y-0 z-40 hidden w-2 cursor-col-resize touch-none md:block ${panelResizing ? "is-dragging" : ""}`}
            style={{ right: `calc(var(--panel-w, 320px) - 4px)` }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--panel-line)] transition-[background-color,box-shadow] duration-150 group-hover:bg-[var(--acc)] group-hover:shadow-[0_0_8px_var(--acc)] group-active:bg-[var(--acc)] group-active:shadow-[0_0_10px_var(--acc)]"
            />
          </div>
          <aside
            className={`anim-fade fixed inset-y-0 right-0 z-30 flex h-full w-[86vw] max-w-[86vw] shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-[var(--panel-line)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-colors duration-300 sm:w-[var(--panel-w,320px)] sm:max-w-[85vw] md:static md:z-auto md:max-w-none ${
              lightPanel
                ? "bg-[#faf8f2]/90 text-[#1a1a1a] md:bg-[#f2efe8]/85"
                : "bg-black/75 text-white md:bg-black/60"
            }`}
          >
            <Section
              title="Shape"
              icon="◆"
              right={
                <button
                  onClick={pickMesh}
                  title="import an STL / OBJ mesh (M) — or drop it on the viewport"
                  className="rounded border border-[var(--panel-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--panel-dim)] transition-colors hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)]"
                >
                  + import mesh
                </button>
              }
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter shapes…"
                aria-label="filter shapes"
                className="mb-2 w-full rounded border border-[var(--panel-line)] bg-[var(--panel-input)] px-2 py-1 text-[11px] text-[var(--panel-text)] outline-none transition-colors placeholder:text-[var(--panel-dimmer)] hover:border-[var(--panel-dim)] focus:border-current"
              />
              {query.trim() !== "" && (
                <p className="-mt-1.5 mb-2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--panel-head)]">
                  {filteredEntries.length} match{filteredEntries.length === 1 ? "" : "es"}
                  {filteredEntries.length === 0 && (
                    <button
                      onClick={() => setQuery("")}
                      className="ml-2 lowercase tracking-normal underline decoration-dotted"
                    >
                      clear
                    </button>
                  )}
                </p>
              )}
              <div className="flex flex-wrap gap-0.5">
                {(["All", "★", ...CATEGORIES] as const).map((c) => {
                  const active = cat === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setCat(c)}
                      aria-pressed={active}
                      title={c === "★" ? "pinned favorites" : c}
                      className="rounded border px-1.5 py-0.5 text-[10px] transition-all duration-150 hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:scale-[0.97]"
                      style={
                        active
                          ? {
                              borderColor: accent,
                              color: accent,
                              background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                            }
                          : { borderColor: "var(--panel-chip)", color: "var(--panel-dim)" }
                      }
                    >
                      {c === "★" ? `★${favs.size > 0 ? favs.size : ""}` : c}
                    </button>
                  );
                })}
              </div>
              <div key={cat} className="mt-2 grid grid-cols-3 gap-1">
                {filteredEntries.map((p, i) => {
                  const id = entryIdOf(p);
                  const active = id === entryId;
                  const fav = favs.has(id);
                  const nm = entryName(p);
                  const anim = p.tag === "native" && p.shape.animated && !nm.includes("⟲");
                  return (
                    <div
                      key={id}
                      className="card-in group relative"
                      style={{ animationDelay: `${Math.min(i * 14, 220)}ms` }}
                    >
                      <button
                        onClick={() => loadEntry(p)}
                        title={entryDescription(p)}
                        aria-pressed={active}
                        className={`w-full truncate rounded border px-1.5 py-1 text-[11px] transition-all duration-150 hover:-translate-y-px hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:translate-y-0 active:scale-95 ${fav ? "pr-4" : ""}`}
                        style={
                          active
                            ? {
                                borderColor: accent,
                                color: accent,
                                background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                                boxShadow: `0 0 10px ${accent}22, inset 0 0 8px ${accent}11`,
                              }
                            : { borderColor: "var(--panel-chip)", color: "var(--panel-dim)" }
                        }
                      >
                        {nm}
                        {anim ? " ⟲" : ""}
                      </button>
                      <button
                        onClick={() => toggleFav(id)}
                        aria-pressed={fav}
                        aria-label={fav ? `unpin ${nm}` : `pin ${nm} to favorites`}
                        title={fav ? "unpin" : "pin to ★ favorites"}
                        className={`absolute right-0.5 top-1/2 -translate-y-1/2 text-[10px] leading-none transition-all duration-150 hover:scale-125 active:scale-95 ${
                          fav ? "opacity-100" : "opacity-0 group-hover:opacity-70"
                        }`}
                        style={
                          fav
                            ? { color: "#ffd75e", textShadow: "0 0 6px rgba(255, 215, 94, 0.55)" }
                            : { color: "var(--panel-text)" }
                        }
                      >
                        <span key={String(fav)} className={`inline-block ${fav ? "star-pop" : ""}`}>
                          {fav ? "★" : "☆"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {cat === "★" && favs.size === 0 && (
                <p className="mt-2 rounded border border-dashed border-[var(--panel-line)] px-2 py-1.5 text-[10px] leading-snug text-[var(--panel-dimmer)]">
                  no favorites yet — tap the ☆ on a shape to pin it here (the ★ chip + demo then
                  scope to your pins).
                </p>
              )}
              {filteredEntries.length === 0 && (
                <p className="mt-2 rounded border border-dashed border-[var(--panel-line)] px-2 py-1.5 text-[10px] leading-snug text-[var(--panel-dimmer)]">
                  no shapes match “{query.trim()}” — try “knot”, “attractor”, “implicit”…
                </p>
              )}
              {entryId === MESH_ID && mesh && (
                <p
                  className="mt-2 rounded border border-dashed px-2 py-1 text-[10px] leading-snug"
                  style={{ borderColor: accent, color: accent }}
                >
                  imported mesh active — meshes aren't persisted; re-import after a reload.
                </p>
              )}
            </Section>

            {activeShape && activeShape.params.length > 0 && (
              <Section
                title="Parameters"
                icon="≡"
                right={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={rerollParams}
                      title="re-roll this shape's parameters (🎲)"
                      className="rounded border border-[var(--panel-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--panel-dim)] transition-colors hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:scale-95"
                    >
                      ⚄ re-roll
                    </button>
                    <button
                      onClick={resetParams}
                      title="restore default parameters"
                      className="rounded border border-[var(--panel-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--panel-dim)] transition-colors hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:scale-95"
                    >
                      reset
                    </button>
                  </div>
                }
              >
                {activeShape.params.map((spec) => (
                  <Slider
                    key={spec.key}
                    label={spec.label}
                    value={curParams[spec.key]}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    onChange={(v) => patchParam(spec.key, spec.int ? Math.round(v) : v)}
                    fmt={(v) => (spec.int ? String(Math.round(v)) : v.toFixed(2))}
                  />
                ))}
              </Section>
            )}

            {activeShape && generatedDef && (
              <Section title={codeTitle(generatedDef.kind)}>
                <textarea
                  value={generatedDef.code}
                  onChange={(e) => convertNativeToCustom(e.target.value)}
                  spellCheck={false}
                  rows={Math.min(22, Math.max(6, generatedDef.code.split("\n").length))}
                  aria-label="shape code editor"
                  className="w-full resize-y rounded border border-[var(--panel-line)] bg-[var(--panel-input)] p-2 font-mono text-[11.5px] leading-relaxed text-[var(--panel-text)] outline-none transition-colors hover:border-[var(--panel-dim)] focus:border-current"
                />
                <p className="mt-1 text-[10px] leading-snug text-[var(--panel-dimmer)]">
                  Start typing to customize — this converts the shape into an editable code surface
                  (it becomes "Custom"). Re-select the shape in the grid to return to its parameter
                  sliders.
                </p>
              </Section>
            )}

            {isCode && (
              <Section title={codeTitle(activeDef.kind)}>
                <Segmented
                  options={KINDS}
                  labels={{ planar: "shader" }}
                  value={activeDef.kind}
                  onChange={(k) => switchKind(k as SurfaceDef["kind"])}
                  label="surface kind"
                  cols={3}
                />
                {activeDef.kind === "implicit" && (
                  <div className="mb-2 grid grid-cols-2 gap-2 text-[10px] text-[var(--panel-dim)]">
                    <div>
                      <div className="mb-1">bound (± cube)</div>
                      <NumInput
                        value={activeDef.bound ?? 3}
                        onChange={(v) => editDef({ ...def, bound: v }, "bound")}
                      />
                    </div>
                    <div>
                      <div className="mb-1">iso level</div>
                      <NumInput
                        value={activeDef.iso ?? 0}
                        onChange={(v) => editDef({ ...def, iso: v }, "iso")}
                      />
                    </div>
                  </div>
                )}
                {activeDef.kind === "implicit" && (
                  <Slider
                    label="grid quality"
                    value={activeDef.quality ?? 40}
                    min={8}
                    max={96}
                    step={2}
                    onChange={(v) => editDef({ ...def, quality: Math.round(v) }, "quality")}
                    fmt={(v) => `${Math.round(v)}³ cells`}
                  />
                )}
                {activeDef.kind === "planar" && (
                  <div className="mb-2">
                    <div className="mb-1 text-[10px] text-[var(--panel-dim)]">
                      span (u, v range)
                    </div>
                    <NumInput
                      value={activeDef.span ?? 4}
                      onChange={(v) => editDef({ ...def, span: v }, "span")}
                    />
                  </div>
                )}
                <textarea
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value;
                    let nextDef = def;
                    let nextId = curRef.current.entryId;
                    if (def.id !== "custom") {
                      nextId = "custom";
                      nextDef = {
                        ...def,
                        id: "custom",
                        name: "Custom " + def.name,
                        description: "Edited surface",
                      };
                      setEntryId("custom");
                      setDef(nextDef);
                    }
                    setCode(v);
                    pushSnap(
                      {
                        entryId: nextId,
                        def: nextDef,
                        code: v,
                        paramValues: curRef.current.paramValues,
                        settings: curRef.current.settings,
                      },
                      "code",
                      1500,
                    );
                  }}
                  spellCheck={false}
                  rows={
                    isHeight
                      ? 3
                      : activeDef.kind === "implicit" ||
                          activeDef.kind === "generate" ||
                          activeDef.kind === "sim"
                        ? 12
                        : 8
                  }
                  aria-label="surface code editor"
                  className={`w-full resize-y rounded border bg-[var(--panel-input)] p-2 font-mono text-[11.5px] leading-relaxed text-[var(--panel-text)] outline-none transition-colors ${
                    error
                      ? "border-red-500/60"
                      : "border-[var(--panel-line)] hover:border-[var(--panel-dim)] focus:border-current"
                  }`}
                />
                <p className="mt-1 text-[10px] leading-snug text-[var(--panel-dimmer)]">
                  {isHeight
                    ? "JS expression using x, y and time t. Math functions are in scope: sin, cos, exp, sqrt, abs, PI…"
                    : activeDef.kind === "implicit"
                      ? "JS body in x, y, z and time t; return the level value (surface where it crosses the iso level). Bare expressions are auto-wrapped."
                      : activeDef.kind === "generate"
                        ? "JS body calling push(x, y, z, nx, ny, nz) and glow(x, y, z, lum). time and Math are in scope."
                        : activeDef.kind === "sim"
                          ? "JS body returning { step(dt, time) {...} } — keep state in closures and emit with push/glow. Optional planar(cols, rows, aspect, out)."
                          : activeDef.kind === "planar"
                            ? "Shader body in u, v and time t; return luminance 0..1 per cell (NaN leaves the cell empty). Also in scope: mx, my (mouse), zoom, cols, rows, aspect, and prev(u, v) — the last frame's luminance."
                            : "JS body using u, v and time t; must return [x, y, z]. Math functions in scope."}
                </p>
                {isCodeKind && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[var(--panel-dim)]">
                    <div>
                      <div className="mb-1">{isHeight ? "x" : "u"} range</div>
                      <div className="flex gap-1">
                        <NumInput
                          value={def.uRange![0]}
                          onChange={(v) =>
                            editDef({ ...def, uRange: [v, def.uRange![1]] }, "range")
                          }
                        />
                        <NumInput
                          value={def.uRange![1]}
                          onChange={(v) =>
                            editDef({ ...def, uRange: [def.uRange![0], v] }, "range")
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1">{isHeight ? "y" : "v"} range</div>
                      <div className="flex gap-1">
                        <NumInput
                          value={def.vRange![0]}
                          onChange={(v) =>
                            editDef({ ...def, vRange: [v, def.vRange![1]] }, "range")
                          }
                        />
                        <NumInput
                          value={def.vRange![1]}
                          onChange={(v) =>
                            editDef({ ...def, vRange: [def.vRange![0], v] }, "range")
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
                {isCodeKind && (
                  <div className="mt-2">
                    <Slider
                      label="scale"
                      value={def.scale!}
                      min={0.2}
                      max={3}
                      step={0.05}
                      onChange={(v) => editDef({ ...def, scale: v }, "scale")}
                      fmt={(v) => v.toFixed(2)}
                    />
                  </div>
                )}
              </Section>
            )}

            <ViewSections
              settings={settings}
              patch={patch}
              accent={accent}
              apiRef={apiRef}
              recDur={recDur}
              setRecDur={setRecDur}
            />
            <ScenesSection
              scenes={scenes}
              sceneName={sceneName}
              setSceneName={setSceneName}
              saveScene={saveScene}
              loadScene={loadScene}
              deleteScene={deleteScene}
              exportScene={exportScene}
              sceneInputRef={sceneInputRef}
              accent={accent}
            />
            <ThemeSection
              settings={settings}
              allThemesList={allThemesList}
              customThemes={customThemes}
              themeDraft={themeDraft}
              setThemeDraft={setThemeDraft}
              saveTheme={saveTheme}
              deleteTheme={deleteTheme}
              applyTheme={applyTheme}
              accent={accent}
            />

            <div className="mt-auto px-4 py-3 text-[10px] leading-relaxed text-[var(--panel-dimmer)]">
              Geometry generators feed a shared point pipeline: transform, project, z-buffer, shade
              into the charset. Parametric, implicit, mesh, curve, planar and simulated shapes all
              ride the same path. State auto-saves locally; share links encode it.
              <span className="mt-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.25em] text-[var(--panel-dimmer)]">
                <span className="inline-block h-[2px] w-[2px] rounded-full bg-[var(--acc)] opacity-70" />
                ascii.surf · {SHAPES.length} shapes · {THEMES.length}+ themes
              </span>
            </div>
          </aside>
        </>
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        items={paletteItems}
        onClose={() => setPaletteOpen(false)}
      />
      <BootRain />
    </div>
  );
}
