/**
 * Scene persistence codec + the persistence layer: the whole app state
 * (shape + code + parameters + view settings) as JSON, base64url-encoded for
 * URLs and localStorage — plus the localStorage load/save helpers for the
 * autosave, favorites, scenes and panel width. UI owns when to call these;
 * this module owns how state is shaped, validated and stored.
 */
import { CHARSETS, PRESETS } from "./engine/presets";
import { findEntry } from "./engine/registry";
import { THEMES, loadCustomThemes } from "./themes";
import type { Params, SurfaceDef } from "./engine/types";
import type { ViewSettings } from "./types";

type StoredSettings = Omit<ViewSettings, "theme"> & { themeName: string };

// v2: registry ids + per-shape parameters. def/code present only for code entries.
export interface StoredStateV2 {
  v: number;
  entryId: string;
  def?: SurfaceDef;
  code?: string;
  paramValues?: Record<string, Params>;
  settings: StoredSettings;
}

export interface Restored {
  entryId: string;
  def: SurfaceDef;
  code: string;
  paramValues: Record<string, Params>;
  settings: ViewSettings;
}

const LS_KEY = "ascii-surf-state-v1";
const SCENES_KEY = "ascii-surf-scenes-v1";
const FAVS_KEY = "ascii-surf-favs-v1";
const PANELW_KEY = "ascii-surf-panelw-v1";

/** Canonical startup settings — the base every restored/partial state layers onto. */
export const DEFAULT_SETTINGS: ViewSettings = {
  fontSize: 13,
  charset: CHARSETS[0].chars,
  light: [0.4, 0.6, -1],
  zoom: 1,
  speed: 1,
  autoRotate: true,
  samples: 160,
  samplesV: 0, // 0 = square grid (v follows u)
  theme: THEMES[0],
  spin: [0.6, 1.0, 0.25],
  paused: false,
  timeScale: 1,
  projection: "perspective",
  fov: 2.4,
  camDist: 5,
  ambient: 0.12,
  diffuse: 0.88,
  specular: 0,
  shininess: 24,
  pointSize: 1,
  jitter: 0,
  persistence: 0,
  fog: 0,
  debug: false,
  demoDwell: 8,
  gridOverlay: false,
  pngScale: 1,
  pngTransparent: false,
  colorMode: "ramp",
};

export function encodeState(s: StoredStateV2): string {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeState(raw: string): StoredStateV2 | null {
  try {
    const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))),
    ) as StoredStateV2;
  } catch {
    return null;
  }
}

export function sanitizeParamValues(
  pv: Record<string, Params> | undefined,
): Record<string, Params> {
  if (!pv) return {};
  const out: Record<string, Params> = {};
  for (const [id, params] of Object.entries(pv)) {
    if (!params || typeof params !== "object") continue;
    const clean: Params = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
    }
    out[id] = clean;
  }
  return out;
}

// --- startup restore ---------------------------------------------------------

export interface RestoredState {
  restored: Restored | null;
  sharedLinkInvalid: boolean;
}

/** Every selectable theme: the 12 built-ins plus locally saved custom ones. */
const allThemes = () => THEMES.concat(loadCustomThemes());

/** URL hash (#s=…) wins over localStorage so shared links behave predictably; the hash is
 * stripped after restore so the autosaved (possibly later-edited) state wins on next reload.
 * v1 states are imported. A hash that fails to decode sets sharedLinkInvalid so the UI can
 * explain why the shared view didn't load. */
export function restoreState(): RestoredState {
  let stored: StoredStateV2 | null;
  let sharedLinkInvalid = false;
  if (window.location.hash.startsWith("#s=")) {
    stored = decodeState(window.location.hash.slice(3));
    if (!stored) sharedLinkInvalid = true;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } else {
    stored = decodeState(localStorage.getItem(LS_KEY) ?? "");
  }
  const restored = finishRestore(stored);
  return { restored, sharedLinkInvalid };
}

/** Node-safe shared-scene restore: decode an encoded state string without
 * touching window/localStorage (the CLI loads web share strings with this). */
export function restoreFromEncoded(raw: string): Restored | null {
  return finishRestore(decodeState(raw));
}

function finishRestore(stored: StoredStateV2 | null): Restored | null {
  const finish = (
    entryId: string,
    def: SurfaceDef,
    code: string,
    paramValues: Record<string, Params>,
    rawSettings: Partial<StoredSettings> | undefined,
  ): Restored | null => {
    if (!rawSettings) return null;
    const theme = allThemes().find((t) => t.name === rawSettings.themeName) ?? THEMES[0];
    return {
      entryId,
      def,
      code,
      paramValues: sanitizeParamValues(paramValues),
      settings: { ...DEFAULT_SETTINGS, ...rawSettings, theme } as ViewSettings,
    };
  };
  if (stored && stored.v === 2 && stored.settings) {
    const entry = findEntry(stored.entryId);
    if (entry?.tag === "native") {
      return finish(
        stored.entryId,
        PRESETS[0],
        PRESETS[0].code,
        stored.paramValues ?? {},
        stored.settings,
      );
    }
    // code entries (registered or custom) need a usable def+code pair
    const def = stored.def ?? (entry?.tag === "code" ? entry.def : null);
    if (def && typeof def.code === "string") {
      const id = entry?.tag === "code" ? stored.entryId : "custom";
      return finish(id, def, stored.code ?? def.code, stored.paramValues ?? {}, stored.settings);
    }
    return null;
  }
  // v1 import: { v: 1, def, settings }
  const old = stored as unknown as {
    v: number;
    def?: SurfaceDef;
    settings?: StoredSettings;
  } | null;
  if (old && old.v === 1 && old.def && typeof old.def.code === "string" && old.settings) {
    const entry = findEntry(old.def.id);
    return finish(entry ? old.def.id : "custom", old.def, old.def.code, {}, old.settings);
  }
  return null;
}

// --- autosave / favorites / panel width --------------------------------------

/** Debounced autosave target — App owns the debounce, this owns the write. */
export function persistState(payload: StoredStateV2) {
  try {
    localStorage.setItem(LS_KEY, encodeState(payload));
  } catch {
    /* storage blocked or full */
  }
}

/** Pinned registry shape ids for the ★ favorites row; unknown ids are pruned. */
export function loadFavs(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAVS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((x): x is string => typeof x === "string" && findEntry(x) !== null));
  } catch {
    return new Set();
  }
}

export function persistFavs(favs: Set<string>) {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify([...favs]));
  } catch {
    /* storage blocked */
  }
}

/** Desktop panel width bounds for the drag-resize handle (mobile stays 86vw). */
export const PANEL_W_MIN = 280;
export const PANEL_W_MAX = 520;

export function loadPanelW(): number | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PANELW_KEY) ?? "null");
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, raw))
      : null;
  } catch {
    return null;
  }
}

export function persistPanelW(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(PANELW_KEY);
    else localStorage.setItem(PANELW_KEY, JSON.stringify(w));
  } catch {
    /* storage blocked */
  }
}

// --- scenes ------------------------------------------------------------------

/** Named snapshots of the full app state (shape + code + view + theme). */
export interface Scene {
  name: string;
  ts: number;
  state: StoredStateV2;
}

export function loadScenes(): Scene[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SCENES_KEY) ?? "[]");
    if (Array.isArray(raw))
      return raw.filter(
        (s): s is Scene => !!s && typeof (s as Scene).name === "string" && !!(s as Scene).state,
      );
  } catch {
    /* storage blocked */
  }
  return [];
}

export function persistScenes(list: Scene[]) {
  try {
    localStorage.setItem(SCENES_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}
