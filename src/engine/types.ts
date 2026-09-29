/** Shared engine types: legacy code-string surfaces and native shapes. */

export type Vec3 = [number, number, number];

/** Legacy user-editable surface defined by a JS code string (compiled at runtime). */
export interface SurfaceDef {
  id: string;
  name: string;
  kind:
    | "parametric" // code: (u, v, t) body returning [x, y, z]
    | "height" // code: expression in x, y, t returning z
    | "implicit" // code: body in x, y, z, t returning a level value (crosses `iso`)
    | "generate" // code: body calling push(x,y,z,nx,ny,nz) / glow(x,y,z,lum) / time
    | "sim" // code: body returning { step(dt, time), planar?(cols, rows, aspect, out) }
    | "planar"; // shader: body in u, v, t (+ mx, my, zoom, cols, rows, aspect, prev) returning luminance 0..1 (NaN = empty cell)
  code: string; // user-visible source
  uRange?: [number, number]; // parametric / height
  vRange?: [number, number];
  scale?: number; // parametric / height
  bound?: number; // implicit: sampling cube is [-bound, bound]^3
  iso?: number; // implicit: target level
  quality?: number; // implicit: grid resolution (default 40)
  span?: number; // planar: u/v span (default 4, i.e. u, v ∈ [-2, 2])
  /** generate only: fade emissive luminance with camera-space depth, like the native shape's PointFrame.depthTint. */
  depthTint?: boolean;
  category?: Category; // presets: which registry section they lead (default "Surfaces")
  description: string;
}

export type SurfaceFn = (u: number, v: number, t: number) => Vec3;

/** Declarative parameter for native shapes — rendered as a slider in the UI. */
interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  int?: boolean;
}

export type Params = Record<string, number>;

export function defaultParams(specs: ParamSpec[]): Params {
  const p: Params = {};
  for (const s of specs) p[s.key] = s.def;
  return p;
}

/**
 * Reusable point batch: geometry generators append points, the renderer consumes
 * them. Arrays grow geometrically via frameEnsure, so steady-state frames never
 * reallocate. `mode` selects shading: "lit" uses nrm (surface normals), while
 * "emissive" uses per-point lum directly (simulations, trails, wireframes).
 */
export interface PointFrame {
  pos: Float32Array;
  nrm: Float32Array;
  lum: Float32Array;
  count: number;
  cap: number;
  mode: "lit" | "emissive";
  /** emissive only: additionally fade luminance with camera-space depth */
  depthTint: boolean;
}

export function makeFrame(cap = 1 << 12): PointFrame {
  return {
    pos: new Float32Array(cap * 3),
    nrm: new Float32Array(cap * 3),
    lum: new Float32Array(cap),
    count: 0,
    cap,
    mode: "lit",
    depthTint: false,
  };
}

export function frameEnsure(pf: PointFrame, minCap: number): void {
  if (pf.cap >= minCap) return;
  const cap = Math.max(minCap, Math.ceil(pf.cap * 1.6));
  const pos = new Float32Array(cap * 3);
  pos.set(pf.pos.subarray(0, pf.count * 3));
  const nrm = new Float32Array(cap * 3);
  nrm.set(pf.nrm.subarray(0, pf.count * 3));
  const lum = new Float32Array(cap);
  lum.set(pf.lum.subarray(0, pf.count));
  pf.pos = pos;
  pf.nrm = nrm;
  pf.lum = lum;
  pf.cap = cap;
}

/** Append a lit point (normal used for shading). Non-finite coordinates are dropped. */
export function framePush(
  pf: PointFrame,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
  if (pf.count >= pf.cap) frameEnsure(pf, pf.cap * 2 + 4096);
  const k = pf.count * 3;
  pf.pos[k] = x;
  pf.pos[k + 1] = y;
  pf.pos[k + 2] = z;
  pf.nrm[k] = nx;
  pf.nrm[k + 1] = ny;
  pf.nrm[k + 2] = nz;
  pf.lum[pf.count] = 0; // zero, never stale: an emissive frame must not read the slot's previous occupant
  pf.count++;
}

/** Append an emissive point (fixed luminance, shading skipped). */
export function frameGlow(pf: PointFrame, x: number, y: number, z: number, l: number): void {
  if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
  if (pf.count >= pf.cap) frameEnsure(pf, pf.cap * 2 + 4096);
  const k = pf.count * 3;
  pf.pos[k] = x;
  pf.pos[k + 1] = y;
  pf.pos[k + 2] = z;
  pf.nrm[k] = 0;
  pf.nrm[k + 1] = 0;
  pf.nrm[k + 2] = 1;
  pf.lum[pf.count] = l;
  pf.count++;
}

export type Category = "Surfaces" | "Knots" | "Polytopes" | "Fractals" | "Simulations" | "Shaders";
export const CATEGORIES: Category[] = [
  "Surfaces",
  "Knots",
  "Polytopes",
  "Fractals",
  "Simulations",
  "Shaders",
];

export interface ParametricBuild {
  fn: SurfaceFn;
  uRange: [number, number];
  vRange: [number, number];
  scale: number;
}

export interface ImplicitBuild {
  f: (x: number, y: number, z: number, t: number) => number;
  bound: number; // sampling cube is [-bound, bound]^3
  iso: number; // target level set
}

/** Pointer state shared with interactive shapes: 0..1 view coords (y down). */
export interface Pointer {
  x: number;
  y: number;
  down: boolean;
}

/** Stateful animation: step(deltaTime) then either emit points or a planar field. */
export interface Sim {
  /** `pointer` is the live viewport pointer (same mutable object every frame). */
  step(dt: number, time: number, out: PointFrame, pointer?: Pointer): void;
  /** When present the sim renders as a 2D luminance field (cols*rows, -1 = empty). */
  planar?(cols: number, rows: number, aspect: number, out: Float32Array, pointer?: Pointer): void;
}

/**
 * Native shape — exactly one builder decides how geometry is produced:
 * parametric P(u,v), implicit F(x,y,z), explicit generate() point cloud,
 * a stateful sim, or a 2D planar density field. See renderer.renderFrame.
 */
export interface Shape {
  id: string;
  name: string;
  category: Category;
  description: string;
  animated: boolean;
  params: ParamSpec[];
  parametric?: (p: Params) => ParametricBuild;
  implicit?: (p: Params) => ImplicitBuild;
  generate?: (p: Params, time: number, out: PointFrame) => void;
  sim?: (p: Params, seed: number) => Sim;
  planar?: (
    p: Params,
    time: number,
    cols: number,
    rows: number,
    aspect: number,
    out: Float32Array,
    pointer?: Pointer,
  ) => void;
  /**
   * Equivalent editable code for this shape, with the given parameter values
   * baked in as constants. Editing the produced source in the UI converts the
   * entry into a custom code surface (kind: parametric | implicit | generate | sim).
   */
  toCode?: (p: Params) => SurfaceDef;
}

export type ShapeEntry = { tag: "code"; def: SurfaceDef } | { tag: "native"; shape: Shape };

export type Renderable =
  // fn may be null while a code surface fails to compile; the view layer skips
  // rendering in that case (and the renderer guards it defensively).
  | { tag: "code"; def: SurfaceDef; fn: SurfaceFn | null }
  | { tag: "native"; shape: Shape; params: Params };

// --- builders for editable-code equivalents of native shapes -----------------

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function paramCode(
  body: string,
  uRange: [number, number],
  vRange: [number, number],
  scale: number,
  name: string,
): SurfaceDef {
  return {
    id: slug(name) + "-code",
    name: name + " (code)",
    kind: "parametric",
    code: body,
    uRange,
    vRange,
    scale,
    description: "Editable-code version of " + name + ".",
  };
}

export function implicitCode(body: string, bound: number, iso: number, name: string): SurfaceDef {
  return {
    id: slug(name) + "-code",
    name: name + " (code)",
    kind: "implicit",
    code: body,
    bound,
    iso,
    quality: 40,
    description: "Editable-code version of " + name + ".",
  };
}

export function generateCode(body: string, name: string, depthTint = false): SurfaceDef {
  return {
    id: slug(name) + "-code",
    name: name + " (code)",
    kind: "generate",
    code: body,
    depthTint,
    description: "Editable-code version of " + name + ".",
  };
}

export function simCode(body: string, name: string): SurfaceDef {
  return {
    id: slug(name) + "-code",
    name: name + " (code)",
    kind: "sim",
    code: body,
    description: "Editable-code version of " + name + ".",
  };
}

export function planarCode(body: string, span: number, name: string): SurfaceDef {
  return {
    id: slug(name) + "-code",
    name: name + " (code)",
    kind: "planar",
    code: body,
    span,
    description: "Editable-code version of " + name + ".",
  };
}
