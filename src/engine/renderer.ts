import {
  defaultParams,
  frameEnsure,
  frameGlow,
  framePush,
  makeFrame,
  type ImplicitBuild,
  type ParametricBuild,
  type Params,
  type Pointer,
  type PointFrame,
  type Renderable,
  type Shape,
  type Sim,
  type SurfaceDef,
  type SurfaceFn,
  type Vec3,
} from "./types";

export interface RenderOptions {
  cols: number;
  rows: number;
  angleX: number;
  angleY: number;
  angleZ: number;
  zoom: number;
  light: Vec3;
  charset: string;
  charsetB?: string; // crossfade source charset (present only mid-transition)
  charsetMix?: number; // 0..1 progress from charsetB → charset (deterministic dither)
  samplesU: number;
  samplesV: number;
  aspect: number; // char height / char width
  time: number; // seconds, for surfaces whose code references `t`
  dt?: number; // seconds of simulated time this frame (0 when paused) — drives sims
  projection?: "perspective" | "ortho";
  fov?: number; // screen gain (legacy value: 2.4)
  camDist?: number; // camera distance along +z (legacy value: 5)
  ambient?: number; // ambient light (legacy value: 0.12)
  diffuse?: number; // diffuse strength (legacy value: 0.88)
  specular?: number; // Blinn-Phong specular strength (0 = off, legacy look)
  shininess?: number; // specular exponent
  pointSize?: number; // cells covered per point: 1 (legacy), 2 (2×2) or 3 (3×3)
  jitter?: number; // 0..1 deterministic per-point sample offset (0 = off, legacy)
  persistence?: number; // 0..0.95 phosphor afterglow: mix the previous frame's lum (0 = off)
  fog?: number; // 0..1 depth fog: attenuate luminance with camera-space depth (lit points only)
  /** Pointer over the viewport, 0..1 (y down); planar code sees it as mx, my (default center). */
  mouse?: { x: number; y: number; down?: boolean };
}

/** Per-frame bindings for planar (shader) code, alongside its u, v, t arguments. */
interface PlanarEnv {
  mx: number; // pointer x in shader coords (same space and span as u)
  my: number; // pointer y in shader coords (same space and span as v)
  zoom: number; // view zoom (span divides by it)
  cols: number;
  rows: number;
  aspect: number; // char height / char width
  /** Last frame's luminance at shader coords (0 when empty or on the first frame). */
  prev: (u: number, v: number) => number;
}

type PlanarPixel = (u: number, v: number, t: number, env: PlanarEnv) => number;

export interface RenderResult {
  chars: string[]; // rows
  lum: Float32Array; // per-cell luminance 0..1 (or -1 empty)
  cols: number;
  rows: number;
  points: number;
  thrown: number; // samples whose evaluation threw
  firstError: string | null; // message of the first thrown sample
  static?: boolean; // geometry is cache-able: identical view options reproduce this frame exactly
}

const MATH_KEYS = Object.getOwnPropertyNames(Math);

/** True if the surface code references `t` (time) and must be re-sampled every frame. */
function usesTime(code: string): boolean {
  return /\bt\b/.test(code);
}

/** Compile a user expression into a surface function. Throws on invalid input or syntax error. */
export function compileSurface(def: SurfaceDef): SurfaceFn {
  const uRange = def.uRange ?? [-2, 2];
  const vRange = def.vRange ?? [-2, 2];
  const scale = def.scale ?? 1;
  for (const [label, [a, b]] of [
    ["u", uRange],
    ["v", vRange],
  ] as const) {
    if (!Number.isFinite(a) || !Number.isFinite(b))
      throw new Error(`${label} range must be finite`);
    if (!(b > a)) throw new Error(`${label} range invalid: max (${b}) must be > min (${a})`);
  }
  if (!Number.isFinite(scale)) throw new Error("scale must be finite");
  // Math is destructured once at compile time; user declarations like `const PI = ...`
  // legally shadow these in the nested closure. `t` (time) is a reserved parameter.
  const mathScope = `const {${MATH_KEYS.join(",")}} = Math;`;
  if (def.kind === "height") {
    // code is an expression in x, y returning z. `scale` is applied by the
    // sampler (uniform), so the fn returns one raw tuple per call — the old
    // scale-multiplication wrapper allocated a second tuple per evaluation.
    const raw = new Function(`"use strict"; ${mathScope} return (x, y, t) => (${def.code});`)() as (
      x: number,
      y: number,
      t: number,
    ) => number;
    return (u, v, t) => {
      const z = raw(u, v, t);
      return [u, Number.isFinite(z) ? z : 0, v];
    };
  }
  // parametric: code returns [x,y,z], unscaled — see height note above
  return new Function(
    `"use strict"; ${mathScope} return (u, v, t) => { ${def.code}
};`,
  )() as SurfaceFn;
}

// ---------------------------------------------------------------------------
// code-surface kinds beyond parametric/height: implicit, generate, sim, planar
// ---------------------------------------------------------------------------

type PushFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;
type GlowFn = (x: number, y: number, z: number, l: number) => void;
type GenerateRun = (push: PushFn, glow: GlowFn, time: number) => void;
/** Handled to sim factories so editable sim code can read the pointer (env.mouse). */
type SimEnv = { mouse: Pointer };
type SimMake = (push: PushFn, glow: GlowFn, env: SimEnv) => Sim;

type CodeArtifact =
  | { kind: "parametric" | "height"; fn: SurfaceFn }
  | { kind: "implicit"; f: (x: number, y: number, z: number, t: number) => number }
  | { kind: "generate"; run: GenerateRun }
  | { kind: "sim"; make: SimMake }
  | { kind: "planar"; pixel: PlanarPixel };

/** Compile a code surface's implicit field: (x, y, z, t) → level value. */
function compileImplicitFn(
  def: SurfaceDef,
): (x: number, y: number, z: number, t: number) => number {
  // bare expressions are auto-wrapped; bodies with an explicit return pass through
  const body = /\breturn\b/.test(def.code) ? def.code : `return (${def.code});`;
  return new Function(
    `"use strict"; const {${MATH_KEYS.join(",")}} = Math; return (x, y, z, t) => { ${body}
};`,
  )() as (x: number, y: number, z: number, t: number) => number;
}

/** Compile a code surface's generate body: run(push, glow, time). */
function compileGenerateRun(def: SurfaceDef): GenerateRun {
  return new Function(
    "push",
    "glow",
    "time",
    `"use strict"; const {${MATH_KEYS.join(",")}} = Math; ${def.code}`,
  ) as unknown as GenerateRun;
}

/** Compile a code surface's sim factory: make(push, glow, env) → { step, planar? }. */
function compileSimMake(def: SurfaceDef): SimMake {
  return new Function(
    "push",
    "glow",
    "env",
    `"use strict"; const {${MATH_KEYS.join(",")}} = Math; ${def.code}`,
  ) as unknown as SimMake;
}

/**
 * Compile a code surface's planar pixel: (u, v, t, env) → luminance. The env
 * bindings (mx, my, zoom, cols, rows, aspect, prev) become reserved names in
 * the body — same contract as the reserved `t` parameter.
 */
function compilePlanarPixel(def: SurfaceDef): PlanarPixel {
  const body = /\breturn\b/.test(def.code) ? def.code : `return (${def.code});`;
  return new Function(
    `"use strict"; const {${MATH_KEYS.join(",")}} = Math; return (u, v, t, env) => { const { mx, my, zoom, cols, rows, aspect, prev } = env; ${body}
};`,
  )() as PlanarPixel;
}

/** Compile any code-surface kind. Throws on syntax errors. */
function compileCodeSurface(def: SurfaceDef): CodeArtifact {
  if (def.kind === "implicit") {
    return { kind: "implicit", f: compileImplicitFn(def) };
  }
  if (def.kind === "generate") {
    return { kind: "generate", run: compileGenerateRun(def) };
  }
  if (def.kind === "sim") {
    return { kind: "sim", make: compileSimMake(def) };
  }
  if (def.kind === "planar") {
    return { kind: "planar", pixel: compilePlanarPixel(def) };
  }
  return { kind: def.kind as "parametric" | "height", fn: compileSurface(def) };
}

// Compiled artifacts are cached by def identity. The app rebuilds the def
// object on every (debounced) code edit, so a WeakMap invalidates naturally,
// and no code string pays `new Function` twice — previously implicit/generate/
// planar code recompiled every frame, and a freshly compiled fn also runs
// JIT-cold for the whole grid. Failed compiles throw before the set, so
// per-frame error reporting is unchanged.
const artifactCache = new WeakMap<SurfaceDef, CodeArtifact>();
function cachedArtifact(def: SurfaceDef): CodeArtifact {
  let a = artifactCache.get(def);
  if (!a) {
    a = compileCodeSurface(def);
    artifactCache.set(def, a);
  }
  return a;
}

/**
 * Live pointer state for sims and native planar shapes — one stable object,
 * mutated per frame from RenderOptions.mouse, so compiled sim factories can
 * capture it once and always read the current position. Defaults mirror the
 * shader env (center, button up).
 */
const livePointer: Pointer = { x: 0.5, y: 0.5, down: false };
const simEnv: SimEnv = { mouse: livePointer };

function syncPointer(opt: RenderOptions): Pointer {
  const m = opt.mouse;
  if (m) {
    livePointer.x = m.x;
    livePointer.y = m.y;
    livePointer.down = !!m.down;
  } else {
    livePointer.x = 0.5;
    livePointer.y = 0.5;
    livePointer.down = false;
  }
  return livePointer;
}

/** Kind-aware smoke test: throws a readable error when code cannot run / produce output. */
export function validateCodeSurface(def: SurfaceDef): void {
  if (def.kind === "implicit") {
    const val = compileImplicitFn(def)(0.31, 0.17, 0.05, 0);
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new Error("implicit code must return a finite number (the level value at x, y, z, t)");
    }
  } else if (def.kind === "generate") {
    let n = 0;
    compileGenerateRun(def)(
      () => {
        n++;
      },
      () => {
        n++;
      },
      0,
    );
    if (n === 0) throw new Error("generate code must call push() or glow() at least once");
  } else if (def.kind === "sim") {
    const sim = compileSimMake(def)(
      () => {},
      () => {},
      simEnv,
    );
    if (!sim || typeof sim.step !== "function") {
      throw new Error("sim code must return { step(dt, time) {...} }");
    }
    sim.step(1 / 60, 0, makeFrame(16));
  } else if (def.kind === "planar") {
    const val = compilePlanarPixel(def)(0, 0, 0, {
      mx: 0,
      my: 0,
      zoom: 1,
      cols: 8,
      rows: 4,
      aspect: 2,
      prev: () => 0,
    });
    // NaN is a legitimate return (empty cell); anything non-numeric is a bug
    if (typeof val !== "number") {
      throw new Error(
        "planar code must return a number (luminance 0..1, or NaN for an empty cell)",
      );
    }
  }
}

/** Whether a code surface animates: sims always step; others when the code uses t/time. */
export function codeAnimated(def: SurfaceDef): boolean {
  if (def.kind === "sim") return true;
  if (def.kind === "implicit" || def.kind === "generate") {
    return /\b(t|time)\b/.test(def.code);
  }
  if (def.kind === "planar") {
    // shader bindings make the frame time- or pointer-dependent (and prev always
    // evolves), so any of them force per-frame re-evaluation — never idle-skip
    return /\b(t|time|mx|my|prev)\b/.test(def.code);
  }
  return usesTime(def.code);
}

function normalize(v: Vec3): Vec3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------------------
// frame buffers + caches (module-level, reused; reallocated only on resize)
// ---------------------------------------------------------------------------

let bufCache: { cols: number; rows: number; zbuf: Float32Array; lum: Float32Array } | null = null;

function ensureBufs(cols: number, rows: number): void {
  const size = cols * rows;
  if (!bufCache || bufCache.cols !== cols || bufCache.rows !== rows) {
    bufCache = { cols, rows, zbuf: new Float32Array(size), lum: new Float32Array(size) };
  }
}

let planarCache: { cols: number; rows: number; lum: Float32Array } | null = null;

function ensurePlanar(cols: number, rows: number): Float32Array {
  const size = cols * rows;
  if (!planarCache || planarCache.cols !== cols || planarCache.rows !== rows) {
    planarCache = { cols, rows, lum: new Float32Array(size) };
  }
  return planarCache.lum.fill(-1);
}

// Snapshot of the last planar frame, read by shader code via prev(u, v).
// Zero-filled = every prev() read returns 0 until a first frame has landed.
let planarPrev: Float32Array | null = null;

function snapshotPlanarPrev(lum: Float32Array, cols: number, rows: number): void {
  const size = cols * rows;
  if (!planarPrev || planarPrev.length !== size) planarPrev = new Float32Array(size);
  planarPrev.set(lum);
}

/** Number of cells a planar field actually filled (lum >= 0; untouched cells are -1). */
function countFilled(lum: Float32Array, cols: number, rows: number): number {
  let n = 0;
  for (let i = 0, end = cols * rows; i < end; i++) if (lum[i] >= 0) n++;
  return n;
}

// Sampled geometry is rotation-invariant, so static geometry only needs one
// sampling pass; subsequent frames reuse pos/nrm and just rotate/project.
// Animated geometry (code with `t`, animated shapes, sims) never caches.
interface GeoCache {
  key: string;
  pos: Float32Array;
  nrm: Float32Array;
  count: number;
  thrown: number;
  firstError: string | null;
  // emissive (glow) frames cache their shading inputs too; lit frames leave
  // these unset and keep shading from nrm exactly as before
  lum?: Float32Array;
  emissive?: boolean;
  depthTint?: boolean;
}
let geoCache: GeoCache | null = null;

// Cache-hit projection: emissive caches shade from their stored per-point lum,
// lit caches (fields unset) from nrm exactly as they always did.
function projectCached(g: GeoCache, v: View): number {
  const emissive = g.emissive === true;
  return projectPoints(
    g.pos,
    g.nrm,
    emissive ? (g.lum ?? null) : null,
    g.count,
    emissive,
    emissive && g.depthTint === true,
    v,
  );
}

// Re-read a frame's shading mode after its generator ran: at the call site TS
// narrows pool.mode to the pre-reset literal, but the generator may have
// flipped it to "emissive" while filling the frame.
function frameMode(f: PointFrame): "lit" | "emissive" {
  return f.mode;
}

// Geometry is sampled from `fn`, not parsed from `def.code`, so the cache key must include
// function identity: during the app's compile debounce the def (and its code) updates before
// the compiled fn does, and keying on code alone would cache the old fn's geometry under the
// new code, rendering it forever.
const fnIds = new WeakMap<SurfaceFn, number>();
let nextFnId = 1;
function fnId(fn: SurfaceFn): number {
  let id = fnIds.get(fn);
  if (id === undefined) {
    id = nextFnId++;
    fnIds.set(fn, id);
  }
  return id;
}

// Reusable point pool for generators (clouds, sims, implicit shells).
const pool = makeFrame(1 << 14);

// push/glow bound to the pool — handed to user generate/sim code. The counters
// let renderCodeGenerate recognize glow-only frames (emissive: lum is
// meaningful), since user code cannot reach the frame's own `mode` field.
let poolPushes = 0;
let poolGlows = 0;
const poolPush: PushFn = (x, y, z, nx, ny, nz) => {
  poolPushes++;
  framePush(pool, x, y, z, nx, ny, nz);
};
const poolGlow: GlowFn = (x, y, z, l) => {
  poolGlows++;
  frameGlow(pool, x, y, z, l);
};

// Scratch for implicit-shell corner values: (g+1)^3 floats.
let gridVals = new Float32Array(0);

// Phosphor-persistence ping-pong buffers (cols*rows each).
let persistA: Float32Array | null = null;
let persistB: Float32Array | null = null;
let persistFlip = false;

// Live sim instance — recreated only when the shape/params/seed signature changes.
let simCache: { sig: string; sim: Sim } | null = null;

// Params objects are treated as immutable everywhere (the app replaces them,
// never mutates), so signatures can be memoized by object identity — the
// per-frame sig for a cached shape becomes one WeakMap lookup + concat.
const sigCache = new WeakMap<Params, string>();
function paramSig(params: Params): string {
  let s = sigCache.get(params);
  if (s === undefined) {
    const keys = Object.keys(params);
    keys.sort();
    s = "";
    for (const k of keys) s += `${k}=${params[k]};`;
    sigCache.set(params, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// projection + shading
// ---------------------------------------------------------------------------

const SPLAT1 = [0];
const SPLAT2 = [0, 1];
const SPLAT3 = [-1, 0, 1];

interface View {
  cols: number;
  rows: number;
  aspect: number;
  // combined X·Y·Z rotation matrix (Rz·Ry·Rx), built once per frame so the
  // per-point loop rotates on scalars with no intermediate arrays
  r00: number;
  r01: number;
  r02: number;
  r10: number;
  r11: number;
  r12: number;
  r20: number;
  r21: number;
  r22: number;
  light: Vec3;
  ambient: number;
  diffuse: number;
  specular: number;
  shininess: number;
  camDist: number;
  perspective: boolean;
  K1: number; // perspective gain
  KS: number; // ortho scale
  pointSize: number;
  jitter: number;
  fog: number;
  zbuf: Float32Array;
  lum: Float32Array;
}

function shade(rnx: number, rny: number, rnz: number, v: View): number {
  let dot = rnx * v.light[0] + rny * v.light[1] + rnz * v.light[2];
  if (rnz > 0) dot = -dot;
  let l = v.ambient + v.diffuse * Math.max(0, dot);
  if (v.specular > 0) {
    // Blinn-Phong: H = normalize(L + V) with view vector V = (0, 0, -1)
    const hx = v.light[0];
    const hy = v.light[1];
    const hz = v.light[2] - 1;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    let sd = (rnx * hx + rny * hy + rnz * hz) / hl;
    if (rnz > 0) sd = -sd;
    if (sd > 0) l += v.specular * Math.pow(sd, v.shininess);
  }
  return Math.max(0, Math.min(1, l));
}

// First uniform of the deterministic per-point hash (see hash2 doc) — scalar
// form for the charset-fade dither, which needs only one of the two values.
function hash1(i: number): number {
  let h = Math.imul(i + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function projectPoints(
  pos: Float32Array,
  nrm: Float32Array,
  pointLum: Float32Array | null,
  count: number,
  emissive: boolean,
  depthTint: boolean,
  v: View,
): number {
  const { cols, rows, zbuf, lum, aspect, jitter, pointSize } = v;
  // splat cell offsets: 2 → 2×2 block, 3 → 3×3 centered block
  const offs = pointSize >= 3 ? SPLAT3 : pointSize === 2 ? SPLAT2 : SPLAT1;
  const m00 = v.r00,
    m01 = v.r01,
    m02 = v.r02;
  const m10 = v.r10,
    m11 = v.r11,
    m12 = v.r12;
  const m20 = v.r20,
    m21 = v.r21,
    m22 = v.r22;
  let drawn = 0;
  for (let i = 0, k = 0; i < count; i++, k += 3) {
    // rotate on scalars — a fresh [x,y,z] per point per frame was pure GC churn
    const px0 = pos[k],
      py0 = pos[k + 1],
      pz0 = pos[k + 2];
    const rx = m00 * px0 + m01 * py0 + m02 * pz0;
    const ry = m10 * px0 + m11 * py0 + m12 * pz0;
    const z = m20 * px0 + m21 * py0 + m22 * pz0 + v.camDist;
    if (z <= 0.1) continue;
    const ooz = 1 / z;
    let fx: number;
    let fy: number;
    if (v.perspective) {
      fx = cols / 2 + v.K1 * ooz * rx;
      fy = rows / 2 - (v.K1 * ooz * ry) / aspect;
    } else {
      fx = cols / 2 + v.KS * rx;
      fy = rows / 2 - (v.KS * ry) / aspect;
    }
    if (jitter > 0) {
      // inline first/second halves of the deterministic hash — no tuple alloc
      let h = Math.imul(i + 0x9e3779b9, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      fx += (((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5) * jitter;
      let g = Math.imul(i + 0x3c6ef372, 0x27d4eb2f);
      g ^= g >>> 15;
      g = Math.imul(g, 0x165667b1);
      fy += (((g ^ (g >>> 16)) >>> 0) / 4294967296 - 0.5) * jitter;
    }
    const cellX = Math.round(fx);
    const cellY = Math.round(fy);

    // shading value is computed at most once per point, on the first cell that passes
    let l = 0;
    let lReady = false;
    for (let oy = 0; oy < offs.length; oy++) {
      const yy = cellY + offs[oy];
      if (yy < 0 || yy >= rows) continue;
      for (let ox = 0; ox < offs.length; ox++) {
        const xx = cellX + offs[ox];
        if (xx < 0 || xx >= cols) continue;
        const idx = yy * cols + xx;
        if (ooz <= zbuf[idx]) continue;
        zbuf[idx] = ooz;
        if (!lReady) {
          if (emissive) {
            l = pointLum ? pointLum[i] : 1;
            if (depthTint) {
              const d = 1 - (z - v.camDist) / 2.4;
              l *= 0.35 + 0.65 * Math.max(0, Math.min(1, d));
            }
          } else {
            const nx0 = nrm[k],
              ny0 = nrm[k + 1],
              nz0 = nrm[k + 2];
            const rnx = m00 * nx0 + m01 * ny0 + m02 * nz0;
            const rny = m10 * nx0 + m11 * ny0 + m12 * nz0;
            const rnz = m20 * nx0 + m21 * ny0 + m22 * nz0;
            l = shade(rnx, rny, rnz, v);
            if (v.fog > 0) {
              // camera z spans roughly [camDist-1.6, camDist+1.6] for our shapes;
              // dim the back half toward 1-fog of its lit luminance
              const dz = (z - (v.camDist - 1.6)) / 3.2;
              l *= 1 - v.fog * Math.max(0, Math.min(1, dz));
            }
          }
          lReady = true;
        }
        lum[idx] = l;
        drawn++;
      }
    }
  }
  return drawn;
}

// Row-assembly scratch (UTF-16 code units) — see charsFromLum.
let rowBuf = new Uint16Array(0);

export function charsFromLum(
  lum: Float32Array,
  cols: number,
  rows: number,
  charset: string,
  charsetB?: string,
  mix = 0,
): string[] {
  const cs = charset.length > 0 ? charset : " ";
  // charset crossfade: deterministic per-cell dither picks the old or new ramp,
  // so switching ramps dissolves instead of popping (mix 0/1 falls back to one ramp)
  const csB = charsetB && charsetB.length > 0 && mix > 0 && mix < 1 ? charsetB : null;
  const out: string[] = new Array(rows);
  // Ramps are indexed by UTF-16 code unit (exactly like the string indexing
  // this replaced, lone surrogates included), so the row can be assembled in
  // a reused code-unit buffer and built with one fromCharCode shot per row
  // instead of a per-cell string concat.
  const codesA = new Uint16Array(cs.length);
  for (let i = 0; i < cs.length; i++) codesA[i] = cs.charCodeAt(i);
  let codesB = null as Uint16Array | null;
  if (csB) {
    codesB = new Uint16Array(csB.length);
    for (let i = 0; i < csB.length; i++) codesB[i] = csB.charCodeAt(i);
  }
  if (rowBuf.length < cols) rowBuf = new Uint16Array(Math.max(64, cols * 2));
  const lenA = cs.length - 1;
  const lenB = csB ? csB.length - 1 : 0;
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      const l = lum[base + c];
      if (l < 0) rowBuf[c] = 32;
      else if (csB && hash1(base + c) < mix)
        rowBuf[c] = codesB![Math.min(lenB, Math.floor(l * lenB + 0.5))];
      else rowBuf[c] = codesA[Math.min(lenA, Math.floor(l * lenA + 0.5))];
    }
    out[r] = String.fromCharCode.apply(null, rowBuf.subarray(0, cols) as unknown as number[]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// geometry generation paths
// ---------------------------------------------------------------------------

interface CoreResult {
  drawn: number;
  thrown: number;
  firstError: string | null;
  static: boolean; // geometry cacheable — same view options reproduce the frame exactly
}

// Scratch geometry for the animated (uncached) sampling path — grown, never
// shrunk. Cached (static) results are sliced out so the cache never aliases
// scratch that the next animated frame overwrites.
let sampPos = new Float32Array(0);
let sampNrm = new Float32Array(0);

// Shared (u,v)-grid sampler. Normals come from forward differences, exactly as
// the legacy renderer always did. `key` enables the geometry cache for static
// geometry; animated geometry passes null. `scale` (uniform) is applied here
// rather than in a compiled wrapper — it commutes with normal normalization
// and keeps the fn to one tuple per call. `trusted` fns (first-party shapes)
// skip the per-sample try/catch; user code keeps the guard + error bookkeeping.
function sampleParametric(
  fn: SurfaceFn,
  uRange: [number, number],
  vRange: [number, number],
  su: number,
  sv: number,
  time: number,
  key: string | null,
  scale = 1,
  trusted = false,
): { pos: Float32Array; nrm: Float32Array; thrown: number; firstError: string | null } {
  if (key && geoCache && geoCache.key === key) return geoCache;
  const N = su * sv;
  const need = N * 3;
  if (sampPos.length < need) {
    sampPos = new Float32Array(need);
    sampNrm = new Float32Array(need);
  } else {
    // zero the used range: thrown/non-finite samples leave unwritten slots that
    // project as origin points — a fresh allocation was always zero-filled
    sampPos.fill(0, 0, need);
    sampNrm.fill(0, 0, need);
  }
  const pos = sampPos;
  const nrm = sampNrm;
  const [u0, u1] = uRange;
  const [v0, v1] = vRange;
  const du = (u1 - u0) / su;
  const dv = (v1 - v0) / sv;
  const eps = 1e-3;
  let thrown = 0;
  let firstError: string | null = null;

  // guarded flag selects the per-sample try/catch path (user code) vs the
  // plain path (trusted first-party fns — their calls then sit outside any
  // try block, so nothing stands between them and inlining)
  const sampleAll = (guarded: boolean) => {
    for (let i = 0; i < su; i++) {
      const u = u0 + i * du;
      for (let j = 0; j < sv; j++) {
        const v = v0 + j * dv;
        const k = (i * sv + j) * 3;
        let p: Vec3, pu: Vec3, pv: Vec3;
        if (guarded) {
          try {
            p = fn(u, v, time);
            pu = fn(u + eps, v, time);
            pv = fn(u, v + eps, time);
          } catch (e) {
            thrown++;
            if (firstError === null) firstError = (e as Error)?.message ?? String(e);
            continue;
          }
        } else {
          p = fn(u, v, time);
          pu = fn(u + eps, v, time);
          pv = fn(u, v + eps, time);
        }
        // scale each component before differencing — same op order the old
        // compiled wrapper used, so results stay bit-identical
        const px = p[0] * scale,
          py = p[1] * scale,
          pz = p[2] * scale;
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;

        // forward-difference tangents → cross → normalize, all on scalars
        const ax = pu[0] * scale - px,
          ay = pu[1] * scale - py,
          az = pu[2] * scale - pz;
        const bx = pv[0] * scale - px,
          by = pv[1] * scale - py,
          bz = pv[2] * scale - pz;
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) continue;

        pos[k] = px;
        pos[k + 1] = py;
        pos[k + 2] = pz;
        nrm[k] = nx;
        nrm[k + 1] = ny;
        nrm[k + 2] = nz;
      }
    }
  };
  sampleAll(!trusted);

  if (key) {
    const out = {
      key,
      pos: pos.slice(0, need),
      nrm: nrm.slice(0, need),
      count: N,
      thrown,
      firstError,
    };
    geoCache = out;
    return out;
  }
  return { pos, nrm, thrown, firstError };
}

function renderCode(
  def: SurfaceDef,
  fn: SurfaceFn | null,
  opt: RenderOptions,
  v: View,
): CoreResult {
  // kinds beyond parametric/height compile and run through the code pipeline
  if (
    def.kind === "implicit" ||
    def.kind === "generate" ||
    def.kind === "sim" ||
    def.kind === "planar"
  ) {
    try {
      if (def.kind === "implicit") return renderCodeImplicit(def, opt, v);
      if (def.kind === "generate") return renderCodeGenerate(def, opt, v);
      if (def.kind === "sim") return renderCodeSim(def, opt, v);
      return renderCodePlanar(def, opt, v);
    } catch (e) {
      return {
        drawn: 0,
        thrown: opt.samplesU * opt.samplesV,
        firstError: (e as Error)?.message ?? String(e),
        static: false,
      };
    }
  }
  const su = opt.samplesU;
  const sv = opt.samplesV;
  let compiled: SurfaceFn;
  try {
    // lazy compile (e.g. first render after restore, before the debounced recompile) — cached by def identity
    compiled = fn ?? (cachedArtifact(def) as { fn: SurfaceFn }).fn;
  } catch (e) {
    return {
      drawn: 0,
      thrown: opt.samplesU * opt.samplesV,
      firstError: (e as Error)?.message ?? String(e),
      static: false,
    };
  }
  const uRange = def.uRange ?? [-2, 2];
  const vRange = def.vRange ?? [-2, 2];
  const scale = def.scale ?? 1;
  const cacheable = !usesTime(def.code);
  const key = cacheable
    ? `${fnId(compiled)}\u0000${def.kind}\u0000${def.code}\u0000${uRange[0]},${uRange[1]}\u0000${vRange[0]},${vRange[1]}\u0000${scale}\u0000${su}x${sv}`
    : null;
  const geo = sampleParametric(compiled, uRange, vRange, su, sv, opt.time, key, scale);
  const drawn = projectPoints(geo.pos, geo.nrm, null, su * sv, false, false, v);
  return { drawn, thrown: geo.thrown, firstError: geo.firstError, static: cacheable };
}

function renderNativeParametric(
  shape: Shape,
  params: Params,
  opt: RenderOptions,
  v: View,
): CoreResult {
  const su = opt.samplesU;
  const sv = opt.samplesV;
  const key = !shape.animated ? `P|${shape.id}|${paramSig(params)}|${su}x${sv}` : null;
  // cache check before building: shape.parametric!(params) allocates a fresh
  // build (fn + closures) per call — a hit must not pay it
  if (key && geoCache && geoCache.key === key) {
    const drawn = projectPoints(geoCache.pos, geoCache.nrm, null, geoCache.count, false, false, v);
    return { drawn, thrown: geoCache.thrown, firstError: geoCache.firstError, static: true };
  }
  const build = shape.parametric!(params) as ParametricBuild;
  // scale is applied by the sampler; native fns are first-party (trusted)
  const geo = sampleParametric(
    build.fn,
    build.uRange,
    build.vRange,
    su,
    sv,
    opt.time,
    key,
    build.scale,
    true,
  );
  const drawn = projectPoints(geo.pos, geo.nrm, null, su * sv, false, false, v);
  return { drawn, thrown: geo.thrown, firstError: geo.firstError, static: !!key };
}

function renderGenerated(shape: Shape, params: Params, opt: RenderOptions, v: View): CoreResult {
  const key = !shape.animated ? `G|${shape.id}|${paramSig(params)}` : null;
  if (key && geoCache && geoCache.key === key) {
    const drawn = projectCached(geoCache, v);
    return { drawn, thrown: geoCache.thrown, firstError: geoCache.firstError, static: true };
  }
  pool.count = 0;
  pool.mode = "lit";
  pool.depthTint = false;
  shape.generate!(params, opt.time, pool);
  if (pool.count === 0)
    return {
      drawn: 0,
      thrown: opt.samplesU * opt.samplesV,
      firstError: "no points generated",
      static: false,
    };
  // glow-emitting generators (attractors, fern, tesseract, …) declare themselves
  // emissive: shade from the per-point luminance instead of the placeholder
  // normals frameGlow pushed
  const emissive = frameMode(pool) === "emissive";
  let pos = pool.pos;
  let nrm = pool.nrm;
  let lum: Float32Array | null = emissive ? pool.lum : null;
  if (key) {
    pos = pool.pos.slice(0, pool.count * 3);
    nrm = pool.nrm.slice(0, pool.count * 3);
    if (emissive) lum = pool.lum.slice(0, pool.count);
    geoCache = {
      key,
      pos,
      nrm,
      count: pool.count,
      thrown: 0,
      firstError: null,
      lum: lum ?? undefined,
      emissive,
      depthTint: pool.depthTint,
    };
  }
  const drawn = projectPoints(pos, nrm, lum, pool.count, emissive, emissive && pool.depthTint, v);
  return { drawn, thrown: 0, firstError: null, static: !!key };
}

// Implicit surfaces: evaluate F on a (g+1)^3 corner grid, emit one lit point per
// cell whose corner range crosses the iso level, with the grid gradient as normal.
function renderImplicit(shape: Shape, params: Params, opt: RenderOptions, v: View): CoreResult {
  const g = clampQuality(params.quality);
  const key = !shape.animated ? `I|${shape.id}|${paramSig(params)}|g${g}` : null;
  // cache check before building — see renderNativeParametric
  if (key && geoCache && geoCache.key === key) {
    const drawn = projectPoints(geoCache.pos, geoCache.nrm, null, geoCache.count, false, false, v);
    return { drawn, thrown: geoCache.thrown, firstError: geoCache.firstError, static: true };
  }
  const build = shape.implicit!(params) as ImplicitBuild;
  return scanImplicit(build, g, opt.time, key, v);
}

function clampQuality(q: number | undefined): number {
  return Math.max(8, Math.min(96, Math.round(q ?? 40)));
}

// Shared implicit level-set scanner: evaluate F on a (g+1)^3 corner grid, emit one
// lit point per crossing cell (center) with the grid gradient as its normal.
function scanImplicit(
  build: ImplicitBuild,
  g: number,
  time: number,
  key: string | null,
  v: View,
): CoreResult {
  if (key && geoCache && geoCache.key === key) {
    const drawn = projectPoints(geoCache.pos, geoCache.nrm, null, geoCache.count, false, false, v);
    return { drawn, thrown: geoCache.thrown, firstError: geoCache.firstError, static: true };
  }

  const n = g + 1;
  const need = n * n * n;
  if (gridVals.length < need) gridVals = new Float32Array(need);
  const b = build.bound;
  const h = (2 * b) / g;
  const vals = gridVals;
  let thrown = 0;
  let firstError: string | null = null;
  const f = build.f;
  for (let iz = 0; iz < n; iz++) {
    const z = -b + iz * h;
    for (let iy = 0; iy < n; iy++) {
      const y = -b + iy * h;
      const base = (iz * n + iy) * n;
      for (let ix = 0; ix < n; ix++) {
        try {
          vals[base + ix] = f(-b + ix * h, y, z, time);
        } catch (e) {
          thrown++;
          if (firstError === null) firstError = (e as Error)?.message ?? String(e);
          vals[base + ix] = NaN;
        }
      }
    }
  }

  pool.count = 0;
  pool.mode = "lit";
  const iso = build.iso;
  for (let iz = 0; iz < g; iz++) {
    const zRow = (iz + 1) * n * n; // base index of z-slice iz+1
    for (let iy = 0; iy < g; iy++) {
      const rowBase = (iz * n + iy) * n;
      const rowNext = zRow + iy * n; // y-row iy of the next z-slice
      for (let ix = 0; ix < g; ix++) {
        const i000 = rowBase + ix;
        const v000 = vals[i000];
        if (v000 !== v000) continue; // NaN corner (thrown evaluation)
        const v100 = vals[i000 + 1];
        const v010 = vals[i000 + n];
        const v110 = vals[i000 + n + 1];
        const v001 = vals[rowNext + ix];
        const v101 = vals[rowNext + ix + 1];
        const v011 = vals[rowNext + ix + n];
        const v111 = vals[rowNext + ix + n + 1];
        let mn = v000;
        let mx = v000;
        if (v100 < mn) mn = v100;
        if (v100 > mx) mx = v100;
        if (v010 < mn) mn = v010;
        if (v010 > mx) mx = v010;
        if (v110 < mn) mn = v110;
        if (v110 > mx) mx = v110;
        if (v001 < mn) mn = v001;
        if (v001 > mx) mx = v001;
        if (v101 < mn) mn = v101;
        if (v101 > mx) mx = v101;
        if (v011 < mn) mn = v011;
        if (v011 > mx) mx = v011;
        if (v111 < mn) mn = v111;
        if (v111 > mx) mx = v111;
        if (mn > iso || mx < iso) continue;
        const cx = -b + (ix + 0.5) * h;
        const cy = -b + (iy + 0.5) * h;
        const cz = -b + (iz + 0.5) * h;
        // gradient: average forward difference per axis over the cell's 4 parallel edges
        const h4 = 4 * h;
        let gx = (v100 - v000 + v110 - v010 + v101 - v001 + v111 - v011) / h4;
        let gy = (v010 - v000 + v110 - v100 + v011 - v001 + v111 - v101) / h4;
        let gz = (v001 - v000 + v101 - v100 + v011 - v010 + v111 - v110) / h4;
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (!Number.isFinite(gl) || gl < 1e-12) {
          gx = 0;
          gy = 0;
          gz = 1;
        } else {
          gx /= gl;
          gy /= gl;
          gz /= gl;
        }
        if (pool.count >= pool.cap) frameEnsure(pool, pool.cap * 2);
        pool.pos[pool.count * 3] = cx;
        pool.pos[pool.count * 3 + 1] = cy;
        pool.pos[pool.count * 3 + 2] = cz;
        pool.nrm[pool.count * 3] = gx;
        pool.nrm[pool.count * 3 + 1] = gy;
        pool.nrm[pool.count * 3 + 2] = gz;
        pool.count++;
      }
    }
  }
  if (pool.count === 0)
    return {
      drawn: 0,
      thrown: Math.max(1, thrown),
      firstError: firstError ?? "empty level set",
      static: false,
    };
  let pos = pool.pos;
  let nrm = pool.nrm;
  if (key) {
    pos = pool.pos.slice(0, pool.count * 3);
    nrm = pool.nrm.slice(0, pool.count * 3);
    geoCache = { key, pos, nrm, count: pool.count, thrown, firstError };
  }
  const drawn = projectPoints(pos, nrm, null, pool.count, false, false, v);
  return { drawn, thrown, firstError, static: !!key };
}

function renderSim(shape: Shape, params: Params, opt: RenderOptions, v: View): CoreResult {
  const sig = `S|${shape.id}|${paramSig(params)}`;
  if (!simCache || simCache.sig !== sig)
    simCache = { sig, sim: shape.sim!(params, Math.round(params.seed ?? 42)) };
  return runSimInstance(simCache.sim, opt, v);
}

// Shared sim runner: step the instance, then emit points or a planar field.
function runSimInstance(sim: Sim, opt: RenderOptions, v: View): CoreResult {
  const dt = Math.max(0, opt.dt ?? 0);
  const pointer = syncPointer(opt);
  pool.count = 0;
  pool.mode = "emissive";
  pool.depthTint = false;
  sim.step(dt, opt.time, pool, pointer);
  if (sim.planar) {
    const lum = ensurePlanar(v.cols, v.rows);
    sim.planar(v.cols, v.rows, v.aspect, lum, pointer);
    return { drawn: -1, thrown: 0, firstError: null, static: false }; // planar path assembles chars separately
  }
  const emissive = pool.mode === "emissive";
  const drawn = projectPoints(
    pool.pos,
    pool.nrm,
    emissive ? pool.lum : null,
    pool.count,
    emissive,
    pool.depthTint,
    v,
  );
  return { drawn, thrown: 0, firstError: null, static: false };
}

function renderPlanar(shape: Shape, params: Params, opt: RenderOptions, v: View): CoreResult {
  const lum = ensurePlanar(v.cols, v.rows);
  shape.planar!(params, opt.time, v.cols, v.rows, v.aspect, lum, syncPointer(opt));
  return { drawn: -1, thrown: 0, firstError: null, static: !shape.animated };
}

// --- code-surface kinds beyond parametric/height -----------------------------

function renderCodeImplicit(def: SurfaceDef, opt: RenderOptions, v: View): CoreResult {
  const bound = def.bound ?? 3;
  const iso = def.iso ?? 0;
  const g = clampQuality(def.quality);
  const key = !codeAnimated(def) ? `CI|${def.id}|${def.code}|${bound}|${iso}|g${g}` : null;
  // geometry cache first — a hit must not pay a `new Function` on the way in
  if (key && geoCache && geoCache.key === key) {
    const drawn = projectPoints(geoCache.pos, geoCache.nrm, null, geoCache.count, false, false, v);
    return { drawn, thrown: geoCache.thrown, firstError: geoCache.firstError, static: true };
  }
  const build: ImplicitBuild = {
    f: (cachedArtifact(def) as { f: ImplicitBuild["f"] }).f,
    bound,
    iso,
  };
  return scanImplicit(build, g, opt.time, key, v);
}

function renderCodeGenerate(def: SurfaceDef, opt: RenderOptions, v: View): CoreResult {
  const key = !codeAnimated(def) ? `CG|${def.id}|${def.code}` : null;
  if (key && geoCache && geoCache.key === key) {
    const drawn = projectCached(geoCache, v);
    return { drawn, thrown: geoCache.thrown, firstError: geoCache.firstError, static: true };
  }
  pool.count = 0;
  pool.mode = "lit";
  pool.depthTint = def.depthTint === true;
  poolPushes = 0;
  poolGlows = 0;
  (cachedArtifact(def) as { run: GenerateRun }).run(poolPush, poolGlow, opt.time);
  if (pool.count === 0)
    return {
      drawn: 0,
      thrown: opt.samplesU * opt.samplesV,
      firstError: "generate code pushed no points",
      static: false,
    };
  // user code never sees the frame's `mode`: glow-only code (attractor codegen,
  // custom point clouds) renders emissive; anything mixed with push keeps lit
  // shading, where the glow points' placeholder normals apply as before
  const emissive = poolGlows > 0 && poolPushes === 0;
  let pos = pool.pos;
  let nrm = pool.nrm;
  let lum: Float32Array | null = emissive ? pool.lum : null;
  if (key) {
    pos = pool.pos.slice(0, pool.count * 3);
    nrm = pool.nrm.slice(0, pool.count * 3);
    if (emissive) lum = pool.lum.slice(0, pool.count);
    geoCache = {
      key,
      pos,
      nrm,
      count: pool.count,
      thrown: 0,
      firstError: null,
      lum: lum ?? undefined,
      emissive,
      depthTint: pool.depthTint,
    };
  }
  const drawn = projectPoints(pos, nrm, lum, pool.count, emissive, emissive && pool.depthTint, v);
  return { drawn, thrown: 0, firstError: null, static: !!key };
}

function renderCodeSim(def: SurfaceDef, opt: RenderOptions, v: View): CoreResult {
  const sig = `SC|${def.id}|${def.code}`;
  if (!simCache || simCache.sig !== sig) {
    simCache = { sig, sim: compileSimMake(def)(poolPush, poolGlow, simEnv) };
  }
  return runSimInstance(simCache.sim, opt, v);
}

function renderCodePlanar(def: SurfaceDef, opt: RenderOptions, v: View): CoreResult {
  const lum = ensurePlanar(v.cols, v.rows);
  const pixel = (cachedArtifact(def) as { pixel: PlanarPixel }).pixel;
  // view zoom frames the shader: span divides by it, so wheel zoom works here
  // like it does for projected geometry (clamped well past the UI range)
  const zoom = opt.zoom > 0 ? Math.min(20, Math.max(0.05, opt.zoom)) : 1;
  const span = Math.max(1e-6, (def.span ?? 4) / zoom);
  const hspan = (span * v.rows * v.aspect) / v.cols;
  const dx = span / v.cols / 2;
  const dy = hspan / v.rows / 2;
  const mx = ((opt.mouse?.x ?? 0.5) - 0.5) * span;
  const my = (0.5 - (opt.mouse?.y ?? 0.5)) * hspan;
  // only expose prev when it matches this frame's grid — a stale buffer from a
  // different size (pre-resize frame) must read as empty, not alias
  const prevBuf = planarPrev && planarPrev.length === v.cols * v.rows ? planarPrev : null;
  const env: PlanarEnv = {
    mx,
    my,
    zoom,
    cols: v.cols,
    rows: v.rows,
    aspect: v.aspect,
    prev: (pu, pv) => {
      if (!prevBuf) return 0;
      const col = Math.round((pu / span + 0.5) * v.cols - 0.5);
      const row = Math.round((0.5 - pv / hspan) * v.rows - 0.5);
      if (col < 0 || col >= v.cols || row < 0 || row >= v.rows) return 0;
      const l = prevBuf[row * v.cols + col];
      return l > 0 ? l : 0;
    },
  };
  for (let row = 0; row < v.rows; row++) {
    const vy = (0.5 - (row + 0.5) / v.rows) * hspan;
    const base = row * v.cols;
    for (let col = 0; col < v.cols; col++) {
      const vx = ((col + 0.5) / v.cols - 0.5) * span;
      // 2×2 supersampling so thin features still hit a cell
      const l = Math.max(
        pixel(vx - dx, vy - dy, opt.time, env),
        pixel(vx + dx, vy - dy, opt.time, env),
        pixel(vx - dx, vy + dy, opt.time, env),
        pixel(vx + dx, vy + dy, opt.time, env),
      );
      lum[base + col] = Number.isFinite(l) ? Math.max(0, Math.min(1, l)) : -1;
    }
  }
  return { drawn: -1, thrown: 0, firstError: null, static: !codeAnimated(def) };
}

function renderNative(shape: Shape, params: Params, opt: RenderOptions, v: View): CoreResult {
  try {
    if (shape.sim) return renderSim(shape, params, opt, v);
    if (shape.planar) return renderPlanar(shape, params, opt, v);
    if (shape.implicit) return renderImplicit(shape, params, opt, v);
    if (shape.generate) return renderGenerated(shape, params, opt, v);
    if (shape.parametric) return renderNativeParametric(shape, params, opt, v);
    throw new Error("shape defines no geometry builder");
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return { drawn: 0, thrown: opt.samplesU * opt.samplesV, firstError: msg, static: false };
  }
}

// ---------------------------------------------------------------------------
// public entry points
// ---------------------------------------------------------------------------

/**
 * Render any registry entry: a legacy code-string surface or a native shape.
 * Planar results (drawn === -1) assemble their chars from the planar buffer.
 */
export function renderFrame(r: Renderable, opt: RenderOptions): RenderResult {
  const { cols, rows } = opt;
  ensureBufs(cols, rows);
  const zbuf = bufCache!.zbuf.fill(-Infinity);
  const lum = bufCache!.lum.fill(-1);

  const camDist = opt.camDist ?? 5;
  const fov = opt.fov ?? 2.4;
  const projection = opt.projection ?? "perspective";
  const K1 = Math.min(cols * 0.5, rows * opt.aspect * 0.5) * fov * opt.zoom;
  const KS = Math.min(cols * 0.5, rows * opt.aspect * 0.5) * 0.62 * (fov / 2.4) * opt.zoom;

  // combined rotation matrix Rz·Ry·Rx — equivalent to applying the X, Y then Z
  // axis rotations in turn, but built once per frame instead of per point
  const cX = Math.cos(opt.angleX),
    sX = Math.sin(opt.angleX);
  const cY = Math.cos(opt.angleY),
    sY = Math.sin(opt.angleY);
  const cZ = Math.cos(opt.angleZ),
    sZ = Math.sin(opt.angleZ);
  const view: View = {
    cols,
    rows,
    aspect: opt.aspect,
    r00: cZ * cY,
    r01: cZ * sY * sX - sZ * cX,
    r02: cZ * sY * cX + sZ * sX,
    r10: sZ * cY,
    r11: sZ * sY * sX + cZ * cX,
    r12: sZ * sY * cX - cZ * sX,
    r20: -sY,
    r21: cY * sX,
    r22: cY * cX,
    light: normalize(opt.light),
    ambient: opt.ambient ?? 0.12,
    diffuse: opt.diffuse ?? 0.88,
    specular: opt.specular ?? 0,
    shininess: opt.shininess ?? 24,
    camDist,
    perspective: projection !== "ortho",
    K1,
    KS,
    pointSize: Math.max(1, Math.min(3, Math.round(opt.pointSize ?? 1))),
    jitter: Math.max(0, Math.min(1, opt.jitter ?? 0)),
    fog: Math.max(0, Math.min(1, opt.fog ?? 0)),
    zbuf,
    lum,
  };

  let res: CoreResult;
  if (r.tag === "code") res = renderCode(r.def, r.fn, opt, view);
  else res = renderNative(r.shape, paramsWithDefaults(r.shape, r.params), opt, view);

  let outLum = lum;
  if (res.drawn === -1) {
    outLum = planarCache!.lum; // planar path filled this instead
    // feed the next frame's prev(u, v): the raw field, before persistence mixes in
    snapshotPlanarPrev(outLum, cols, rows);
  }

  // Phosphor persistence: mix the previous frame's post-processed luminance
  // into a dedicated ping-pong buffer (never mutating the shared/planar caches),
  // so trails decay across frames. max() keeps bright heads crisp while tails fade.
  const persistence = Math.max(0, Math.min(0.95, opt.persistence ?? 0));
  if (persistence > 0) {
    const n2 = cols * rows;
    if (!persistA || !persistB || persistA.length !== n2) {
      persistA = new Float32Array(n2);
      persistB = new Float32Array(n2);
      persistFlip = false;
    }
    const dst = persistFlip ? persistA : persistB;
    const src = persistFlip ? persistB : persistA;
    for (let i = 0; i < n2; i++) {
      const p = src[i] * persistence;
      dst[i] = outLum[i] > p ? outLum[i] : p;
    }
    persistFlip = !persistFlip;
    outLum = dst;
  }
  const chars = charsFromLum(outLum, cols, rows, opt.charset, opt.charsetB, opt.charsetMix ?? 0);
  // Planar paths signal via drawn === -1; report the number of lit cells so the
  // status bar doesn't read "0 px" for escape-time fields.
  const points = res.drawn >= 0 ? res.drawn : countFilled(outLum, cols, rows);
  return {
    chars,
    lum: outLum,
    cols,
    rows,
    points,
    thrown: res.thrown,
    firstError: res.firstError,
    static: res.static,
  };
}

// Fill in any missing params with declared defaults so shapes always see a
// complete, finite parameter set even before the UI has touched them.
// Single-slot memo: the renderable's params object identity is stable between
// UI commits, so the steady-state frame skips rebuilding this object.
let paramsSlot: { shape: Shape; params: Params; full: Params } | null = null;
function paramsWithDefaults(shape: Shape, params: Params): Params {
  if (paramsSlot && paramsSlot.shape === shape && paramsSlot.params === params)
    return paramsSlot.full;
  const full = defaultParams(shape.params);
  for (const k of Object.keys(params)) {
    const val = params[k];
    if (typeof val === "number" && Number.isFinite(val) && k in full) full[k] = val;
  }
  paramsSlot = { shape, params, full };
  return full;
}
