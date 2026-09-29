/**
 * Scene resolution: CLI flags (+ optional web share state) → the shape entry,
 * renderable and view settings the engine consumes. Mirrors App.tsx's
 * construction — native entries carry merged parameters, code entries carry a
 * compiled surface fn — so both frontends render identically.
 */
import { CHARSETS } from "../../src/engine/presets";
import { SHAPES, entryCategory, entryId, entryName, findEntry } from "../../src/engine/registry";
import { compileSurface } from "../../src/engine/renderer";
import {
  defaultParams,
  type Params,
  type Renderable,
  type Shape,
  type ShapeEntry,
  type SurfaceDef,
  type Vec3,
} from "../../src/engine/types";
import { DEFAULT_SETTINGS, restoreFromEncoded, type Restored } from "../../src/state";
import { THEMES, type Theme } from "../../src/themes";
import type { ViewSettings } from "../../src/types";
import { HOME_ANGLES, clampZoom } from "../../src/view";
import type { CliOptions } from "./args";

export class SceneError extends Error {}

/** Clamp to the web UI's slider range — hand-typed flag values must not produce degenerate frames. */
const clampRange = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Scene {
  name: string;
  /** Registry id of the current entry ("" for custom code surfaces). */
  entryId: string;
  renderable: Renderable;
  settings: ViewSettings;
  /** Initial orbit angles (the live session owns them from here on). */
  angles: Vec3;
}

// --- lookup helpers ----------------------------------------------------------

export function resolveShape(token: string): ShapeEntry {
  if (/^\d+$/.test(token)) {
    const n = parseInt(token, 10);
    if (n < 1 || n > SHAPES.length)
      throw new SceneError(`shape index ${n} out of range (1–${SHAPES.length})`);
    return SHAPES[n - 1];
  }
  const exact = findEntry(token);
  if (exact) return exact;
  const lower = token.toLowerCase();
  const byName = SHAPES.filter((e) => entryName(e).toLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  const partial = SHAPES.filter(
    (e) => entryName(e).toLowerCase().includes(lower) || entryId(e).toLowerCase().includes(lower),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length === 0)
    throw new SceneError(`no shape matching "${token}" — run --list shapes`);
  throw new SceneError(
    `"${token}" is ambiguous: ${partial.slice(0, 8).map(entryId).join(", ")}${partial.length > 8 ? ` … (${partial.length} total)` : ""}`,
  );
}

export function lookupTheme(name: string): Theme {
  const lower = name.toLowerCase();
  const exact = THEMES.find((t) => t.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = THEMES.filter((t) => t.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  throw new SceneError(
    partial.length === 0
      ? `no theme named "${name}" — run --list themes`
      : `"${name}" is ambiguous: ${partial.map((t) => t.name).join(", ")}`,
  );
}

/** A built-in charset by name, or any non-empty string used as raw glyphs. */
function lookupCharset(token: string): string {
  const c = CHARSETS.find((k) => k.name.toLowerCase() === token.toLowerCase());
  if (c) return c.chars;
  if (token.trim() === "")
    throw new SceneError(`--charset needs a name (--list charsets) or a glyph string`);
  return token;
}

type ParamSpec = Shape["params"][number];

/** defaults < stored state < --set, each override clamped into the spec range. */
export function mergedParams(
  specs: ParamSpec[],
  stored: Params | undefined,
  overrides: Array<[string, number]>,
): Params {
  const p = defaultParams(specs);
  if (stored) for (const [k, v] of Object.entries(stored)) if (k in p) p[k] = v;
  for (const [k, v] of overrides) {
    const spec = specs.find((s) => s.key === k);
    if (!spec) throw new SceneError(`unknown parameter "${k}" for this shape`);
    const clamped = Math.max(spec.min, Math.min(spec.max, v));
    p[k] = spec.int ? Math.round(clamped) : clamped;
  }
  return p;
}

function makeRenderable(entry: ShapeEntry, params: Params, def?: SurfaceDef): Renderable {
  if (entry.tag === "native") return { tag: "native", shape: entry.shape, params };
  // same contract as the web app: fn may be null when compilation fails; the
  // renderer compiles non-parametric kinds from the def itself.
  let fn: ReturnType<typeof compileSurface> | null;
  try {
    fn = compileSurface(def ?? entry.def);
  } catch {
    fn = null;
  }
  return { tag: "code", def: def ?? entry.def, fn };
}

/** Scene for an arbitrary entry, reusing the live session's settings object. */
export function entryScene(entry: ShapeEntry, settings: ViewSettings): Scene {
  const params = entry.tag === "native" ? defaultParams(entry.shape.params) : {};
  return {
    name: entryName(entry),
    entryId: entryId(entry),
    renderable: makeRenderable(entry, params),
    settings,
    angles: [...HOME_ANGLES],
  };
}

// --- full build --------------------------------------------------------------

export function buildScene(opts: CliOptions): Scene {
  const restored: Restored | null = opts.state ? restoreFromEncoded(opts.state) : null;
  if (opts.state && !restored) {
    throw new SceneError(
      "could not decode --state (expected the base64url string after #s= in a share link)",
    );
  }

  const settings: ViewSettings = restored
    ? { ...DEFAULT_SETTINGS, ...restored.settings }
    : { ...DEFAULT_SETTINGS };

  // style
  if (opts.theme) settings.theme = lookupTheme(opts.theme);
  if (opts.charset) settings.charset = lookupCharset(opts.charset);
  if (opts.color) settings.colorMode = opts.color;

  // view — zoom uses the app's canonical clamp; the rest follow the web
  // sliders' ranges so a typo like --fov 0 can't collapse the frame
  if (opts.zoom !== null) settings.zoom = clampZoom(opts.zoom);
  if (opts.speed !== null) settings.speed = clampRange(opts.speed, 0, 4);
  if (opts.spin) settings.spin = [...opts.spin];
  if (opts.noSpin) settings.autoRotate = false;
  if (opts.ortho) settings.projection = "ortho";
  if (opts.fov !== null) settings.fov = clampRange(opts.fov, 1.2, 4.8);
  if (opts.camDist !== null) settings.camDist = clampRange(opts.camDist, 2.5, 12);
  if (opts.light) settings.light = [...opts.light];
  if (opts.ambient !== null) settings.ambient = opts.ambient;
  if (opts.diffuse !== null) settings.diffuse = opts.diffuse;
  if (opts.specular !== null) settings.specular = opts.specular;
  if (opts.shininess !== null) settings.shininess = opts.shininess;
  if (opts.pointSize !== null) settings.pointSize = opts.pointSize;
  if (opts.jitter !== null) settings.jitter = opts.jitter;
  if (opts.persistence !== null) settings.persistence = opts.persistence;
  if (opts.fog !== null) settings.fog = opts.fog;
  if (opts.samples !== null) settings.samples = clampRange(Math.round(opts.samples), 40, 400);
  if (opts.samplesV !== null) settings.samplesV = clampRange(Math.round(opts.samplesV), 40, 400);

  // entry — explicit --shape wins over a restored scene's shape
  let entry: ShapeEntry;
  if (opts.shape) {
    entry = resolveShape(opts.shape);
  } else if (restored) {
    const registered = findEntry(restored.entryId);
    if (registered?.tag === "native") {
      entry = registered;
    } else {
      // a registered code preset carries its edited def; "custom" has no entry
      entry = { tag: "code", def: restored.def };
    }
  } else {
    entry = SHAPES[0];
  }

  let renderable: Renderable;
  if (entry.tag === "native") {
    const stored = restored?.paramValues[entry.shape.id];
    const params = mergedParams(entry.shape.params, stored, opts.set);
    renderable = { tag: "native", shape: entry.shape, params };
  } else {
    if (opts.set.length > 0)
      throw new SceneError("--set applies to native shape parameters; this shape has none");
    renderable = makeRenderable(entry, {});
  }

  return {
    name: entryName(entry),
    entryId: entryId(entry),
    renderable,
    settings,
    angles: opts.angle ? [...opts.angle] : [...HOME_ANGLES],
  };
}

// --- --list ------------------------------------------------------------------

export function listShapes(): string {
  const rows = SHAPES.map((e, i) => {
    const n = String(i + 1).padStart(2);
    const id = entryId(e).padEnd(26);
    const cat = entryCategory(e).padEnd(12);
    return `${n}  ${id}${cat}${entryName(e)}`;
  });
  return ["idx  id                         category    name", ...rows].join("\n");
}

export function listThemes(): string {
  return THEMES.map(
    (t) => `${t.name.padEnd(14)}${t.mode.padEnd(6)}bg ${t.bg}  fg ${t.fg}  glow ${t.glow}`,
  ).join("\n");
}

export function listCharsets(): string {
  return CHARSETS.map((k) => `${k.name.padEnd(10)}${k.chars}`).join("\n");
}
